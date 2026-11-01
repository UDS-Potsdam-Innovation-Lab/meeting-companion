//! The phone view's routes and the checks every request passes, outermost first:
//!
//! 1. security headers on every response (CSP, nosniff, no-referrer, no-store, DENY);
//! 2. the request clock (headers and body must be complete within `request_timeout` of the first byte);
//! 3. the per-address rate limit (429 with `Retry-After`);
//! 4. DNS rebinding and CSRF: `Host` must be the bound `<ip>:<port>` (421), an `Origin` must be
//!    `http://<ip>:<port>` and a `POST` must carry one (403);
//! 5. the body: at most `max_body` bytes (413), read within the deadline (408, connection closed);
//! 6. routing: the page, its assets, and under `/api/` only requests with the opening's bearer token
//!    (403, the same body for every reason). Consumer routes are mounted under `/api/<consumer>/` and
//!    pass through all of the above.
//!
//! Nothing here logs: no request, path, header or token reaches the log.

use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::body::{Body, Bytes};
use axum::extract::{FromRequest, FromRequestParts, Path, Request, State};
use axum::handler::Handler;
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Extension, Router};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::assets::{Asset, PhoneAssets};
use super::rate::{Clock, RateLimiter};
use super::token::PhoneViewToken;
use super::Limits;

/// The Content-Security-Policy of every phone view response.
pub const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; \
                       connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/// What one opening of the view knows: its token, its meeting and the address it is bound to.
pub(crate) struct Opening {
    pub token: PhoneViewToken,
    pub meeting_id: String,
    /// `<ip>:<port>`, the only accepted `Host`.
    pub host: String,
    /// `http://<ip>:<port>`, the only accepted `Origin`.
    pub origin: String,
    pub limiter: Arc<RateLimiter>,
    pub clock: Arc<dyn Clock>,
    pub limits: Limits,
    pub assets: Arc<dyn PhoneAssets>,
}

/// The address of the connection a request came on.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Peer(pub IpAddr);

/// When the first byte of the connection's current request arrived (set by the connection's reader).
#[derive(Debug, Clone, Default)]
pub(crate) struct ConnClock(Arc<Mutex<Option<Instant>>>);

impl ConnClock {
    pub fn mark(&self) {
        let mut at = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if at.is_none() {
            *at = Some(Instant::now());
        }
    }
    fn take(&self) -> Option<Instant> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }
    fn clear(&self) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[derive(Debug, Clone, Copy)]
struct RequestStart(Instant);

/// A phone holding the current token of this meeting's view. Every `/api/` handler can extract it
/// with `Extension<PhoneSession>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhoneSession {
    pub meeting_id: String,
}

/// Routes a consumer (voice profiles, team review, …) adds under `/api/<name>/`. They pass through
/// the same checks as every other request, including the token. Register them on the
/// [`super::PhoneViewServer`] before the view opens.
///
/// State-changing routes use [`ConsumerRoutes::post`]: only `POST` with `Content-Type:
/// application/json` (415 otherwise; other methods 405). Read with [`PhoneJson`], ids with
/// [`PhoneId`] (400 for malformed JSON, unknown fields or a bad id).
pub struct ConsumerRoutes {
    name: String,
    router: Router,
    table: Vec<String>,
}

impl ConsumerRoutes {
    /// `name`: lower-case letters, digits and `-` (e.g. `voices`). Panics on another name: it is
    /// fixed in the consumer's code.
    pub fn new(name: &str) -> Self {
        assert!(
            !name.is_empty()
                && name.len() <= 32
                && name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && name != "session",
            "invalid consumer name"
        );
        Self {
            name: name.to_owned(),
            router: Router::new(),
            table: Vec::new(),
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// A read-only route. It must not change anything.
    pub fn get<H, T>(mut self, path: &str, handler: H) -> Self
    where
        H: Handler<T, ()>,
        T: 'static,
    {
        self.table.push(format!("GET /api/{}{path}", self.name));
        self.router = self.router.route(path, get(handler));
        self
    }

    /// A state-changing route: `POST` with a JSON body only.
    pub fn post<H, T>(mut self, path: &str, handler: H) -> Self
    where
        H: Handler<T, ()>,
        T: 'static,
    {
        self.table.push(format!("POST /api/{}{path}", self.name));
        self.router = self.router.route(
            path,
            post(handler).route_layer(middleware::from_fn(require_json)),
        );
        self
    }

    pub(crate) fn table(&self) -> &[String] {
        &self.table
    }
}

/// An id in a phone request (path or JSON): 1–64 letters, digits, `-` or `_`. Anything else is a 400.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PhoneId(String);

impl PhoneId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for PhoneId {
    type Error = &'static str;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        if !s.is_empty()
            && s.len() <= 64
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            Ok(Self(s))
        } else {
            Err("invalid id")
        }
    }
}

