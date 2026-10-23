//! The relay client: connection loop, backoff/reconnect, resubscribe, outbox
//! replay and callback fan-out.

use crate::error::ChatError;
use crate::event::{
    event_tag_values, is_edit_event, verify_event, Event, EPHEMERAL_PRESENCE, EPHEMERAL_TYPING,
    KIND_AUTH, KIND_DELETE, KIND_STREAM_MESSAGE,
};
use crate::keys::Keys;
use crate::store::Store;
use crate::types::{
    ChatCoreOptions, ChatCoreStatus, ChatMessage, ListOptions, MessageRef, PresenceEntry,
    PresenceStatus, SearchOptions, TypingEntry,
};
use crate::wire::{ClientFrame, Filter, RelayFrame};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::tungstenite::Message;

pub fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Exponential backoff for reconnect attempts (no jitter, so it is testable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackoffPolicy {
    pub base: Duration,
    pub max: Duration,
    pub factor: u32,
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        Self {
            base: Duration::from_millis(500),
            max: Duration::from_secs(30),
            factor: 2,
        }
    }
}

impl BackoffPolicy {
    /// Fast policy for unit tests: 5ms base, 40ms ceiling.
    pub fn fast() -> Self {
        Self {
            base: Duration::from_millis(5),
            max: Duration::from_millis(40),
            factor: 2,
        }
    }

    /// `attempt` is 1-based: the first retry waits `base`, the next `base *
    /// factor`, and so on, never above `max`.
    pub fn delay(&self, attempt: u32) -> Duration {
        let exponent = attempt.saturating_sub(1);
        let millis = (self.base.as_millis() as u64)
            .saturating_mul((self.factor.max(1) as u64).saturating_pow(exponent));
        let capped = millis.min(self.max.as_millis().max(1) as u64);
        Duration::from_millis(capped)
    }
}

#[derive(Debug, Clone)]
enum Command {
    Subscribe { channel: String, sub_id: String },
    Unsubscribe { sub_id: String },
    Publish { event: Event },
}

type MessageListener = Arc<dyn Fn(ChatMessage) + Send + Sync>;
type PresenceListener = Arc<dyn Fn(PresenceEntry) + Send + Sync>;
type TypingListener = Arc<dyn Fn(TypingEntry) + Send + Sync>;
type StatusListener = Arc<dyn Fn(ChatCoreStatus) + Send + Sync>;

#[derive(Default)]
struct Listeners {
    message: Mutex<Vec<(u64, MessageListener)>>,
    presence: Mutex<Vec<(u64, PresenceListener)>>,
    typing: Mutex<Vec<(u64, TypingListener)>>,
    status: Mutex<Vec<(u64, StatusListener)>>,
    next_id: AtomicU64,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, ChatError> {
    mutex.lock().map_err(|_| ChatError::Lock)
}

/// Deterministic subscription id: re-subscribing after a reconnect reuses it.
pub fn sub_id_for(channel: &str) -> String {
    format!("rox-chat-{channel}")
}

struct Inner {
    options: ChatCoreOptions,
    keys: Keys,
    store: Mutex<Store>,
    backoff: BackoffPolicy,
    status: Mutex<ChatCoreStatus>,
    subscriptions: Mutex<HashMap<String, String>>,
    listeners: Listeners,
    commands: Mutex<Option<mpsc::UnboundedSender<Command>>>,
    shutdown: Notify,
    stopped: AtomicBool,
    started: AtomicBool,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl Inner {
    fn with_store<T>(
        &self,
        f: impl FnOnce(&Store) -> Result<T, ChatError>,
    ) -> Result<T, ChatError> {
        let guard = lock(&self.store)?;
        f(&guard)
    }

    fn set_status(&self, status: ChatCoreStatus) {
        if let Ok(mut current) = self.status.lock() {
            *current = status.clone();
        }
        let listeners: Vec<StatusListener> = match self.listeners.status.lock() {
            Ok(guard) => guard.iter().map(|(_, cb)| cb.clone()).collect(),
            Err(_) => return,
        };
        for cb in listeners {
            cb(status.clone());
        }
    }

    fn emit_message(&self, message: ChatMessage) {
        let listeners: Vec<MessageListener> = match self.listeners.message.lock() {
            Ok(guard) => guard.iter().map(|(_, cb)| cb.clone()).collect(),
            Err(_) => return,
        };
        for cb in listeners {
            cb(message.clone());
        }
    }

    fn emit_presence(&self, entry: PresenceEntry) {
        let listeners: Vec<PresenceListener> = match self.listeners.presence.lock() {
            Ok(guard) => guard.iter().map(|(_, cb)| cb.clone()).collect(),
            Err(_) => return,
        };
        for cb in listeners {
            cb(entry.clone());
        }
    }

    fn emit_typing(&self, entry: TypingEntry) {
        let listeners: Vec<TypingListener> = match self.listeners.typing.lock() {
            Ok(guard) => guard.iter().map(|(_, cb)| cb.clone()).collect(),
            Err(_) => return,
        };
        for cb in listeners {
            cb(entry.clone());
        }
    }

    /// Cache an inbound event and fan it out. Ephemeral kinds are never stored.
    fn accept_event(&self, event: Event) {
        if verify_event(&event).is_err() {
            return;
        }
        match event.kind {
            EPHEMERAL_PRESENCE => self.emit_presence(presence_from_event(&event)),
            EPHEMERAL_TYPING => self.emit_typing(typing_from_event(&event)),
            KIND_DELETE => {
                let _ = self.with_store(|store| {
                    // Keep the deletion envelope (kind 5 is filtered out of the
                    // message list) and tombstone each referenced message.
                    store.insert_event(&event)
                });
                for target in event_tag_values(&event, "e") {
                    let _ = self
                        .with_store(|store| store.mark_event_deleted(&target, event.created_at));
                }
            }
            _ if is_edit_event(&event) => {
                if let Some(target) = event_tag_values(&event, "e").into_iter().next() {
                    let _ = self.with_store(|store| {
                        store.mark_event_edited(&target, &event.content, event.created_at)
                    });
                }
            }
            _ => {
                let _ = self.with_store(|store| store.insert_event(&event));
                if let Ok(Some(message)) = self.with_store(|store| store.get_event(&event.id)) {
                    self.emit_message(message);
                }
            }
        }
    }
}

pub struct ChatCore {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for ChatCore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatCore")
            .field("relay_url", &self.inner.options.relay_url)
            .field("pubkey", &self.inner.keys.pubkey_hex())
            .field("status", &self.status())
            .finish()
    }
}

pub struct ChatCoreBuilder {
    options: ChatCoreOptions,
    backoff: BackoffPolicy,
}

impl ChatCoreBuilder {
    pub fn new(options: ChatCoreOptions) -> Self {
        Self {
            options,
            backoff: BackoffPolicy::default(),
        }
    }

