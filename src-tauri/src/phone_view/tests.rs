//! The phone view over real sockets on loopback only: `FakeNetInterfaces` choose the address, and the
//! server binds 127.0.0.1 instead. A raw HTTP/1.1 client sends exactly the bytes each case needs.
//! Tests that open ports hold [`NET`], so the port scan sees only its own test's sockets.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use axum::http::StatusCode;
use axum::{Extension, Json};
use serde::Deserialize;

use super::assets::StaticAssets;
use super::net::{FakeNetInterfaces, NetInterface};
use super::rate::ManualClock;
use super::*;

static NET: Mutex<()> = Mutex::new(());

/// A closed view for tests that never open it (on a shared test runtime).
pub(crate) fn idle() -> PhoneViewServer {
    static RT: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    let rt = RT.get_or_init(|| tokio::runtime::Runtime::new().unwrap());
    PhoneViewServer::new(
        rt.handle().clone(),
        Arc::new(FakeNetInterfaces::home_wifi()),
        Arc::new(NoPhoneEvents),
    )
}

pub(crate) fn net_lock() -> MutexGuard<'static, ()> {
    NET.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Default)]
pub(crate) struct Events(Mutex<Vec<PhoneViewState>>);

impl Events {
    pub(crate) fn all(&self) -> Vec<PhoneViewState> {
        self.0.lock().unwrap().clone()
    }
    pub(crate) fn closed(&self) -> Vec<CloseReason> {
        self.all()
            .into_iter()
            .filter(|s| s.state == PhoneState::Closed)
            .filter_map(|s| s.reason)
            .collect()
    }
}

impl PhoneEvents for Events {
    fn state(&self, state: &PhoneViewState) {
        self.0.lock().unwrap().push(state.clone());
    }
}

/// The view, its events and clock, and the runtime it runs on (dropped last). Holds [`NET`].
struct Rig {
    view: Option<PhoneViewServer>,
    events: Arc<Events>,
    clock: Arc<ManualClock>,
    // Kept alive for the view; read directly only by the Linux-only test below.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    rt: tokio::runtime::Runtime,
    _net: MutexGuard<'static, ()>,
}

impl Drop for Rig {
    fn drop(&mut self) {
        drop(self.view.take());
    }
}

const MEETING: &str = "m-1";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Item {
    id: PhoneId,
    note: String,
}

/// A consumer like 010 will add: one read route and one state-changing route.
fn test_consumer() -> ConsumerRoutes {
    ConsumerRoutes::new("test")
        .get("/ping", || async { StatusCode::NO_CONTENT })
        .post(
            "/items/{id}",
            |PhonePath(id): PhonePath<PhoneId>,
             Extension(session): Extension<PhoneSession>,
             PhoneJson(item): PhoneJson<Item>| async move {
                assert_eq!(session.meeting_id, MEETING);
                Json(serde_json::json!({
                    "path": id.as_str(),
                    "id": item.id.as_str(),
                    "noteLength": item.note.len(),
                }))
            },
        )
}

fn rig_with(limits: Limits) -> Rig {
    let net = net_lock();
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let events = Arc::new(Events::default());
    let clock = Arc::new(ManualClock::default());
    let view = PhoneViewServer::new(
        rt.handle().clone(),
        Arc::new(FakeNetInterfaces::home_wifi()),
        events.clone(),
    )
    .with_assets(Arc::new(StaticAssets::sample()))
    .with_clock(clock.clone())
    .with_limits(limits)
    .binding_loopback();
    view.register(test_consumer()).ok().unwrap();
    Rig {
        view: Some(view),
        events,
        clock,
        rt,
        _net: net,
    }
}

fn rig() -> Rig {
    rig_with(Limits::default())
}

impl Rig {
    fn view(&self) -> &PhoneViewServer {
        self.view.as_ref().unwrap()
    }

    /// Opens for [`MEETING`] (recording) and returns the address and token.
    fn open(&self) -> (SocketAddrV4, String) {
        self.open_for(MEETING)
    }

    fn open_for(&self, meeting: &str) -> (SocketAddrV4, String) {
        let opened = self.view().open(meeting, |_| true).unwrap();
        let (addr, token) = split_url(&opened.url);
        assert_eq!(self.view().address(), Some(addr));
        (addr, token)
    }
}

fn split_url(url: &str) -> (SocketAddrV4, String) {
    let rest = url.strip_prefix("http://").unwrap();
    let (addr, fragment) = rest.split_once("/#t=").unwrap();
    (addr.parse().unwrap(), fragment.to_owned())
}

// ---- a raw HTTP/1.1 client ----------------------------------------------------------------------

#[derive(Debug)]
struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

