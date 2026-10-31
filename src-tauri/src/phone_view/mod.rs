//! The local phone web view (job 012): the app's only listening network port, and only while a person
//! opened it during a recording.
//!
//! - It opens on request ([`PhoneViewServer::open`]) and only while the meeting records. It binds one
//!   private IPv4 address of this device on a random port ([`net::choose_address`]), never `0.0.0.0`,
//!   `::` or a public address.
//! - It closes on request, when recording stops, when the meeting ends and when the app exits; within
//!   [`CLOSE_WAIT`] the listener and every open connection are gone, and a `phone-view-state` event
//!   says why.
//! - Every opening has a new [`PhoneViewToken`] (256 bits, OS RNG). It travels only in the URL
//!   fragment and in `Authorization: Bearer`, is compared in constant time, and is never logged.
//! - Phones get the static phone page and `GET /api/session` (204). Consumers (voice profiles, team
//!   review) add routes under `/api/<consumer>/` through [`ConsumerRoutes`]; they pass the same checks
//!   ([`http`]). No route of this module returns anything from the meeting.

pub mod assets;
pub mod http;
pub mod net;
pub mod qr;
pub mod rate;
mod server;
pub mod token;

#[cfg(test)]
pub(crate) mod tests;

use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Serialize, Serializer};

use crate::recording::{Capture, CaptureState};
use assets::{EmbeddedAssets, PhoneAssets};
pub use http::{ConsumerRoutes, PhoneId, PhoneJson, PhonePath, PhoneSession};
use net::NetInterfaces;
use rate::{Clock, RateLimiter, RateLimits, SystemClock};
pub use token::PhoneViewToken;

/// How long closing may take until the port and every connection are gone.
pub const CLOSE_WAIT: Duration = Duration::from_secs(1);

/// The limits of the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Largest request body (413 above).
    pub max_body: usize,
    /// Headers and body must be complete within this time of the request's first byte.
    pub request_timeout: Duration,
    /// Connections served at once; further ones are closed at once.
    pub max_connections: usize,
    pub rate: RateLimits,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_body: 4 * 1024,
            request_timeout: Duration::from_secs(10),
            max_connections: 32,
            rate: RateLimits::default(),
        }
    }
}

/// Why `phone_view_open` failed; the UI shows the translated key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhoneViewError {
    /// The meeting is not recording; nothing was opened.
    NotRecording,
    /// No private IPv4 address on an interface that is up.
    NoLocalNetwork,
    /// The port could not be opened.
    Failed,
}

impl PhoneViewError {
    pub fn key(self) -> &'static str {
        match self {
            Self::NotRecording => "phoneView.error.notRecording",
            Self::NoLocalNetwork => "phoneView.error.noLocalNetwork",
            Self::Failed => "phoneView.error.failed",
        }
    }
}

/// Sent to the UI as `{ "key": "phoneView.error.…" }`.
impl Serialize for PhoneViewError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("PhoneViewError", 1)?;
        st.serialize_field("key", self.key())?;
        st.end()
    }
}

/// What `phone_view_open` returns: the URL (with the token in its fragment) and its QR code.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneViewOpened {
    pub url: String,
    pub qr_svg: String,
}

/// Redacted: the URL holds the token.
impl std::fmt::Debug for PhoneViewOpened {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PhoneViewOpened(<redacted>)")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PhoneState {
    Open,
    Closed,
}

/// Why the view closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseReason {
    /// `phone_view_close` (the consumer's toggle).
    Requested,
    /// Recording stopped, failed or moved to another meeting.
    RecordingStopped,
    MeetingEnded,
    AppExit,
}

/// The `phone-view-state` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneViewState {
    pub state: PhoneState,
    pub meeting_id: Option<String>,
    /// Set when closed.
    pub reason: Option<CloseReason>,
}

/// Where the view's state changes go. The app emits `phone-view-state`; tests collect them.
pub trait PhoneEvents: Send + Sync {
    fn state(&self, state: &PhoneViewState);
}

pub struct NoPhoneEvents;