    pub fn with_backoff(mut self, backoff: BackoffPolicy) -> Self {
        self.backoff = backoff;
        self
    }

    pub fn build(self) -> Result<ChatCore, ChatError> {
        let relay = self.options.relay_url.trim().to_string();
        if !(relay.starts_with("ws://") || relay.starts_with("wss://")) {
            return Err(ChatError::InvalidOptions(format!(
                "relayUrl must be ws:// or wss://, got {relay:?}"
            )));
        }
        if self.options.db_path.trim().is_empty() {
            return Err(ChatError::InvalidOptions("dbPath must not be empty".into()));
        }
        let keys = Keys::from_hex(&self.options.secret_key_hex)?;
        let store = Store::open(&self.options.db_path)?;
        let mut subscriptions = HashMap::new();
        for channel in &self.options.channels {
            subscriptions.insert(channel.clone(), sub_id_for(channel));
        }
        let inner = Inner {
            options: ChatCoreOptions {
                relay_url: relay,
                ..self.options
            },
            keys,
            store: Mutex::new(store),
            backoff: self.backoff,
            status: Mutex::new(ChatCoreStatus::offline()),
            subscriptions: Mutex::new(subscriptions),
            listeners: Listeners::default(),
            commands: Mutex::new(None),
            shutdown: Notify::new(),
            stopped: AtomicBool::new(false),
            started: AtomicBool::new(false),
            task: Mutex::new(None),
        };
        Ok(ChatCore {
            inner: Arc::new(inner),
        })
    }
}

impl ChatCore {
    pub fn new(options: ChatCoreOptions) -> Result<Self, ChatError> {
        ChatCoreBuilder::new(options).build()
    }

    pub fn builder(options: ChatCoreOptions) -> ChatCoreBuilder {
        ChatCoreBuilder::new(options)
    }

    pub fn pubkey_hex(&self) -> &str {
        self.inner.keys.pubkey_hex()
    }

    pub fn status(&self) -> ChatCoreStatus {
        self.inner
            .status
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|_| ChatCoreStatus::offline())
    }