struct Req {
    head: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Req {
    fn new(method: &str, path: &str, addr: SocketAddrV4) -> Self {
        Self {
            head: format!("{method} {path} HTTP/1.1"),
            headers: vec![("Host".into(), addr.to_string())],
            body: Vec::new(),
        }
    }
    fn get(path: &str, addr: SocketAddrV4) -> Self {
        Self::new("GET", path, addr)
    }
    fn set(mut self, name: &str, value: &str) -> Self {
        self.headers.retain(|(k, _)| !k.eq_ignore_ascii_case(name));
        self.headers.push((name.into(), value.into()));
        self
    }
    fn without(mut self, name: &str) -> Self {
        self.headers.retain(|(k, _)| !k.eq_ignore_ascii_case(name));
        self
    }
    fn bearer(self, token: &str) -> Self {
        self.set("Authorization", &format!("Bearer {token}"))
    }
    /// A POST from the page: JSON body, its Origin.
    fn post_json(path: &str, addr: SocketAddrV4, token: &str, body: &str) -> Self {
        let mut r = Self::new("POST", path, addr)
            .bearer(token)
            .set("Origin", &format!("http://{addr}"))
            .set("Content-Type", "application/json");
        r.body = body.as_bytes().to_vec();
        r
    }
    fn bytes(&self) -> Vec<u8> {
        let mut out = format!("{}\r\n", self.head);
        for (k, v) in &self.headers {
            out.push_str(&format!("{k}: {v}\r\n"));
        }
        let chunked = self
            .headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("transfer-encoding"));
        if !self.body.is_empty()
            && !chunked
            && !self
                .headers
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        {
            out.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
        }
        out.push_str("\r\n");
        let mut bytes = out.into_bytes();
        bytes.extend_from_slice(&self.body);
        bytes
    }
    fn send(&self, addr: SocketAddrV4) -> Reply {
        let mut s = connect(addr);
        self.send_on(&mut s)
    }
    fn send_on(&self, s: &mut TcpStream) -> Reply {
        s.write_all(&self.bytes()).unwrap();
        read_reply(s).expect("a reply")
    }
}

fn connect(addr: SocketAddrV4) -> TcpStream {
    let s = TcpStream::connect_timeout(&SocketAddr::V4(addr), Duration::from_secs(2)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    s
}

/// Reads one response (status line, headers, Content-Length body). `None` if the connection closed
/// or failed before a status line.
fn read_reply(s: &mut TcpStream) -> Option<Reply> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    while !buf.ends_with(b"\r\n\r\n") {
        match s.read(&mut byte) {
            Ok(1) => buf.push(byte[0]),
            _ => return None,
        }
    }
    let head = String::from_utf8(buf).unwrap();
    let mut lines = head.split("\r\n");
    let status = lines.next()?.split(' ').nth(1)?.parse().ok()?;
    let headers: Vec<(String, String)> = lines
        .filter(|l| !l.is_empty())
        .map(|l| {
            let (k, v) = l.split_once(':').unwrap();
            (k.trim().to_owned(), v.trim().to_owned())
        })
        .collect();
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .map_or(0, |(_, v)| v.parse().unwrap());
    let mut body = vec![0u8; len];
    s.read_exact(&mut body).ok()?;
    Some(Reply {
        status,
        headers,
        body,
    })
}

/// Whether the server closed `s` (EOF or reset) within `within`.
fn closed_within(s: &mut TcpStream, within: Duration) -> bool {
    s.set_read_timeout(Some(within)).unwrap();
    let mut buf = [0u8; 256];
    let start = Instant::now();
    loop {
        match s.read(&mut buf) {
            Ok(0) => return true,
            Ok(_) => continue,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                return false
            }
            Err(_) => return start.elapsed() <= within,
        }
    }
}

pub(crate) fn refused(addr: SocketAddrV4) -> bool {
    TcpStream::connect_timeout(&SocketAddr::V4(addr), Duration::from_millis(500)).is_err()
}

