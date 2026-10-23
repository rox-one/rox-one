//! In-process mock relay used by the unit tests. No network access: the server
//! binds `127.0.0.1:0` (or an explicit loopback port) and runs the
//! `tokio-tungstenite` accept loop in the same process.

use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Notify};
use tokio_tungstenite::tungstenite::Message;

pub struct MockRelay {
    pub addr: SocketAddr,
    frames: Arc<Mutex<Vec<serde_json::Value>>>,
    connections: Arc<AtomicUsize>,
    dropper: Arc<Notify>,
    tx: broadcast::Sender<String>,
    _accept_loop: tokio::task::JoinHandle<()>,
}

impl MockRelay {
    pub async fn start() -> Self {
        Self::start_on(0).await
    }

    /// Bind a specific loopback port (`0` picks a free one).
    pub async fn start_on(port: u16) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", port))
            .await
            .expect("bind mock relay");
        let addr = listener.local_addr().expect("mock relay addr");
        let frames: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
        let connections = Arc::new(AtomicUsize::new(0));
        let dropper = Arc::new(Notify::new());
        let (tx, _rx) = broadcast::channel::<String>(256);
        let accept_loop = {
            let frames = Arc::clone(&frames);
            let connections = Arc::clone(&connections);
            let dropper = Arc::clone(&dropper);
            let tx = tx.clone();
            tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        break;
                    };
                    connections.fetch_add(1, Ordering::SeqCst);
                    let Ok(ws) = tokio_tungstenite::accept_async(stream).await else {
                        continue;
                    };
                    let frames = Arc::clone(&frames);
                    let dropper = Arc::clone(&dropper);
                    let mut rx = tx.subscribe();
                    tokio::spawn(async move {
                        let (mut sink, mut stream) = ws.split();
                        loop {
                            tokio::select! {
                                biased;
                                _ = dropper.notified() => break,
                                outgoing = rx.recv() => match outgoing {
                                    Ok(text) => {
                                        if sink.send(Message::Text(text.into())).await.is_err() {
                                            break;
                                        }
                                    }
                                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                                    Err(broadcast::error::RecvError::Closed) => break,
                                },
                                incoming = stream.next() => match incoming {
                                    Some(Ok(Message::Text(text))) => record(&frames, text.as_str()),
                                    Some(Ok(Message::Binary(bytes))) => {
                                        if let Ok(text) = std::str::from_utf8(&bytes) {
                                            record(&frames, text);
                                        }
                                    }
                                    Some(Ok(_)) => {}
                                    Some(Err(_)) | None => break,
                                }
                            }
                        }
                        // Dropping the socket simulates a network drop, which is
                        // what the reconnect tests need.
                    });
                }
            })
        };
        Self {
            addr,
            frames,
            connections,
            dropper,
            tx,
            _accept_loop: accept_loop,
        }
    }

    pub fn url(&self) -> String {
        format!("ws://{}", self.addr)
    }

    #[allow(dead_code)] // handy for tests that assert the bound port
    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    pub async fn send_text(&self, text: &str) {
        let _ = self.tx.send(text.to_string());
    }

    pub async fn send_json(&self, value: &serde_json::Value) {
        self.send_text(&value.to_string()).await;
    }

    /// Simulate the relay going away: every live connection is dropped.
    pub fn drop_connections(&self) {
        self.dropper.notify_waiters();
    }

    pub fn connection_count(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }

    pub fn frames(&self) -> Vec<serde_json::Value> {
        self.frames.lock().map(|f| f.clone()).unwrap_or_default()
    }

    pub fn labels(&self) -> Vec<String> {
        self.frames()
            .iter()
            .map(|frame| {
                frame
                    .get(0)
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string()
            })
            .collect()
    }

    pub fn count_label(&self, label: &str) -> usize {
        self.labels().iter().filter(|l| *l == label).count()
    }

    /// Frames of a given label, in arrival order.
    pub fn frames_with_label(&self, label: &str) -> Vec<serde_json::Value> {
        self.frames()
            .into_iter()
            .filter(|frame| frame.get(0).and_then(|v| v.as_str()) == Some(label))
            .collect()
    }
}

fn record(frames: &Mutex<Vec<serde_json::Value>>, text: &str) {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        if let Ok(mut guard) = frames.lock() {
            guard.push(value);
        }
    }
}

/// Poll `predicate` until it holds or `timeout` elapses.
pub async fn wait_for(predicate: impl Fn() -> bool, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if predicate() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// Reserve a loopback port that is free right now, so a test can point the
/// client at a relay that is not listening yet.
pub async fn reserve_port() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("reserve port");
    let port = listener.local_addr().expect("reserved addr").port();
    drop(listener);
    port
}