    /// Open the cache at `db_path` without starting the connection loop.
    pub fn store(&self) -> Result<MutexGuard<'_, Store>, ChatError> {
        lock(&self.inner.store)
    }

    // ---- lifecycle ---------------------------------------------------------

    pub async fn start(&self) -> Result<(), ChatError> {
        if self.inner.started.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        self.inner.stopped.store(false, Ordering::SeqCst);
        let (tx, rx) = mpsc::unbounded_channel();
        *lock(&self.inner.commands)? = Some(tx);
        let inner = Arc::clone(&self.inner);
        let handle = tokio::spawn(run_loop(inner, rx));
        *lock(&self.inner.task)? = Some(handle);
        Ok(())
    }

    pub async fn stop(&self) -> Result<(), ChatError> {
        self.inner.stopped.store(true, Ordering::SeqCst);
        self.inner.shutdown.notify_one();
        let handle = lock(&self.inner.task)?.take();
        if let Some(handle) = handle {
            let _ = handle.await;
        }
        *lock(&self.inner.commands)? = None;
        self.inner.started.store(false, Ordering::SeqCst);
        self.inner.set_status(ChatCoreStatus::offline());
        Ok(())
    }

    // ---- subscriptions -----------------------------------------------------

    pub async fn subscribe(&self, channel: &str) -> Result<(), ChatError> {
        let sub_id = sub_id_for(channel);
        lock(&self.inner.subscriptions)?.insert(channel.to_string(), sub_id.clone());
        // Errors here only mean "not connected yet": the intent is recorded and
        // applied on the next connect.
        let _ = self.send_command(Command::Subscribe {
            channel: channel.to_string(),
            sub_id,
        });
        Ok(())
    }

    pub async fn unsubscribe(&self, channel: &str) -> Result<(), ChatError> {
        let removed = lock(&self.inner.subscriptions)?.remove(channel);
        if let Some(sub_id) = removed {
            let _ = self.send_command(Command::Unsubscribe { sub_id });
        }
        Ok(())
    }

    // ---- sending -----------------------------------------------------------

    pub async fn send_message(
        &self,
        channel: &str,
        content: &str,
    ) -> Result<MessageRef, ChatError> {
        let event = self.inner.keys.sign_event(
            KIND_STREAM_MESSAGE,
            vec![vec!["h".to_string(), channel.to_string()]],
            content,
            unix_seconds(),
        );
        self.queue_event(&event)?;
        Ok(MessageRef::new(event.id))
    }

    pub async fn edit_message(&self, id: &str, content: &str) -> Result<MessageRef, ChatError> {
        let existing = self
            .inner
            .with_store(|store| store.get_event(id))?
            .ok_or_else(|| ChatError::NotFound(format!("message {id} is not cached")))?;
        let event = self.inner.keys.sign_event(
            existing.kind,
            vec![
                vec!["h".to_string(), existing.channel_id.clone()],
                vec![
                    "e".to_string(),
                    id.to_string(),
                    String::new(),
                    "edit".to_string(),
                ],
            ],
            content,
            unix_seconds(),
        );
        self.queue_event(&event)?;
        self.inner
            .with_store(|store| store.mark_event_edited(id, content, event.created_at))?;
        Ok(MessageRef::new(id))
    }

    pub async fn delete_message(&self, id: &str) -> Result<MessageRef, ChatError> {
        let existing = self
            .inner
            .with_store(|store| store.get_event(id))?
            .ok_or_else(|| ChatError::NotFound(format!("message {id} is not cached")))?;
        let mut tags = vec![vec!["e".to_string(), id.to_string()]];
        if !existing.channel_id.is_empty() {
            tags.push(vec!["h".to_string(), existing.channel_id.clone()]);
        }
        let event = self
            .inner
            .keys
            .sign_event(KIND_DELETE, tags, "", unix_seconds());
        self.queue_event(&event)?;
        self.inner
            .with_store(|store| store.mark_event_deleted(id, event.created_at))?;
        Ok(MessageRef::new(id))
    }

    /// Ephemeral typing indicator. Never persisted and never queued for replay.
    pub async fn publish_typing(&self, channel: &str, until_ms: i64) -> Result<(), ChatError> {
        if self.status().state != crate::types::ConnectionState::Connected {
            return Ok(());
        }
        let event = self.inner.keys.sign_event(
            EPHEMERAL_TYPING,
            vec![
                vec!["h".to_string(), channel.to_string()],
                vec!["until".to_string(), until_ms.to_string()],
            ],
            "",
            unix_seconds(),
        );
        let _ = self.send_command(Command::Publish { event });
        Ok(())
    }

    /// Persist into the outbox, then try to put it on the wire right away.
    ///
    /// Edit envelopes (`["e", id, "", "edit"]`) are *not* inserted into the
    /// message cache — they rewrite the target row via `mark_event_edited`.
    /// Inserting them as kind-9 rows would duplicate FTS hits (see
    /// `edits_and_deletes_update_the_local_cache`). Deletion envelopes (kind 5)
    /// still go into the table; `kind_exclusion` keeps them out of lists/search.
    fn queue_event(&self, event: &Event) -> Result<(), ChatError> {
        self.inner.with_store(|store| {
            if !is_edit_event(event) {
                store.insert_event_with_pending(event, true)?;
            }
            store.outbox_enqueue(event)?;
            Ok(())
        })?;
        let _ = self.send_command(Command::Publish {
            event: event.clone(),
        });
        Ok(())
    }

    // ---- reads -------------------------------------------------------------

    pub async fn list_messages(
        &self,
        channel: &str,
        options: ListOptions,
    ) -> Result<Vec<ChatMessage>, ChatError> {
        self.inner
            .with_store(|store| store.list_messages(channel, &options))
    }

    pub async fn search_messages(
        &self,
        query: &str,
        options: SearchOptions,
    ) -> Result<Vec<ChatMessage>, ChatError> {
        self.inner
            .with_store(|store| store.search_messages(query, &options))
    }

    pub async fn mark_read(&self, channel: &str, seq: i64) -> Result<(), ChatError> {
        let now = unix_millis();
        self.inner
            .with_store(|store| store.set_read_state(channel, seq, now))
    }

    pub async fn pending_count(&self) -> Result<usize, ChatError> {
        self.inner.with_store(|store| store.outbox_pending_count())
    }

    /// Replay every unacknowledged event, oldest first. Entries stay pending
    /// until the relay answers with `OK true`.
    pub async fn flush_outbox(&self) -> Result<(), ChatError> {
        let pending = self.inner.with_store(|store| store.outbox_pending())?;
        for entry in pending {
            let event = entry.event()?;
            let _ = self.send_command(Command::Publish { event });
        }
        Ok(())
    }

    // ---- callbacks ---------------------------------------------------------

    pub fn on_message(&self, callback: impl Fn(ChatMessage) + Send + Sync + 'static) -> u64 {
        let id = self.inner.listeners.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut guard) = self.inner.listeners.message.lock() {
            guard.push((id, Arc::new(callback)));
        }
        id
    }

    pub fn on_presence(&self, callback: impl Fn(PresenceEntry) + Send + Sync + 'static) -> u64 {
        let id = self.inner.listeners.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut guard) = self.inner.listeners.presence.lock() {
            guard.push((id, Arc::new(callback)));
        }
        id
    }

    pub fn on_typing(&self, callback: impl Fn(TypingEntry) + Send + Sync + 'static) -> u64 {
        let id = self.inner.listeners.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut guard) = self.inner.listeners.typing.lock() {
            guard.push((id, Arc::new(callback)));
        }
        id
    }

    /// Registers a status listener and immediately reports the current status.
    pub fn on_status(&self, callback: impl Fn(ChatCoreStatus) + Send + Sync + 'static) -> u64 {
        let id = self.inner.listeners.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let callback: StatusListener = Arc::new(callback);
        if let Ok(mut guard) = self.inner.listeners.status.lock() {
            guard.push((id, callback.clone()));
        }
        callback(self.status());
        id
    }

    /// Removes a listener registered by any of the `on_*` methods.
    pub fn off(&self, id: u64) -> bool {
        let mut removed = false;
        if let Ok(mut guard) = self.inner.listeners.message.lock() {
            let before = guard.len();
            guard.retain(|(listener_id, _)| *listener_id != id);
            removed |= guard.len() != before;
        }
        if let Ok(mut guard) = self.inner.listeners.presence.lock() {
            let before = guard.len();
            guard.retain(|(listener_id, _)| *listener_id != id);
            removed |= guard.len() != before;
        }
        if let Ok(mut guard) = self.inner.listeners.typing.lock() {
            let before = guard.len();
            guard.retain(|(listener_id, _)| *listener_id != id);
            removed |= guard.len() != before;
        }
        if let Ok(mut guard) = self.inner.listeners.status.lock() {
            let before = guard.len();
            guard.retain(|(listener_id, _)| *listener_id != id);
            removed |= guard.len() != before;
        }
        removed
    }

    fn send_command(&self, command: Command) -> Result<(), ChatError> {
        let guard = lock(&self.inner.commands)?;
        match guard.as_ref() {
            Some(tx) => tx.send(command).map_err(|_| ChatError::Stopped),
            None => Err(ChatError::NotStarted),
        }
    }
}