impl PhoneEvents for NoPhoneEvents {
    fn state(&self, _: &PhoneViewState) {}
}

struct Open {
    meeting_id: String,
    opened: PhoneViewOpened,
    address: SocketAddrV4,
    server: server::Running,
}

/// The phone view: its lifecycle, the consumers' routes and, while open, the server.
pub struct PhoneViewServer {
    runtime: tokio::runtime::Handle,
    interfaces: Arc<dyn NetInterfaces>,
    events: Arc<dyn PhoneEvents>,
    assets: Arc<dyn PhoneAssets>,
    clock: Arc<dyn Clock>,
    limits: Limits,
    /// Kept across openings: closing and reopening does not reset an address's window.
    limiter: Arc<RateLimiter>,
    consumers: Mutex<Vec<ConsumerRoutes>>,
    current: Mutex<Option<Open>>,
    /// Tests bind 127.0.0.1 instead of the chosen address (the choice itself still runs).
    #[cfg(test)]
    bind_loopback: bool,
}

impl PhoneViewServer {
    /// A closed view whose server will run on `runtime` (the app passes Tauri's).
    pub fn new(
        runtime: tokio::runtime::Handle,
        interfaces: Arc<dyn NetInterfaces>,
        events: Arc<dyn PhoneEvents>,
    ) -> Self {
        let limits = Limits::default();
        Self {
            runtime,
            interfaces,
            events,
            assets: Arc::new(EmbeddedAssets),
            clock: Arc::new(SystemClock::new()),
            limits,
            limiter: Arc::new(RateLimiter::new(limits.rate)),
            consumers: Mutex::new(Vec::new()),
            current: Mutex::new(None),
            #[cfg(test)]
            bind_loopback: false,
        }
    }