/// The listening TCP sockets of this process (address, port), from /proc. A full port scan of every
/// address (loopback, the chosen one, 0.0.0.0, ::) at once.
#[cfg(target_os = "linux")]
pub(crate) fn listening() -> Vec<(String, u16)> {
    let inodes: Vec<String> = std::fs::read_dir("/proc/self/fd")
        .unwrap()
        .flatten()
        .filter_map(|e| std::fs::read_link(e.path()).ok())
        .filter_map(|l| {
            l.to_string_lossy()
                .strip_prefix("socket:[")
                .map(|s| s.trim_end_matches(']').to_owned())
        })
        .collect();
    let mut out = Vec::new();
    for (file, v6) in [("/proc/self/net/tcp", false), ("/proc/self/net/tcp6", true)] {
        let Ok(table) = std::fs::read_to_string(file) else {
            continue;
        };
        for line in table.lines().skip(1) {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 10 || f[3] != "0A" || !inodes.iter().any(|i| i == f[9]) {
                continue;
            }
            let (ip, port) = f[1].split_once(':').unwrap();
            let port = u16::from_str_radix(port, 16).unwrap();
            let ip = if v6 {
                format!("v6:{ip}")
            } else {
                Ipv4Addr::from(u32::from_str_radix(ip, 16).unwrap().swap_bytes()).to_string()
            };
            out.push((ip, port));
        }
    }
    out
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn listening() -> Vec<(String, u16)> {
    Vec::new()
}

const HEADERS: [(&str, &str); 5] = [
    ("Content-Security-Policy", http::CSP),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("Cache-Control", "no-store"),
    ("X-Frame-Options", "DENY"),
];

fn assert_security_headers(r: &Reply, what: &str) {
    for (name, value) in HEADERS {
        assert_eq!(r.header(name), Some(value), "{what}: {name}");
    }
}

fn recording_state(state: Capture, meeting: Option<&str>) -> CaptureState {
    CaptureState {
        state,
        meeting_id: meeting.map(str::to_owned),
        elapsed_ms: 0,
        level: 0.0,
        reason: None,
    }
}

// ---- AC1: opens only on request, closes reliably ------------------------------------------------

#[test]
fn ac1_no_port_before_opening_one_while_open_none_after_closing() {
    let r = rig();
    assert_eq!(listening(), vec![], "a port before phone_view_open");
    assert!(!r.view().is_open());
    let (addr, token) = r.open();
    assert_eq!(*addr.ip(), Ipv4Addr::LOCALHOST);
    assert_ne!(addr.port(), 0);
    #[cfg(target_os = "linux")]
    assert_eq!(
        listening(),
        vec![(addr.ip().to_string(), addr.port())],
        "exactly the one port, on the one address"
    );
    assert_eq!(
        Req::get("/api/session", addr)
            .bearer(&token)
            .send(addr)
            .status,
        204
    );
    assert!(r.view().close(CloseReason::Requested));
    assert_eq!(listening(), vec![]);
    assert!(refused(addr));
    assert!(refused(SocketAddrV4::new(Ipv4Addr::LOCALHOST, addr.port())));
}

#[test]
fn ac1_the_port_is_random_per_opening() {
    let r = rig();
    let ports: Vec<u16> = (0..3)
        .map(|_| {
            let (a, _) = r.open();
            r.view().close(CloseReason::Requested);
            a.port()
        })
        .collect();
    assert!(ports.iter().all(|p| *p >= 1024));
    // The OS hands out ephemeral ports; three in a row are not all the same.
    assert!(ports.windows(2).any(|w| w[0] != w[1]), "{ports:?}");
}

#[test]
fn ac1_not_recording_fails_with_its_key_and_opens_nothing() {
    let r = rig();
    let err = r.view().open(MEETING, |_| false).unwrap_err();
    assert_eq!(err, PhoneViewError::NotRecording);
    assert_eq!(
        serde_json::to_value(err).unwrap(),
        serde_json::json!({ "key": "phoneView.error.notRecording" })
    );
    assert!(!r.view().is_open());
    assert_eq!(listening(), vec![]);
    assert_eq!(r.events.all(), vec![]);
}

#[test]
fn ac1_without_a_local_network_it_fails_with_its_key() {
    let _net = net_lock();
    let rt = tokio::runtime::Runtime::new().unwrap();
    for interfaces in [
        FakeNetInterfaces::default(),
        FakeNetInterfaces {
            interfaces: vec![
                FakeNetInterfaces::iface("lo", Ipv4Addr::LOCALHOST, true, true),
                FakeNetInterfaces::iface("wwan0", Ipv4Addr::new(81, 2, 3, 4), true, false),
                FakeNetInterfaces::iface("wlan0", Ipv4Addr::new(192, 168, 1, 2), false, false),
            ],
            default_route: Some("wwan0".into()),
        },
    ] {
        let view = PhoneViewServer::new(
            rt.handle().clone(),
            Arc::new(interfaces),
            Arc::new(NoPhoneEvents),
        )
        .binding_loopback();
        let err = view.open(MEETING, |_| true).unwrap_err();
        assert_eq!(err, PhoneViewError::NoLocalNetwork);
        assert_eq!(err.key(), "phoneView.error.noLocalNetwork");
        assert!(!view.is_open());
        assert_eq!(listening(), vec![]);
    }
}

/// Without the tests' loopback substitution the view binds exactly the chosen address: one this
/// device does not have fails, instead of falling back to 0.0.0.0.
#[test]
fn ac1_it_binds_exactly_the_chosen_address_never_a_wildcard() {
    let _net = net_lock();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let interfaces = FakeNetInterfaces {
        interfaces: vec![NetInterface {
            name: "wlan0".into(),
            // TEST-NET style private address that no test machine has.
            ipv4: Ipv4Addr::new(10, 255, 254, 253),
            up: true,
            loopback: false,
        }],
        default_route: None,
    };
    let events = Arc::new(Events::default());
    let view = PhoneViewServer::new(rt.handle().clone(), Arc::new(interfaces), events.clone());
    assert_eq!(
        view.open(MEETING, |_| true).unwrap_err(),
        PhoneViewError::Failed
    );
    assert!(!view.is_open());
    assert_eq!(listening(), vec![]);
    assert_eq!(events.all(), vec![]);
}

#[test]
fn ac1_a_second_open_for_the_same_meeting_returns_the_same_url() {
    let r = rig();
    let first = r.view().open(MEETING, |_| true).unwrap();
    let again = r.view().open(MEETING, |_| true).unwrap();
    assert_eq!(first, again);
    assert_eq!(r.events.all().len(), 1);
    // Not while the meeting stopped recording, though.
    assert_eq!(
        r.view().open(MEETING, |_| false).unwrap_err(),
        PhoneViewError::NotRecording
    );
}

/// Opens the view, holds a keep-alive connection that already got an answer, runs `trigger`, and
/// checks: within 1 s new connections are refused, the open connection is dropped, the port is gone,
/// and one `closed` event names `reason`.
fn closes_on(trigger: impl FnOnce(&mut Rig), reason: CloseReason) {
    let mut r = rig();
    let (addr, token) = r.open();
    let mut kept = connect(addr);
    let reply = Req::get("/api/session", addr)
        .bearer(&token)
        .send_on(&mut kept);
    assert_eq!(reply.status, 204);
    let start = Instant::now();
    trigger(&mut r);
    assert!(refused(addr), "{reason:?}: new connections refused");
    assert!(
        closed_within(&mut kept, Duration::from_millis(200)),
        "{reason:?}: keep-alive connection dropped"
    );
    assert!(start.elapsed() < Duration::from_secs(1), "{reason:?}");
    assert_eq!(listening(), vec![]);
    assert_eq!(r.events.closed(), vec![reason]);
    let last = r.events.all().pop().unwrap();
    assert_eq!(last.state, PhoneState::Closed);
    assert_eq!(last.meeting_id.as_deref(), Some(MEETING));
    assert!(r.view.as_ref().is_none_or(|v| !v.is_open()));
}

#[test]
fn ac1_closes_on_request() {
    closes_on(
        |r| assert!(r.view().close(CloseReason::Requested)),
        CloseReason::Requested,
    );
}

#[test]
fn ac1_closes_when_recording_stops_fails_or_moves_to_another_meeting() {
    closes_on(
        |r| r.view().on_capture(&recording_state(Capture::Off, None)),
        CloseReason::RecordingStopped,
    );
    closes_on(
        |r| {
            r.view()
                .on_capture(&recording_state(Capture::Error, Some(MEETING)))
        },
        CloseReason::RecordingStopped,
    );
    closes_on(
        |r| {
            r.view()
                .on_capture(&recording_state(Capture::Recording, Some("m-2")))
        },
        CloseReason::RecordingStopped,
    );
}

#[test]
fn ac1_pausing_keeps_the_view_open() {
    let r = rig();
    let (addr, token) = r.open();
    r.view()
        .on_capture(&recording_state(Capture::Recording, Some(MEETING)));
    r.view()
        .on_capture(&recording_state(Capture::Paused, Some(MEETING)));
    assert!(r.view().is_open());
    assert_eq!(
        Req::get("/api/session", addr)
            .bearer(&token)
            .send(addr)
            .status,
        204
    );
    assert_eq!(r.events.closed(), vec![]);
}

#[test]
fn ac1_closes_when_the_meeting_ends() {
    closes_on(
        |r| {
            // Another meeting ending changes nothing.
            r.view().on_meeting_ended("m-2");
            assert!(r.view().is_open());
            r.view().on_meeting_ended(MEETING);
        },
        CloseReason::MeetingEnded,
    );
}

#[test]
fn ac1_closes_when_the_app_exits() {
    closes_on(|r| drop(r.view.take()), CloseReason::AppExit);
}

#[test]
fn ac1_closing_a_closed_view_sends_nothing() {
    let r = rig();
    assert!(!r.view().close(CloseReason::Requested));
    r.view().on_capture(&recording_state(Capture::Off, None));
    assert_eq!(r.events.all(), vec![]);
}

// ---- AC2: the token -----------------------------------------------------------------------------

#[test]
fn ac2_the_url_carries_a_fresh_token_only_in_its_fragment() {
    let r = rig();
    let opened = r.view().open(MEETING, |_| true).unwrap();
    let (addr, token) = split_url(&opened.url);
    assert_eq!(opened.url, format!("http://{addr}/#t={token}"));
    assert!(PhoneViewToken::is_well_formed(&token));
    assert!(!opened.url.contains('?'));
    assert_eq!(format!("{opened:?}"), "PhoneViewOpened(<redacted>)");
    r.view().close(CloseReason::Requested);
    let (_, second) = r.open();
    assert_ne!(token, second);
}

#[test]
fn ac2_missing_malformed_wrong_old_and_foreign_tokens_get_the_same_403() {
    // More attempts than the rate limit allows (AC4 tests the limit).
    let r = rig_with(Limits {
        rate: rate::RateLimits {
            failed_per_window: 100,
            ..rate::RateLimits::default()
        },
        ..Limits::default()
    });
    // An earlier opening of the same meeting.
    let (_, old) = r.open();
    r.view().close(CloseReason::Requested);
    // A valid-format token of another meeting.
    let (_, foreign) = r.open_for("m-2");
    r.view().close(CloseReason::Requested);
    let (addr, token) = r.open();
    let random = PhoneViewToken::new();
    let session = |req: Req| req.send(addr);
    let replies = vec![
        ("missing", session(Req::get("/api/session", addr))),
        (
            "empty",
            session(Req::get("/api/session", addr).set("Authorization", "Bearer ")),
        ),
        (
            "basic",
            session(Req::get("/api/session", addr).set("Authorization", &format!("Basic {token}"))),
        ),
        (
            "lower-case scheme",
            session(
                Req::get("/api/session", addr).set("Authorization", &format!("bearer {token}")),
            ),
        ),
        (
            "malformed",
            session(Req::get("/api/session", addr).bearer("not a token!")),
        ),
        (
            "truncated",
            session(Req::get("/api/session", addr).bearer(&token[..42])),
        ),
        (
            "extra",
            session(Req::get("/api/session", addr).bearer(&format!("{token}A"))),
        ),
        ("old", session(Req::get("/api/session", addr).bearer(&old))),
        (
            "foreign",
            session(Req::get("/api/session", addr).bearer(&foreign)),
        ),
        (
            "random",
            session(Req::get("/api/session", addr).bearer(random.expose())),
        ),
        (
            "in the query",
            session(Req::get(&format!("/api/session?t={token}"), addr)),
        ),
        (
            "consumer route",
            session(Req::get("/api/test/ping", addr).bearer(&old)),
        ),
        ("unknown api route", session(Req::get("/api/meeting", addr))),
    ];
    let first = &replies[0].1;
    assert_eq!(first.status, 403);
    assert_eq!(first.text(), r#"{"error":"forbidden"}"#);
    for (what, reply) in &replies {
        assert_eq!(reply.status, 403, "{what}");
        assert_eq!(reply.body, first.body, "{what}");
        assert_eq!(
            reply.header("content-type"),
            first.header("content-type"),
            "{what}"
        );
    }
    // The current token works, and is accepted only as `Authorization: Bearer`.
    assert_eq!(
        session(Req::get("/api/session", addr).bearer(&token)).status,
        204
    );
    assert_eq!(
        session(
            Req::get("/api/session", addr)
                .bearer(&token)
                .set("Authorization", "Bearer x")
                .bearer(&token)
        )
        .status,
        204
    );
}

#[test]
fn ac2_the_token_never_reaches_the_log() {
    crate::log::capture();
    let r = rig();
    let (addr, token) = r.open();
    let old = token.clone();
    Req::get("/api/session", addr).bearer(&token).send(addr);
    Req::get("/api/session", addr).bearer("wrong").send(addr);
    Req::get(&format!("/assets/{token}"), addr).send(addr);
    Req::post_json("/api/test/items/a1", addr, &token, "{bad json").send(addr);
    Req::get("/", addr)
        .set("Host", &format!("evil.example:{}", addr.port()))
        .send(addr);
    r.view().close(CloseReason::Requested);
    let (addr, token) = r.open();
    Req::get("/api/session", addr).bearer(&old).send(addr);
    drop(r);
    let lines = crate::log::take_captured();
    assert!(lines.iter().any(|l| l.contains("phone view opened")));
    assert!(lines.iter().any(|l| l.contains("phone view closed")));
    for line in &lines {
        for secret in [token.as_str(), old.as_str(), "#t="] {
            assert!(!line.contains(secret), "{line}");
        }
    }
}

// ---- AC3: hardening -----------------------------------------------------------------------------

#[test]
fn ac3_a_foreign_host_header_gets_421() {
    let r = rig();
    let (addr, token) = r.open();
    let port = addr.port();
    for host in [
        format!("evil.example:{port}"),
        format!("localhost:{port}"),
        format!("127.0.0.1:{}", port.wrapping_add(1)),
        "127.0.0.1".to_owned(),
        format!("192.168.178.20:{port}"),
        String::new(),
    ] {
        for req in [
            Req::get("/", addr),
            Req::get("/api/session", addr).bearer(&token),
            Req::post_json(
                "/api/test/items/a1",
                addr,
                &token,
                r#"{"id":"a1","note":"x"}"#,
            ),
        ] {
            let reply = req.set("Host", &host).send(addr);
            assert_eq!(reply.status, 421, "Host {host:?}");
        }
    }
    let reply = Req::get("/", addr).without("Host").send(addr);
    assert!(
        matches!(reply.status, 400 | 421),
        "no Host: {}",
        reply.status
    );
    // An absolute-form request line naming another host.
    let mut abs = Req::get("/", addr);
    abs.head = "GET http://evil.example/ HTTP/1.1".into();
    assert_eq!(abs.send(addr).status, 421);
}

#[test]
fn ac3_a_foreign_origin_gets_403_and_a_post_needs_its_origin() {
    let r = rig();
    let (addr, token) = r.open();
    let body = r#"{"id":"a1","note":"x"}"#;
    for origin in [
        "http://evil.example".to_owned(),
        "null".to_owned(),
        format!("https://{addr}"),
        format!("http://localhost:{}", addr.port()),
        format!("http://{addr}/"),
    ] {
        let post = Req::post_json("/api/test/items/a1", addr, &token, body).set("Origin", &origin);
        assert_eq!(post.send(addr).status, 403, "POST Origin {origin}");
        let get = Req::get("/api/session", addr)
            .bearer(&token)
            .set("Origin", &origin);
        assert_eq!(get.send(addr).status, 403, "GET Origin {origin}");
        assert_eq!(
            Req::get("/", addr).set("Origin", &origin).send(addr).status,
            403
        );
    }
    let no_origin = Req::post_json("/api/test/items/a1", addr, &token, body).without("Origin");
    assert_eq!(no_origin.send(addr).status, 403);
    let ok = Req::post_json("/api/test/items/a1", addr, &token, body).send(addr);
    assert_eq!(ok.status, 200);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&ok.body).unwrap(),
        serde_json::json!({ "path": "a1", "id": "a1", "noteLength": 1 })
    );
}