// ---- connection loop -------------------------------------------------------

fn presence_from_event(event: &Event) -> PresenceEntry {
    let payload: serde_json::Value = serde_json::from_str(&event.content).unwrap_or_default();
    let status = event
        .tags
        .iter()
        .find(|tag| tag.first().map(String::as_str) == Some("status"))
        .and_then(|tag| tag.get(1))
        .map(String::as_str)
        .or_else(|| payload.get("status").and_then(|v| v.as_str()))
        .unwrap_or("online");
    let user_id = event_tag_values(event, "d")
        .into_iter()
        .next()
        .or_else(|| {
            payload
                .get("userId")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| event.pubkey.clone());
    let last_seen_at = payload
        .get("lastSeenAt")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(|| event.created_at.saturating_mul(1000));
    PresenceEntry {
        user_id,
        pubkey: event.pubkey.clone(),
        status: PresenceStatus::parse(status),
        last_seen_at,
    }
}

fn typing_from_event(event: &Event) -> TypingEntry {
    let payload: serde_json::Value = serde_json::from_str(&event.content).unwrap_or_default();
    let channel_id = event_tag_values(event, "h")
        .into_iter()
        .next()
        .or_else(|| {
            payload
                .get("channelId")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();
    let until = event_tag_values(event, "until")
        .into_iter()
        .next()
        .and_then(|raw| raw.parse::<i64>().ok())
        .or_else(|| payload.get("until").and_then(|v| v.as_i64()))
        .unwrap_or_else(|| event.created_at.saturating_mul(1000).saturating_add(10_000));
    TypingEntry {
        channel_id,
        pubkey: event.pubkey.clone(),
        until,
    }
}

async fn run_loop(inner: Arc<Inner>, mut commands: mpsc::UnboundedReceiver<Command>) {
    // `failures` counts consecutive failed connections; it drives the backoff
    // and resets as soon as a WebSocket session is established.
    let mut failures: u32 = 0;
    loop {
        if inner.stopped.load(Ordering::SeqCst) {
            inner.set_status(ChatCoreStatus::offline());
            return;
        }
        failures = failures.saturating_add(1);
        inner.set_status(ChatCoreStatus::reconnecting(failures));
        let connect = tokio::select! {
            biased;
            _ = inner.shutdown.notified() => {
                inner.set_status(ChatCoreStatus::offline());
                return;
            }
            result = tokio_tungstenite::connect_async(inner.options.relay_url.as_str()) => result,
        };
        if let Ok((ws, _response)) = connect {
            failures = 0;
            inner.set_status(ChatCoreStatus::connected());
            if !session(&inner, ws, &mut commands).await {
                inner.set_status(ChatCoreStatus::offline());
                return;
            }
        }
        if inner.stopped.load(Ordering::SeqCst) {
            inner.set_status(ChatCoreStatus::offline());
            return;
        }
        let delay = inner.backoff.delay(failures.max(1));
        tokio::select! {
            biased;
            _ = inner.shutdown.notified() => {
                inner.set_status(ChatCoreStatus::offline());
                return;
            }
            _ = tokio::time::sleep(delay) => {}
        }
    }
}

/// Runs one WebSocket session. Returns `true` when the caller should reconnect
/// and `false` when the client was stopped.
async fn session<S>(
    inner: &Arc<Inner>,
    ws: tokio_tungstenite::WebSocketStream<S>,
    commands: &mut mpsc::UnboundedReceiver<Command>,
) -> bool
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (mut sink, mut stream) = ws.split();

    // Re-subscribe: the subscription map is the source of truth, so a reconnect
    // (or a channel subscribed while offline) always replays its filters.
    let subscriptions: Vec<(String, String)> = match inner.subscriptions.lock() {
        Ok(guard) => guard.iter().map(|(c, s)| (c.clone(), s.clone())).collect(),
        Err(_) => Vec::new(),
    };
    for (channel, sub_id) in subscriptions {
        let frame = ClientFrame::Req {
            sub_id,
            filters: vec![Filter::channel(&channel)],
        };
        if sink
            .send(Message::Text(frame.to_json().into()))
            .await
            .is_err()
        {
            return true;
        }
    }

    // Replay unacknowledged events in insertion order.
    if let Ok(pending) = inner.with_store(|store| store.outbox_pending()) {
        for entry in pending {
            let Ok(event) = entry.event() else { continue };
            let frame = ClientFrame::Event(event);
            if sink
                .send(Message::Text(frame.to_json().into()))
                .await
                .is_err()
            {
                return true;
            }
        }
    }

    loop {
        tokio::select! {
            biased;
            _ = inner.shutdown.notified() => {
                let _ = sink.close().await;
                return false;
            }
            command = commands.recv() => match command {
                None => {
                    let _ = sink.close().await;
                    return false;
                }
                Some(command) => {
                    let frame = frame_for_command(command);
                    if sink.send(Message::Text(frame.to_json().into())).await.is_err() {
                        return true;
                    }
                }
            },
            incoming = stream.next() => match incoming {
                Some(Ok(message)) => match message {
                    Message::Text(text) => {
                        if !dispatch_text(inner, text.as_str(), &mut sink).await {
                            return true;
                        }
                    }
                    Message::Binary(bytes) => {
                        if let Ok(text) = std::str::from_utf8(&bytes) {
                            if !dispatch_text(inner, text, &mut sink).await {
                                return true;
                            }
                        }
                    }
                    Message::Ping(payload) => {
                        let _ = sink.send(Message::Pong(payload)).await;
                    }
                    Message::Close(_) => return true,
                    _ => {}
                },
                Some(Err(_)) | None => return true,
            }
        }
    }
}

fn frame_for_command(command: Command) -> ClientFrame {
    match command {
        Command::Subscribe { channel, sub_id } => ClientFrame::Req {
            sub_id,
            filters: vec![Filter::channel(&channel)],
        },
        Command::Unsubscribe { sub_id } => ClientFrame::Close { sub_id },
        Command::Publish { event } => ClientFrame::Event(event),
    }
}

/// Handles one relay frame, sending any reply. Returns `false` on a send error.
async fn dispatch_text<S>(
    inner: &Arc<Inner>,
    text: &str,
    sink: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<S>, Message>,
) -> bool
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let Some(reply) = handle_text(inner, text) else {
        return true;
    };
    sink.send(Message::Text(reply.to_json().into()))
        .await
        .is_ok()
}

/// Handle one relay frame. Returns a frame to send back (an `AUTH` reply).
fn handle_text(inner: &Arc<Inner>, text: &str) -> Option<ClientFrame> {
    let frame = RelayFrame::parse_str(text).ok()?;
    match frame {
        RelayFrame::Event { event, .. } => {
            inner.accept_event(event);
            None
        }
        RelayFrame::Ok {
            event_id, accepted, ..
        } => {
            if accepted {
                let _ = inner.with_store(|store| store.outbox_mark_sent(&event_id));
                let _ = inner.with_store(|store| store.set_event_pending(&event_id, false));
            } else {
                let _ = inner.with_store(|store| store.outbox_mark_attempt(&event_id));
            }
            None
        }
        RelayFrame::Auth { challenge } => {
            let tags = vec![
                vec!["relay".to_string(), inner.options.relay_url.clone()],
                vec!["challenge".to_string(), challenge],
            ];
            let event = inner.keys.sign_event(KIND_AUTH, tags, "", unix_seconds());
            Some(ClientFrame::Auth(event))
        }
        RelayFrame::Eose { .. } | RelayFrame::Notice { .. } | RelayFrame::Unknown { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::{reserve_port, wait_for, MockRelay};
    use crate::types::ConnectionState;
    use serde_json::json;
    use std::path::Path;
    use std::sync::Mutex as StdMutex;
    use std::time::Duration;

    const TIMEOUT: Duration = Duration::from_secs(5);
    const TEST_KEY: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const PEER_KEY: &str = "0000000000000000000000000000000000000000000000000000000000000002";

    fn options(relay_url: String, dir: &Path) -> ChatCoreOptions {
        ChatCoreOptions {
            relay_url,
            db_path: dir.join("chat.db").to_string_lossy().into_owned(),
            secret_key_hex: TEST_KEY.to_string(),
            channels: vec!["chan-1".to_string()],
        }
    }

    fn core_with(relay_url: &str, dir: &Path) -> ChatCore {
        ChatCore::builder(options(relay_url.to_string(), dir))
            .with_backoff(BackoffPolicy::fast())
            .build()
            .expect("build core")
    }

    fn peer_event(content: &str) -> Event {
        Keys::from_hex(PEER_KEY).unwrap().sign_event(
            KIND_STREAM_MESSAGE,
            vec![vec!["h".to_string(), "chan-1".to_string()]],
            content,
            unix_seconds(),
        )
    }

    /// Pending outbox rows, read synchronously (the store guard is never held
    /// across an await, so this cannot deadlock the single-threaded test runtime).
    fn pending(core: &ChatCore) -> usize {
        core.store().unwrap().outbox_pending_count().unwrap()
    }

    fn drains(core: &ChatCore) -> bool {
        pending(core) == 0
    }

    #[test]
    fn backoff_grows_exponentially_and_caps() {
        let policy = BackoffPolicy {
            base: Duration::from_millis(10),
            max: Duration::from_millis(100),
            factor: 2,
        };
        assert_eq!(policy.delay(1), Duration::from_millis(10));
        assert_eq!(policy.delay(2), Duration::from_millis(20));
        assert_eq!(policy.delay(3), Duration::from_millis(40));
        assert_eq!(policy.delay(4), Duration::from_millis(80));
        assert_eq!(policy.delay(5), Duration::from_millis(100), "capped at max");
        assert_eq!(policy.delay(50), Duration::from_millis(100), "no overflow");
        assert!(BackoffPolicy::fast().delay(1) < BackoffPolicy::default().delay(1));
    }

    #[test]
    fn rejects_bad_options() {
        let dir = tempfile::tempdir().unwrap();
        let mut opts = options("http://relay".into(), dir.path());
        assert!(matches!(
            ChatCore::new(opts.clone()),
            Err(ChatError::InvalidOptions(_))
        ));
        opts.relay_url = "ws://127.0.0.1:1".into();
        opts.db_path = "  ".into();
        assert!(matches!(
            ChatCore::new(opts.clone()),
            Err(ChatError::InvalidOptions(_))
        ));
        opts.db_path = dir.path().join("c.db").to_string_lossy().into_owned();
        opts.secret_key_hex = "nope".into();
        assert!(matches!(ChatCore::new(opts), Err(ChatError::Key(_))));
    }

    #[tokio::test]
    async fn connects_subscribes_and_delivers_messages() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        let seen: Arc<StdMutex<Vec<ChatMessage>>> = Arc::new(StdMutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        core.on_message(move |message| sink.lock().unwrap().push(message));

        let statuses: Arc<StdMutex<Vec<ChatCoreStatus>>> = Arc::new(StdMutex::new(Vec::new()));
        let status_sink = Arc::clone(&statuses);
        core.on_status(move |status| status_sink.lock().unwrap().push(status));
        assert_eq!(
            statuses.lock().unwrap().last().unwrap().state,
            ConnectionState::Offline,
            "on_status reports the current state immediately"
        );

        core.start().await.unwrap();
        assert!(
            wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await,
            "client never subscribed"
        );
        let req = relay.frames_with_label("REQ")[0].clone();
        assert_eq!(req[1], json!("rox-chat-chan-1"));
        assert_eq!(req[2]["#h"], json!(["chan-1"]));
        assert!(req[2]["kinds"].as_array().unwrap().contains(&json!(9)));

        assert!(
            wait_for(
                || core.status().state == ConnectionState::Connected,
                TIMEOUT
            )
            .await,
            "status never became connected"
        );

        let event = peer_event("hello from a peer");
        relay
            .send_json(&json!(["EVENT", "rox-chat-chan-1", event]))
            .await;
        assert!(
            wait_for(|| !seen.lock().unwrap().is_empty(), TIMEOUT).await,
            "callback never fired"
        );

        let messages = seen.lock().unwrap().clone();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "hello from a peer");
        assert_eq!(messages[0].id, event.id);
        assert_eq!(messages[0].channel_id, "chan-1");
        assert_eq!(
            messages[0].pubkey,
            Keys::from_hex(PEER_KEY).unwrap().pubkey_hex()
        );

        let cached = core
            .list_messages("chan-1", ListOptions::default())
            .await
            .unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].id, event.id);

        core.stop().await.unwrap();
        assert_eq!(core.status().state, ConnectionState::Offline);
        assert!(statuses
            .lock()
            .unwrap()
            .iter()
            .any(|s| s.state == ConnectionState::Connected));
    }

    #[tokio::test]
    async fn drops_events_with_a_broken_signature() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        let seen: Arc<StdMutex<Vec<ChatMessage>>> = Arc::new(StdMutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        core.on_message(move |message| sink.lock().unwrap().push(message));

        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);

        let mut tampered = peer_event("honest");
        tampered.content = "tampered".into();
        relay
            .send_json(&json!(["EVENT", "rox-chat-chan-1", tampered]))
            .await;
        tokio::time::sleep(Duration::from_millis(100)).await;

        assert!(
            seen.lock().unwrap().is_empty(),
            "invalid event was delivered"
        );
        assert!(core
            .list_messages("chan-1", ListOptions::default())
            .await
            .unwrap()
            .is_empty());
        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn reconnects_with_backoff_and_resubscribes() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());

        let statuses: Arc<StdMutex<Vec<ChatCoreStatus>>> = Arc::new(StdMutex::new(Vec::new()));
        let status_sink = Arc::clone(&statuses);
        core.on_status(move |status| status_sink.lock().unwrap().push(status));

        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);
        assert_eq!(relay.connection_count(), 1);

        // Drop repeatedly while polling: `Notify::notify_waiters` is only
        // delivered to tasks that are waiting at that moment.
        assert!(
            wait_for(
                || {
                    relay.drop_connections();
                    relay.connection_count() >= 2
                },
                TIMEOUT
            )
            .await,
            "client did not reconnect"
        );
        assert!(
            wait_for(|| relay.count_label("REQ") >= 2, TIMEOUT).await,
            "client did not resubscribe after reconnect"
        );
        let statuses = statuses.lock().unwrap().clone();
        assert!(statuses
            .iter()
            .any(|s| s.state == ConnectionState::Reconnecting && s.attempt.unwrap_or(0) >= 1));
        assert!(
            statuses
                .iter()
                .filter(|s| s.state == ConnectionState::Connected)
                .count()
                >= 2
        );

        core.stop().await.unwrap();

        // Once stopped the loop must not dial again.
        let connections = relay.connection_count();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(relay.connection_count(), connections);
    }

    #[tokio::test]
    async fn send_message_persists_until_the_relay_acknowledges_it() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);

        let sent = core.send_message("chan-1", "hello relay").await.unwrap();
        assert!(
            wait_for(|| relay.count_label("EVENT") >= 1, TIMEOUT).await,
            "event was never published"
        );
        let frame = relay.frames_with_label("EVENT")[0].clone();
        assert_eq!(frame[1]["id"], json!(sent.id));
        assert_eq!(frame[1]["content"], json!("hello relay"));
        assert_eq!(frame[1]["kind"], json!(9));
        assert_eq!(frame[1]["tags"], json!([["h", "chan-1"]]));
        assert_eq!(frame[1]["pubkey"], json!(core.pubkey_hex()));

        // Locally mirrored as pending until the relay says OK.
        assert_eq!(core.pending_count().await.unwrap(), 1);
        let cached = core
            .list_messages("chan-1", ListOptions::default())
            .await
            .unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].pending, Some(true));

        relay
            .send_json(&json!(["OK", sent.id, true, "saved"]))
            .await;
        assert!(
            wait_for(|| drains(&core), TIMEOUT).await,
            "OK did not ack the outbox entry"
        );
        let cached = core
            .list_messages("chan-1", ListOptions::default())
            .await
            .unwrap();
        assert_eq!(cached[0].pending, None);

        relay
            .send_json(&json!([
                "OK",
                sent.id,
                false,
                "duplicate: already have this"
            ]))
            .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(core.pending_count().await.unwrap(), 0, "stays acked");

        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn flush_replays_pending_events_in_order_after_reconnect() {
        let port = reserve_port().await;
        let dir = tempfile::tempdir().unwrap();
        // Nothing is listening yet: every send has to wait in the outbox.
        let core = core_with(&format!("ws://127.0.0.1:{port}"), dir.path());
        core.start().await.unwrap();

        let first = core.send_message("chan-1", "one").await.unwrap();
        let second = core.send_message("chan-1", "two").await.unwrap();
        let third = core.send_message("chan-1", "three").await.unwrap();
        assert_eq!(core.pending_count().await.unwrap(), 3);

        let relay = MockRelay::start_on(port).await;
        assert!(
            wait_for(|| relay.count_label("EVENT") >= 3, TIMEOUT).await,
            "outbox was never replayed"
        );
        let ids: Vec<String> = relay
            .frames_with_label("EVENT")
            .iter()
            .filter_map(|frame| frame[1]["id"].as_str().map(str::to_string))
            .collect();
        assert_eq!(
            &ids[..3],
            &[first.id.clone(), second.id.clone(), third.id.clone()],
            "replay must preserve insertion order"
        );

        for id in [&first.id, &second.id, &third.id] {
            relay.send_json(&json!(["OK", id, true, ""])).await;
        }
        assert!(
            wait_for(|| drains(&core), TIMEOUT).await,
            "acks did not drain the outbox"
        );

        // A reconnect must not resurrect acknowledged events.
        let before = relay.count_label("EVENT");
        assert!(
            wait_for(
                || {
                    relay.drop_connections();
                    relay.connection_count() >= 2
                },
                TIMEOUT
            )
            .await
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            relay.count_label("EVENT"),
            before,
            "acked events were replayed"
        );
        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn flush_outbox_sends_queued_events_on_demand() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);

        let sent = core.send_message("chan-1", "queue me").await.unwrap();
        assert!(wait_for(|| relay.count_label("EVENT") >= 1, TIMEOUT).await);
        core.flush_outbox().await.unwrap();
        assert!(
            wait_for(|| relay.count_label("EVENT") >= 2, TIMEOUT).await,
            "flush did not resend the pending event"
        );
        let frames = relay.frames_with_label("EVENT");
        assert_eq!(frames[0][1]["id"], json!(sent.id));
        assert_eq!(frames[1][1]["id"], json!(sent.id));
        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn surfaces_presence_and_typing_without_persisting_them() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        let presence: Arc<StdMutex<Vec<PresenceEntry>>> = Arc::new(StdMutex::new(Vec::new()));
        let typing: Arc<StdMutex<Vec<TypingEntry>>> = Arc::new(StdMutex::new(Vec::new()));
        let presence_sink = Arc::clone(&presence);
        let typing_sink = Arc::clone(&typing);
        core.on_presence(move |entry| presence_sink.lock().unwrap().push(entry));
        core.on_typing(move |entry| typing_sink.lock().unwrap().push(entry));

        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);

        let keys = Keys::from_hex(PEER_KEY).unwrap();
        let presence_event = keys.sign_event(
            EPHEMERAL_PRESENCE,
            vec![
                vec!["d".to_string(), "user-42".to_string()],
                vec!["status".to_string(), "away".to_string()],
            ],
            r#"{"status":"away","lastSeenAt":1700000000000}"#,
            unix_seconds(),
        );
        relay
            .send_json(&json!(["EVENT", "rox-chat-chan-1", presence_event]))
            .await;
        assert!(
            wait_for(|| !presence.lock().unwrap().is_empty(), TIMEOUT).await,
            "presence callback never fired"
        );
        let entry = presence.lock().unwrap()[0].clone();
        assert_eq!(entry.user_id, "user-42");
        assert_eq!(entry.status, PresenceStatus::Away);
        assert_eq!(entry.last_seen_at, 1_700_000_000_000);
        assert_eq!(entry.pubkey, keys.pubkey_hex());

        let typing_event = keys.sign_event(
            EPHEMERAL_TYPING,
            vec![
                vec!["h".to_string(), "chan-1".to_string()],
                vec!["until".to_string(), "1700000005000".to_string()],
            ],
            "",
            unix_seconds(),
        );
        relay
            .send_json(&json!(["EVENT", "rox-chat-chan-1", typing_event]))
            .await;
        assert!(
            wait_for(|| !typing.lock().unwrap().is_empty(), TIMEOUT).await,
            "typing callback never fired"
        );
        let entry = typing.lock().unwrap()[0].clone();
        assert_eq!(entry.channel_id, "chan-1");
        assert_eq!(entry.until, 1_700_000_005_000);

        {
            let store = core.store().unwrap();
            assert_eq!(
                store.count_events().unwrap(),
                0,
                "ephemeral events must not be cached"
            );
        }

        // Publishing a typing ping while offline is a no-op, not an error.
        core.stop().await.unwrap();
        core.publish_typing("chan-1", unix_millis() + 5_000)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn answers_auth_challenges_with_a_signed_ephemeral_event() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);

        relay.send_json(&json!(["AUTH", "challenge-abc"])).await;
        assert!(
            wait_for(|| relay.count_label("AUTH") >= 1, TIMEOUT).await,
            "client did not answer the AUTH challenge"
        );
        let frame = relay.frames_with_label("AUTH")[0].clone();
        let event: Event = serde_json::from_value(frame[1].clone()).unwrap();
        assert_eq!(event.kind, KIND_AUTH);
        assert_eq!(event.pubkey, core.pubkey_hex());
        assert!(verify_event(&event).is_ok(), "auth event signature invalid");
        assert_eq!(
            event_tag_values(&event, "challenge"),
            vec!["challenge-abc".to_string()]
        );
        assert_eq!(event_tag_values(&event, "relay"), vec![relay.url()]);
        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn ignores_notice_eose_and_unknown_frames() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);
        relay.send_json(&json!(["NOTICE", "welcome"])).await;
        relay.send_json(&json!(["EOSE", "rox-chat-chan-1"])).await;
        relay.send_json(&json!(["COUNT", 3])).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(core.status().state, ConnectionState::Connected);
        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn subscription_changes_are_applied_while_connected_and_offline() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);

        core.subscribe("chan-2").await.unwrap();
        assert!(
            wait_for(
                || relay
                    .frames_with_label("REQ")
                    .iter()
                    .any(|f| f[1] == json!("rox-chat-chan-2")),
                TIMEOUT
            )
            .await,
            "new subscription was not sent"
        );
        assert_eq!(
            relay.frames_with_label("REQ")[1][2]["#h"],
            json!(["chan-2"])
        );

        core.unsubscribe("chan-1").await.unwrap();
        assert!(
            wait_for(|| relay.count_label("CLOSE") >= 1, TIMEOUT).await,
            "CLOSE was not sent"
        );
        assert_eq!(
            relay.frames_with_label("CLOSE")[0][1],
            json!("rox-chat-chan-1")
        );

        // Subscribing while disconnected must be replayed on the next connect.
        core.stop().await.unwrap();
        core.subscribe("chan-3").await.unwrap();
        let conns = relay.connection_count();
        core.start().await.unwrap();
        assert!(
            wait_for(
                || relay.connection_count() > conns
                    && relay
                        .frames_with_label("REQ")
                        .iter()
                        .any(|f| f[1] == json!("rox-chat-chan-3")),
                TIMEOUT
            )
            .await,
            "offline subscription was not replayed"
        );
        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn edits_and_deletes_update_the_local_cache() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);

        let sent = core.send_message("chan-1", "typo").await.unwrap();
        assert!(wait_for(|| relay.count_label("EVENT") >= 1, TIMEOUT).await);

        let edited = core.edit_message(&sent.id, "fixed").await.unwrap();
        assert_eq!(edited.id, sent.id);
        let cached = core
            .list_messages("chan-1", ListOptions::default())
            .await
            .unwrap();
        assert_eq!(cached[0].content, "fixed");
        assert!(cached[0].edited_at.is_some());
        assert_eq!(
            core.search_messages("fixed", SearchOptions::default())
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(core
            .search_messages("typo", SearchOptions::default())
            .await
            .unwrap()
            .is_empty());

        let deleted = core.delete_message(&sent.id).await.unwrap();
        assert_eq!(deleted.id, sent.id);
        let cached = core
            .list_messages("chan-1", ListOptions::default())
            .await
            .unwrap();
        assert!(cached[0].deleted_at.is_some());

        assert!(matches!(
            core.edit_message("missing-id", "x").await,
            Err(ChatError::NotFound(_))
        ));

        // The edit and the deletion both reached the relay.
        assert!(
            wait_for(|| relay.count_label("EVENT") >= 3, TIMEOUT).await,
            "edit/delete were not published"
        );
        let published = relay.frames_with_label("EVENT");
        assert_eq!(published[1][1]["kind"], json!(9));
        assert_eq!(
            published[1][1]["tags"][1],
            json!(["e", sent.id, "", "edit"])
        );
        assert_eq!(published[2][1]["kind"], json!(5));
        assert_eq!(published[2][1]["tags"][0], json!(["e", sent.id]));
        core.stop().await.unwrap();
    }

    #[tokio::test]
    async fn mark_read_is_persisted() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("chat.db");
        {
            let core = core_with(&relay.url(), dir.path());
            core.mark_read("chan-1", 7).await.unwrap();
            assert_eq!(core.store().unwrap().read_state("chan-1").unwrap(), 7);
        }
        let reopened = Store::open(db_path.to_str().unwrap()).unwrap();
        assert_eq!(reopened.read_state("chan-1").unwrap(), 7);
    }

    #[tokio::test]
    async fn the_relay_key_is_never_written_to_disk() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        {
            let core = core_with(&relay.url(), dir.path());
            core.start().await.unwrap();
            assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);
            core.send_message("chan-1", "persist me").await.unwrap();
            assert!(wait_for(|| relay.count_label("EVENT") >= 1, TIMEOUT).await);
            core.stop().await.unwrap();
        }

        let mut bytes = Vec::new();
        for entry in std::fs::read_dir(dir.path()).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                bytes.extend(std::fs::read(&path).unwrap());
            }
        }
        assert!(!bytes.is_empty(), "cache files should exist");
        let needle = TEST_KEY.as_bytes();
        assert!(
            !bytes.windows(needle.len()).any(|window| window == needle),
            "the raw relay secret leaked into the cache"
        );
        // The public key, by contrast, is expected to be cached with the events.
        let public = Keys::from_hex(TEST_KEY).unwrap().pubkey_hex().to_string();
        let public_needle = public.as_bytes();
        assert!(bytes
            .windows(public_needle.len())
            .any(|window| window == public_needle));
    }

    #[tokio::test]
    async fn start_and_stop_are_idempotent() {
        let relay = MockRelay::start().await;
        let dir = tempfile::tempdir().unwrap();
        let core = core_with(&relay.url(), dir.path());
        core.start().await.unwrap();
        core.start().await.unwrap();
        assert!(wait_for(|| relay.count_label("REQ") >= 1, TIMEOUT).await);
        core.stop().await.unwrap();
        core.stop().await.unwrap();
        assert_eq!(core.status().state, ConnectionState::Offline);
    }
}