    pub fn with_assets(mut self, assets: Arc<dyn PhoneAssets>) -> Self {
        self.assets = assets;
        self
    }

    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = clock;
        self
    }

    pub fn with_limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self.limiter = Arc::new(RateLimiter::new(limits.rate));
        self
    }

    #[cfg(test)]
    pub(crate) fn binding_loopback(mut self) -> Self {
        self.bind_loopback = true;
        self
    }

    fn current(&self) -> MutexGuard<'_, Option<Open>> {
        self.current.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Adds a consumer's routes under `/api/<name>/`, from the next opening on. A second consumer with
    /// the same name is refused.
    pub fn register(&self, routes: ConsumerRoutes) -> Result<(), ConsumerRoutes> {
        let mut consumers = self.consumers.lock().unwrap_or_else(|e| e.into_inner());
        if consumers.iter().any(|c| c.name() == routes.name()) {
            return Err(routes);
        }
        consumers.push(routes);
        Ok(())
    }

    /// Every route the server answers (`METHOD path`), for review and the route-table test.
    pub fn route_table(&self) -> Vec<String> {
        let consumers = self.consumers.lock().unwrap_or_else(|e| e.into_inner());
        http::FIXED_ROUTES
            .iter()
            .map(|r| (*r).to_owned())
            .chain(consumers.iter().flat_map(|c| c.table().iter().cloned()))
            .collect()
    }

    /// Opens the view for `meeting_id`, if `recording(meeting_id)` says the meeting records right now
    /// (checked under the view's lock, so a stop cannot slip in between). Opening it again for the
    /// same meeting returns the current URL and keeps its token.
    pub fn open(
        &self,
        meeting_id: &str,
        recording: impl FnOnce(&str) -> bool,
    ) -> Result<PhoneViewOpened, PhoneViewError> {
        let mut current = self.current();
        if !recording(meeting_id) {
            return Err(PhoneViewError::NotRecording);
        }
        if let Some(open) = current.as_ref() {
            if open.meeting_id == meeting_id {
                return Ok(open.opened.clone());
            }
            self.close_locked(&mut current, CloseReason::RecordingStopped);
        }
        let chosen = net::choose_address(self.interfaces.as_ref())
            .map_err(|_| PhoneViewError::NoLocalNetwork)?;
        let ip = self.bind_address(chosen);
        let listener = std::net::TcpListener::bind(SocketAddrV4::new(ip, 0)).map_err(|e| {
            crate::log!("the phone view could not open a port: {}", e.kind());
            PhoneViewError::Failed
        })?;
        let address = match listener.local_addr() {
            Ok(std::net::SocketAddr::V4(a)) if a.ip() == &ip => a,
            _ => return Err(PhoneViewError::Failed),
        };
        let token = PhoneViewToken::new();
        let url = format!("http://{address}/#t={}", token.expose());
        let qr_svg = qr::qr_svg(&url).map_err(|_| PhoneViewError::Failed)?;
        let opening = Arc::new(http::Opening {
            token,
            meeting_id: meeting_id.to_owned(),
            host: address.to_string(),
            origin: format!("http://{address}"),
            limiter: self.limiter.clone(),
            clock: self.clock.clone(),
            limits: self.limits,
            assets: self.assets.clone(),
        });
        let app = {
            let consumers = self.consumers.lock().unwrap_or_else(|e| e.into_inner());
            http::router(opening, &consumers)
        };
        let server =
            server::Running::spawn(&self.runtime, listener, app, self.limits).map_err(|e| {
                crate::log!("the phone view could not start: {}", e.kind());
                PhoneViewError::Failed
            })?;
        let opened = PhoneViewOpened { url, qr_svg };
        *current = Some(Open {
            meeting_id: meeting_id.to_owned(),
            opened: opened.clone(),
            address,
            server,
        });
        crate::log!("phone view opened");
        self.events.state(&PhoneViewState {
            state: PhoneState::Open,
            meeting_id: Some(meeting_id.to_owned()),
            reason: None,
        });
        Ok(opened)
    }

    #[cfg(test)]
    fn bind_address(&self, chosen: Ipv4Addr) -> Ipv4Addr {
        if self.bind_loopback {
            Ipv4Addr::LOCALHOST
        } else {
            chosen
        }
    }

    #[cfg(not(test))]
    fn bind_address(&self, chosen: Ipv4Addr) -> Ipv4Addr {
        chosen
    }

    /// Closes the view, if open. Returns whether it was open.
    pub fn close(&self, reason: CloseReason) -> bool {
        let mut current = self.current();
        self.close_locked(&mut current, reason)
    }

    fn close_locked(&self, current: &mut Option<Open>, reason: CloseReason) -> bool {
        let Some(open) = current.take() else {
            return false;
        };
        if !open.server.stop(CLOSE_WAIT) {
            crate::log!("the phone view did not close in time");
        }
        crate::log!("phone view closed ({reason:?})");
        self.events.state(&PhoneViewState {
            state: PhoneState::Closed,
            meeting_id: Some(open.meeting_id),
            reason: Some(reason),
        });
        true
    }

    /// Called with every capture state: the view stays open only while its meeting records or is
    /// paused. Stopped, failed, or another meeting: closed.
    pub fn on_capture(&self, state: &CaptureState) {
        let mut current = self.current();
        let keep = current.as_ref().is_some_and(|open| {
            state.meeting_id.as_deref() == Some(open.meeting_id.as_str())
                && matches!(state.state, Capture::Recording | Capture::Paused)
        });
        if !keep {
            self.close_locked(&mut current, CloseReason::RecordingStopped);
        }
    }

    /// The meeting ended: its view closes.
    pub fn on_meeting_ended(&self, meeting_id: &str) {
        let mut current = self.current();
        if current.as_ref().is_some_and(|o| o.meeting_id == meeting_id) {
            self.close_locked(&mut current, CloseReason::MeetingEnded);
        }
    }

    pub fn is_open(&self) -> bool {
        self.current().is_some()
    }

    /// The bound address while open.
    pub fn address(&self) -> Option<SocketAddrV4> {
        self.current().as_ref().map(|o| o.address)
    }
}

impl Drop for PhoneViewServer {
    fn drop(&mut self) {
        self.close(CloseReason::AppExit);
    }
}