#[test]
fn ac3_state_changing_routes_take_only_post_with_json() {
    let r = rig();
    let (addr, token) = r.open();
    let origin = format!("http://{addr}");
    for method in ["GET", "PUT", "DELETE", "PATCH"] {
        let reply = Req::new(method, "/api/test/items/a1", addr)
            .bearer(&token)
            .set("Origin", &origin)
            .send(addr);
        assert_eq!(reply.status, 405, "{method}");
        assert_eq!(reply.header("allow"), Some("POST"), "{method}");
    }
    for method in ["POST", "PUT", "DELETE"] {
        let reply = Req::new(method, "/api/session", addr)
            .bearer(&token)
            .set("Origin", &origin)
            .send(addr);
        assert_eq!(reply.status, 405, "{method} /api/session");
        let page = Req::new(method, "/", addr)
            .set("Origin", &origin)
            .send(addr);
        assert_eq!(page.status, 405, "{method} /");
    }
    for ct in [
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
    ] {
        let reply = Req::post_json(
            "/api/test/items/a1",
            addr,
            &token,
            r#"{"id":"a1","note":"x"}"#,
        )
        .set("Content-Type", ct)
        .send(addr);
        assert_eq!(reply.status, 415, "{ct}");
    }
    let no_ct = Req::post_json(
        "/api/test/items/a1",
        addr,
        &token,
        r#"{"id":"a1","note":"x"}"#,
    )
    .without("Content-Type");
    assert_eq!(no_ct.send(addr).status, 415);
    // Without the bearer header, a well-formed POST is refused.
    let no_token = Req::post_json(
        "/api/test/items/a1",
        addr,
        &token,
        r#"{"id":"a1","note":"x"}"#,
    )
    .without("Authorization");
    assert_eq!(no_token.send(addr).status, 403);
}