impl From<PhoneId> for String {
    fn from(id: PhoneId) -> Self {
        id.0
    }
}

/// A JSON body: `Content-Type: application/json` (415 otherwise) that parses into `T` (400 otherwise;
/// give `T` `#[serde(deny_unknown_fields)]` so unknown fields are a 400 too).
pub struct PhoneJson<T>(pub T);

impl<S, T> FromRequest<S> for PhoneJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = Response;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        if !is_json(req.headers()) {
            return Err(error(StatusCode::UNSUPPORTED_MEDIA_TYPE));
        }
        let bytes = Bytes::from_request(req, state)
            .await
            .map_err(|_| error(StatusCode::BAD_REQUEST))?;
        serde_json::from_slice(&bytes)
            .map(PhoneJson)
            .map_err(|_| error(StatusCode::BAD_REQUEST))
    }
}

/// Path parameters; a value that does not fit `T` (e.g. a bad [`PhoneId`]) is a 400.
pub struct PhonePath<T>(pub T);

impl<S, T> FromRequestParts<S> for PhonePath<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Path::<T>::from_request_parts(parts, state)
            .await
            .map(|Path(t)| PhonePath(t))
            .map_err(|_| error(StatusCode::BAD_REQUEST))
    }
}

/// The fixed routes; consumer routes come after them.
pub(crate) const FIXED_ROUTES: [&str; 3] = ["GET /", "GET /assets/{file}", "GET /api/session"];

/// The application for one opening.
pub(crate) fn router(opening: Arc<Opening>, consumers: &[ConsumerRoutes]) -> Router {
    let mut api = Router::new().route("/session", get(session));
    for c in consumers {
        api = api.nest(&format!("/{}", c.name), c.router.clone());
    }
    let api = api
        .fallback(not_found)
        .layer(middleware::from_fn_with_state(
            opening.clone(),
            require_token,
        ));
    Router::new()
        .route("/", get(page))
        .route("/assets/{file}", get(asset))
        .with_state(opening.clone())
        .nest("/api", api)
        .fallback(not_found)
        .layer(middleware::from_fn_with_state(opening.clone(), read_body))
        .layer(middleware::from_fn_with_state(opening.clone(), same_origin))
        .layer(middleware::from_fn_with_state(opening, rate_limit))
        .layer(middleware::from_fn(request_clock))
        .layer(middleware::map_response(security_headers))
}

/// `{"error":"<code>"}` with the status. The 403 body is the same for every reason.
pub(crate) fn error(status: StatusCode) -> Response {
    let code = match status {
        StatusCode::FORBIDDEN => "forbidden",
        StatusCode::NOT_FOUND => "notFound",
        StatusCode::BAD_REQUEST => "badRequest",
        StatusCode::PAYLOAD_TOO_LARGE => "tooLarge",
        StatusCode::UNSUPPORTED_MEDIA_TYPE => "unsupportedMediaType",
        StatusCode::TOO_MANY_REQUESTS => "tooManyRequests",
        StatusCode::MISDIRECTED_REQUEST => "misdirected",
        StatusCode::REQUEST_TIMEOUT => "timeout",
        StatusCode::METHOD_NOT_ALLOWED => "methodNotAllowed",
        _ => "error",
    };
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        format!("{{\"error\":\"{code}\"}}"),
    )
        .into_response()
}

async fn security_headers(res: Response) -> Response {
    // axum's own 405 has an empty body; give it the same shape as every other error.
    let mut res = if res.status() == StatusCode::METHOD_NOT_ALLOWED
        && !res.headers().contains_key(header::CONTENT_TYPE)
    {
        let mut e = error(StatusCode::METHOD_NOT_ALLOWED);
        if let Some(allow) = res.headers().get(header::ALLOW) {
            e.headers_mut().insert(header::ALLOW, allow.clone());
        }
        e
    } else {
        res
    };
    let h = res.headers_mut();
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP),
    );
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    h.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    res
}

