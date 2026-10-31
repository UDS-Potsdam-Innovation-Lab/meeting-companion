//! The accept loop of one opening: HTTP/1 only, at most `max_connections` connections at a time
//! (further ones are closed at once), the header deadline enforced by hyper. Stopping drops the
//! listener and every open connection (keep-alive included) and reports back when they are gone.

use std::pin::Pin;
use std::sync::mpsc;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use axum::{Extension, Router};
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::service::TowerToHyperService;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio::runtime::{Handle, RuntimeFlavor};
use tokio::sync::{oneshot, Semaphore};
use tokio::task::JoinSet;

use super::http::{ConnClock, Peer};
use super::Limits;

/// Largest request head (request line and headers) a connection buffers.
const MAX_HEAD: usize = 16 * 1024;

/// A running server. Dropping it stops it too (without waiting).
pub(crate) struct Running {
    stop: Option<oneshot::Sender<()>>,
    done: mpsc::Receiver<()>,
}

impl Running {
    /// Serves `app` on `listener` (already bound) on `runtime`.
    pub fn spawn(
        runtime: &Handle,
        listener: std::net::TcpListener,
        app: Router,
        limits: Limits,
    ) -> std::io::Result<Self> {
        listener.set_nonblocking(true)?;
        let (stop, stopped) = oneshot::channel();
        let (finished, done) = mpsc::channel();
        runtime.spawn(accept_loop(listener, app, limits, stopped, finished));
        Ok(Self {
            stop: Some(stop),
            done,
        })
    }

    /// Stops accepting, drops every connection and waits (at most `wait`) until the listener and all
    /// connections are closed. Returns whether they were closed in time.
    pub fn stop(mut self, wait: Duration) -> bool {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        let done = &self.done;
        let wait_for_it = || {
            matches!(
                done.recv_timeout(wait),
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected)
            )
        };
        match Handle::try_current() {
            // On a runtime worker: let the runtime move its other tasks (the server's) elsewhere.
            Ok(h) if h.runtime_flavor() == RuntimeFlavor::MultiThread => {
                tokio::task::block_in_place(wait_for_it)
            }
            _ => wait_for_it(),
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

async fn accept_loop(
    listener: std::net::TcpListener,
    app: Router,
    limits: Limits,
    mut stop: oneshot::Receiver<()>,
    finished: mpsc::Sender<()>,
) {
    let listener = match tokio::net::TcpListener::from_std(listener) {
        Ok(l) => l,
        Err(e) => {
            crate::log!("the phone view could not listen: {}", e.kind());
            let _ = finished.send(());
            return;
        }
    };
    let permits = Arc::new(Semaphore::new(limits.max_connections));
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            biased;
            _ = &mut stop => break,
            accepted = listener.accept() => {
                while connections.try_join_next().is_some() {}
                let Ok((stream, peer)) = accepted else {
                    // E.g. out of file descriptors: back off instead of spinning.
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    continue;
                };
                let Ok(permit) = permits.clone().try_acquire_owned() else {
                    // Over the limit: closed at once.
                    drop(stream);
                    continue;
                };
                let clock = ConnClock::default();
                let service = TowerToHyperService::new(
                    app.clone()
                        .layer(Extension(Peer(peer.ip())))
                        .layer(Extension(clock.clone())),
                );
                let io = TokioIo::new(Marked { inner: stream, clock });
                let mut http = hyper::server::conn::http1::Builder::new();
                http.timer(TokioTimer::new())
                    .header_read_timeout(limits.request_timeout)
                    .max_buf_size(MAX_HEAD)
                    .keep_alive(true);
                connections.spawn(async move {
                    let _permit = permit;
                    // Errors (a client that went away, a bad request line) are not logged.
                    let _ = http.serve_connection(io, service).await;
                });
            }
        }
    }
    drop(listener);
    connections.shutdown().await;
    let _ = finished.send(());
}

/// The connection's stream; marks the arrival of a request's first byte on its [`ConnClock`].
struct Marked {
    inner: TcpStream,
    clock: ConnClock,
}

impl AsyncRead for Marked {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let polled = Pin::new(&mut self.inner).poll_read(cx, buf);
        if matches!(polled, Poll::Ready(Ok(()))) && buf.filled().len() > before {
            self.clock.mark();
        }
        polled
    }
}

impl AsyncWrite for Marked {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}