#[test]
fn ac3_bodies_over_4_kb_get_413() {
    let r = rig();
    let (addr, token) = r.open();
    let note = "x".repeat(4 * 1024);
    let big = format!(r#"{{"id":"a1","note":"{note}"}}"#);
    let reply = Req::post_json("/api/test/items/a1", addr, &token, &big).send(addr);
    assert_eq!(reply.status, 413);
    // Declared too large, nothing sent.
    let declared = Req::new("POST", "/api/test/items/a1", addr)
        .bearer(&token)
        .set("Origin", &format!("http://{addr}"))
        .set("Content-Type", "application/json")
        .set("Content-Length", "1000000");
    let mut s = connect(addr);
    s.write_all(&declared.bytes()).unwrap();
    assert_eq!(read_reply(&mut s).unwrap().status, 413);
    // Chunked, without a length.
    let mut chunked =
        Req::post_json("/api/test/items/a1", addr, &token, "").set("Transfer-Encoding", "chunked");
    let mut body = Vec::new();
    for _ in 0..5 {
        body.extend_from_slice(format!("400\r\n{}\r\n", "x".repeat(1024)).as_bytes());
    }
    body.extend_from_slice(b"0\r\n\r\n");
    chunked.body = body;
    assert_eq!(chunked.send(addr).status, 413);
    // Exactly at the limit is fine (and then a 400 for the content).
    let at_limit = format!(r#"{{"id":"a1","note":"{}"}}"#, "x".repeat(4 * 1024 - 21));
    assert_eq!(at_limit.len(), 4 * 1024);
    let reply = Req::post_json("/api/test/items/a1", addr, &token, &at_limit).send(addr);
    assert_eq!(reply.status, 200);
}

#[test]
fn ac3_malformed_json_unknown_fields_and_bad_ids_get_400() {
    let r = rig();
    let (addr, token) = r.open();
    let post = |path: &str, body: &str| Req::post_json(path, addr, &token, body).send(addr);
    for body in [
        "{bad json",
        "",
        "null",
        "[]",
        r#"{"id":"a1"}"#,
        r#"{"id":"a1","note":"x","admin":true}"#,
        r#"{"id":"a 1","note":"x"}"#,
        r#"{"id":"","note":"x"}"#,
        r#"{"id":"../x","note":"x"}"#,
        &format!(r#"{{"id":"{}","note":"x"}}"#, "a".repeat(65)),
        r#"{"id":1,"note":"x"}"#,
    ] {
        assert_eq!(post("/api/test/items/a1", body).status, 400, "{body}");
    }
    for path in [
        "/api/test/items/a.1",
        "/api/test/items/%2e%2e",
        "/api/test/items/a%201",
    ] {
        let reply = post(path, r#"{"id":"a1","note":"x"}"#);
        assert_eq!(reply.status, 400, "{path}");
        assert_eq!(reply.text(), r#"{"error":"badRequest"}"#);
    }
    let long = format!("/api/test/items/{}", "a".repeat(65));
    assert_eq!(post(&long, r#"{"id":"a1","note":"x"}"#).status, 400);
    assert_eq!(
        post("/api/test/items/a-1_B", r#"{"id":"a-1_B","note":""}"#).status,
        200
    );
}

#[test]
fn ac3_asset_paths_outside_the_embedded_files_get_404() {
    let r = rig();
    let (addr, _) = r.open();
    let ok = Req::get("/assets/phone-test.js", addr).send(addr);
    assert_eq!(ok.status, 200);
    assert_eq!(
        ok.header("content-type"),
        Some("text/javascript; charset=utf-8")
    );
    for path in [
        "/assets/../Cargo.toml",
        "/assets/..%2fCargo.toml",
        "/assets/..%2F..%2FCargo.toml",
        "/assets/%2e%2e/Cargo.toml",
        "/assets/%2e%2e%2fsrc%2flib.rs",
        "/assets/....//Cargo.toml",
        "/assets/phone-test.js%00.css",
        "/assets/phone-test%2ejs",
        "/assets/",
        "/assets/.env",
        "/assets/unknown.js",
        "/assets/sub/phone-test.js",
        "/assets/%5c..%5cCargo.toml",
        "/../Cargo.toml",
        "/Cargo.toml",
        "/phone.html",
        "/index.html",
        "/.vite/manifest.json",
        "/src/lib.rs",
        "//etc/passwd",
    ] {
        let reply = Req::get(path, addr).send(addr);
        assert_eq!(reply.status, 404, "{path}");
        assert_eq!(reply.text(), r#"{"error":"notFound"}"#, "{path}");
    }
}

#[test]
fn ac3_a_request_not_complete_within_the_deadline_is_dropped() {
    let limits = Limits {
        request_timeout: Duration::from_millis(400),
        ..Limits::default()
    };
    let r = rig_with(limits);
    let (addr, token) = r.open();
    // Headers that never end.
    let mut slow = connect(addr);
    slow.write_all(format!("GET / HTTP/1.1\r\nHost: {addr}\r\nX-Slow: 1").as_bytes())
        .unwrap();
    let start = Instant::now();
    assert!(closed_within(&mut slow, Duration::from_secs(2)));
    assert!(start.elapsed() < Duration::from_millis(1_500));
    // Headers complete, the body trickles: the deadline counts from the first byte.
    let mut trickle = connect(addr);
    let mut head = Req::post_json("/api/test/items/a1", addr, &token, "")
        .set("Content-Length", "100")
        .bytes();
    head.extend_from_slice(b"{\"id\":");
    trickle.write_all(&head).unwrap();
    let start = Instant::now();
    std::thread::sleep(Duration::from_millis(250));
    let _ = trickle.write_all(b"\"a1\"");
    let reply = read_reply(&mut trickle);
    assert!(reply.as_ref().is_none_or(|r| r.status == 408), "{reply:?}");
    assert!(closed_within(&mut trickle, Duration::from_secs(2)));
    assert!(start.elapsed() < Duration::from_millis(1_500));
    // An idle connection that never sends a byte is closed too.
    let mut idle = connect(addr);
    assert!(closed_within(&mut idle, Duration::from_secs(2)));
    // A normal request still works.
    assert_eq!(Req::get("/", addr).send(addr).status, 200);
}

#[test]
fn ac3_at_most_32_connections_at_a_time() {
    let r = rig();
    let (addr, token) = r.open();
    assert_eq!(Limits::default().max_connections, 32);
    // 32 keep-alive connections, each served once (so the server holds them).
    let mut held: Vec<TcpStream> = (0..32)
        .map(|_| {
            let mut s = connect(addr);
            let reply = Req::get("/api/session", addr)
                .bearer(&token)
                .send_on(&mut s);
            assert_eq!(reply.status, 204);
            s
        })
        .collect();
    // The 33rd is closed without an answer.
    let mut extra = connect(addr);
    let _ = extra.write_all(&Req::get("/api/session", addr).bearer(&token).bytes());
    assert!(read_reply(&mut extra).is_none());
    // One goes away: a new connection is served again.
    drop(held.pop());
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let mut s = connect(addr);
        let _ = s.write_all(&Req::get("/api/session", addr).bearer(&token).bytes());
        if let Some(reply) = read_reply(&mut s) {
            assert_eq!(reply.status, 204);
            break;
        }
        assert!(
            Instant::now() < deadline,
            "no connection served after one closed"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

// ---- AC4: rate limit ----------------------------------------------------------------------------

#[test]
fn ac4_eleven_wrong_tokens_lock_out_the_address_until_the_window_ends() {
    let r = rig();
    let (addr, token) = r.open();
    for i in 0..10 {
        let reply = Req::get("/api/session", addr).bearer("wrong").send(addr);
        assert_eq!(reply.status, 403, "attempt {i}");
    }
    let locked = Req::get("/api/session", addr).bearer("wrong").send(addr);
    assert_eq!(locked.status, 429);
    assert_eq!(locked.header("retry-after"), Some("60"));
    assert_eq!(locked.text(), r#"{"error":"tooManyRequests"}"#);
    // The valid token from that address is refused too, and so is the page.
    let valid = Req::get("/api/session", addr).bearer(&token).send(addr);
    assert_eq!(valid.status, 429);
    assert_eq!(Req::get("/", addr).send(addr).status, 429);
    r.clock.advance(45_000);
    let later = Req::get("/api/session", addr).bearer(&token).send(addr);
    assert_eq!(later.status, 429);
    assert_eq!(later.header("retry-after"), Some("15"));
    // Closing and reopening does not reset the window.
    r.view().close(CloseReason::Requested);
    let (addr, token) = r.open();
    assert_eq!(
        Req::get("/api/session", addr)
            .bearer(&token)
            .send(addr)
            .status,
        429
    );
    r.clock.advance(15_000);
    assert_eq!(
        Req::get("/api/session", addr)
            .bearer(&token)
            .send(addr)
            .status,
        204
    );
}

#[test]
fn ac4_more_than_120_requests_a_minute_get_429() {
    let r = rig();
    let (addr, token) = r.open();
    let mut s = connect(addr);
    for i in 0..120 {
        let reply = Req::get("/api/session", addr)
            .bearer(&token)
            .send_on(&mut s);
        assert_eq!(reply.status, 204, "request {i}");
    }
    let over = Req::get("/api/session", addr)
        .bearer(&token)
        .send_on(&mut s);
    assert_eq!(over.status, 429);
    assert!(over.header("retry-after").is_some());
    r.clock.advance(60_000);
    assert_eq!(
        Req::get("/api/session", addr)
            .bearer(&token)
            .send_on(&mut s)
            .status,
        204
    );
}

/// Linux routes all of 127/8 to loopback, so a second client address is available there.
#[cfg(target_os = "linux")]
#[test]
fn ac4_other_addresses_are_not_affected() {
    let r = rig();
    let (addr, token) = r.open();
    for _ in 0..11 {
        Req::get("/api/session", addr).bearer("wrong").send(addr);
    }
    assert_eq!(
        Req::get("/api/session", addr)
            .bearer(&token)
            .send(addr)
            .status,
        429
    );
    let other = r.rt.block_on(async {
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket
            .bind(SocketAddr::new(
                std::net::IpAddr::V4(Ipv4Addr::new(127, 0, 0, 2)),
                0,
            ))
            .unwrap();
        socket
            .connect(SocketAddr::V4(addr))
            .await
            .unwrap()
            .into_std()
            .unwrap()
    });
    other.set_nonblocking(false).unwrap();
    other
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut other = other;
    let reply = Req::get("/api/session", addr)
        .bearer(&token)
        .send_on(&mut other);
    assert_eq!(reply.status, 204);
}

// ---- AC5: headers and routes --------------------------------------------------------------------

#[test]
fn ac5_every_response_carries_the_security_headers() {
    let r = rig_with(Limits {
        rate: rate::RateLimits {
            failed_per_window: 2,
            ..rate::RateLimits::default()
        },
        ..Limits::default()
    });
    let (addr, token) = r.open();
    let cases = [
        ("page", Req::get("/", addr), 200),
        ("asset", Req::get("/assets/phone-test.css", addr), 200),
        (
            "session",
            Req::get("/api/session", addr).bearer(&token),
            204,
        ),
        (
            "consumer",
            Req::post_json(
                "/api/test/items/a1",
                addr,
                &token,
                r#"{"id":"a1","note":""}"#,
            ),
            200,
        ),
        ("404", Req::get("/nope", addr), 404),
        ("405", Req::new("DELETE", "/", addr), 405),
        ("421", Req::get("/", addr).set("Host", "evil.example"), 421),
        (
            "400",
            Req::post_json("/api/test/items/a1", addr, &token, "{"),
            400,
        ),
        ("403", Req::get("/api/session", addr), 403),
        ("403 again", Req::get("/api/session", addr), 403),
        ("429", Req::get("/api/session", addr).bearer(&token), 429),
    ];
    for (what, req, status) in cases {
        let reply = req.send(addr);
        assert_eq!(reply.status, status, "{what}");
        assert_security_headers(&reply, what);
    }
}

#[test]
fn ac5_413_and_408_carry_the_headers_too() {
    let r = rig_with(Limits {
        request_timeout: Duration::from_millis(300),
        ..Limits::default()
    });
    let (addr, token) = r.open();
    let big = Req::post_json("/api/test/items/a1", addr, &token, &"x".repeat(5_000)).send(addr);
    assert_eq!(big.status, 413);
    assert_security_headers(&big, "413");
    let mut s = connect(addr);
    s.write_all(
        &Req::post_json("/api/test/items/a1", addr, &token, "")
            .set("Content-Length", "10")
            .bytes(),
    )
    .unwrap();
    let reply = read_reply(&mut s).unwrap();
    assert_eq!(reply.status, 408);
    assert_eq!(reply.header("connection"), Some("close"));
    assert_security_headers(&reply, "408");
}

#[test]
fn ac5_the_route_table_lists_every_route_and_nothing_else_answers() {
    let r = rig();
    assert_eq!(
        r.view().route_table(),
        vec![
            "GET /",
            "GET /assets/{file}",
            "GET /api/session",
            "GET /api/test/ping",
            "POST /api/test/items/{id}",
        ]
    );
    let (addr, token) = r.open();
    assert_eq!(Req::get("/", addr).send(addr).status, 200);
    assert_eq!(
        Req::get("/assets/phone-test.js", addr).send(addr).status,
        200
    );
    let session = Req::get("/api/session", addr).bearer(&token).send(addr);
    assert_eq!(session.status, 204);
    assert!(session.body.is_empty());
    assert_eq!(
        Req::get("/api/test/ping", addr)
            .bearer(&token)
            .send(addr)
            .status,
        204
    );
    for path in [
        "/api/meeting",
        "/api/meetings",
        "/api/title",
        "/api/participants",
        "/api/transcript",
        "/api/audio",
        "/api/embeddings",
        "/api/voices",
        "/api/settings",
        "/api/session/meeting",
        "/api/test",
        "/api/test/items",
        "/api",
        "/api/",
    ] {
        let reply = Req::get(path, addr).bearer(&token).send(addr);
        assert_eq!(reply.status, 404, "{path}");
    }
    // Nothing the server sends names the meeting.
    for req in [
        Req::get("/", addr),
        Req::get("/api/session", addr).bearer(&token),
        Req::get("/api/session", addr),
        Req::get("/nope", addr),
    ] {
        assert!(!req.send(addr).text().contains(MEETING));
    }
}

#[test]
fn ac5_a_consumer_name_is_registered_once_and_must_be_plain() {
    let r = rig();
    assert!(r.view().register(ConsumerRoutes::new("test")).is_err());
    assert!(r.view().register(ConsumerRoutes::new("voices")).is_ok());
    for bad in ["", "Voices", "../x", "a/b", "session"] {
        assert!(
            std::panic::catch_unwind(|| ConsumerRoutes::new(bad)).is_err(),
            "{bad}"
        );
    }
}

// ---- AC6: QR code and URL -----------------------------------------------------------------------

#[test]
fn ac6_open_returns_the_url_and_a_qr_code_that_decodes_to_it() {
    let r = rig();
    let opened = r.view().open(MEETING, |_| true).unwrap();
    assert!(opened.url.starts_with("http://127.0.0.1:"));
    assert_eq!(qr::tests::decode(&opened.qr_svg), opened.url);
    assert!(opened.qr_svg.starts_with("<svg "));
    let json = serde_json::to_value(&opened).unwrap();
    assert_eq!(
        json.as_object().unwrap().keys().collect::<Vec<_>>(),
        ["qrSvg", "url"]
    );
}

/// The mock core's fixed QR code (`src/lib/fixtures/phone-qr.svg`) is what the core draws for the
/// mock URL, so consumer fixtures show a real, scannable code.
#[test]
fn ac6_the_mock_backend_svg_is_the_core_rendering_of_the_mock_url() {
    let svg = include_str!("../../../src/lib/fixtures/phone-qr.svg");
    assert_eq!(svg.trim_end(), qr::qr_svg(qr::tests::URL).unwrap());
    assert_eq!(qr::tests::decode(svg), qr::tests::URL);
}

// ---- events --------------------------------------------------------------------------------------

#[test]
fn the_state_event_names_open_and_closed_with_the_reason() {
    let open = PhoneViewState {
        state: PhoneState::Open,
        meeting_id: Some("m-1".into()),
        reason: None,
    };
    assert_eq!(
        serde_json::to_value(&open).unwrap(),
        serde_json::json!({ "state": "open", "meetingId": "m-1", "reason": null })
    );
    for (reason, text) in [
        (CloseReason::Requested, "requested"),
        (CloseReason::RecordingStopped, "recordingStopped"),
        (CloseReason::MeetingEnded, "meetingEnded"),
        (CloseReason::AppExit, "appExit"),
    ] {
        let closed = PhoneViewState {
            state: PhoneState::Closed,
            meeting_id: Some("m-1".into()),
            reason: Some(reason),
        };
        assert_eq!(serde_json::to_value(&closed).unwrap()["reason"], text);
        assert_eq!(serde_json::to_value(&closed).unwrap()["state"], "closed");
    }
}