async fn request_clock(
    Extension(clock): Extension<ConnClock>,
    mut req: Request,
    next: Next,
) -> Response {
    let start = clock.take().unwrap_or_else(Instant::now);
    req.extensions_mut().insert(RequestStart(start));
    let res = next.run(req).await;
    // Bytes read from now on belong to the next request.
    clock.clear();
    res
}

async fn rate_limit(
    State(o): State<Arc<Opening>>,
    Extension(Peer(ip)): Extension<Peer>,
    req: Request,
    next: Next,
) -> Response {
    match o.limiter.hit(ip, o.clock.now_ms()) {
        Ok(()) => next.run(req).await,
        Err(retry) => {
            let mut res = error(StatusCode::TOO_MANY_REQUESTS);
            res.headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(retry.0));
            res
        }
    }
}

async fn same_origin(State(o): State<Arc<Opening>>, req: Request, next: Next) -> Response {
    let host_ok = req
        .headers()
        .get(header::HOST)
        .is_some_and(|h| h.as_bytes() == o.host.as_bytes())
        && req.uri().authority().is_none_or(|a| a.as_str() == o.host);
    if !host_ok {
        return error(StatusCode::MISDIRECTED_REQUEST);
    }
    let origin_ok = match req.headers().get(header::ORIGIN) {
        Some(origin) => origin.as_bytes() == o.origin.as_bytes(),
        // Browsers send Origin with every POST; a POST without one is not from this page.
        None => req.method() != Method::POST,
    };
    if !origin_ok {
        return error(StatusCode::FORBIDDEN);
    }
    next.run(req).await
}

async fn read_body(State(o): State<Arc<Opening>>, req: Request, next: Next) -> Response {
    let max = o.limits.max_body;
    let declared = req
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    if declared.is_some_and(|n| n > max as u64) {
        return error(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let start = req
        .extensions()
        .get::<RequestStart>()
        .map_or_else(Instant::now, |s| s.0);
    let deadline = tokio::time::Instant::from_std(start + o.limits.request_timeout);
    let (parts, body) = req.into_parts();
    let bytes = match tokio::time::timeout_at(deadline, axum::body::to_bytes(body, max)).await {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(_)) => return error(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => {
            // Too slow (slowloris): answer and drop the connection.
            let mut res = error(StatusCode::REQUEST_TIMEOUT);
            res.headers_mut()
                .insert(header::CONNECTION, HeaderValue::from_static("close"));
            return res;
        }
    };
    next.run(Request::from_parts(parts, Body::from(bytes)))
        .await
}

/// The token from `Authorization: Bearer <token>`, if the header has exactly that shape.
fn bearer(headers: &HeaderMap) -> Option<&str> {
    let mut values = headers.get_all(header::AUTHORIZATION).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()?.strip_prefix("Bearer ")
}

async fn require_token(
    State(o): State<Arc<Opening>>,
    Extension(Peer(ip)): Extension<Peer>,
    mut req: Request,
    next: Next,
) -> Response {
    let valid = bearer(req.headers()).is_some_and(|t| o.token.matches(t));
    if !valid {
        o.limiter.failed(ip);
        return error(StatusCode::FORBIDDEN);
    }
    req.extensions_mut().insert(PhoneSession {
        meeting_id: o.meeting_id.clone(),
    });
    next.run(req).await
}

async fn require_json(req: Request, next: Next) -> Response {
    if !is_json(req.headers()) {
        return error(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    next.run(req).await
}

fn is_json(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
}

fn file(asset: Asset) -> Response {
    ([(header::CONTENT_TYPE, asset.mime)], asset.bytes).into_response()
}

async fn page(State(o): State<Arc<Opening>>) -> Response {
    o.assets
        .page()
        .map_or_else(|| error(StatusCode::NOT_FOUND), file)
}

/// `/assets/<name>`: the raw (still percent-encoded) name must be a plain file name and is looked up
/// in the embedded table only, so `..`, `%2e%2e`, `%2f` or folders can only miss (404).
async fn asset(State(o): State<Arc<Opening>>, req: Request) -> Response {
    let name = req.uri().path().strip_prefix("/assets/").unwrap_or("");
    let plain = !name.is_empty()
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'));
    match plain.then(|| o.assets.asset(name)).flatten() {
        Some(a) => file(a),
        None => error(StatusCode::NOT_FOUND),
    }
}

/// `GET /api/session`: 204 for a phone holding the current token (the token check runs before).
async fn session() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn not_found() -> Response {
    error(StatusCode::NOT_FOUND)
}
