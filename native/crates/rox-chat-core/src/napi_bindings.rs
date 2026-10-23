//! napi-rs bindings for the JS package (`@rox/chat-core`).
//!
//! Compiled only with the `napi-bindings` feature. The core modules never
//! reference napi, so `cargo test`/`cargo build` without the feature links no
//! Node symbols.

// napi-derive omits its registration glue under `cfg(test)`, so the exported
// items look unused to `cargo clippy --all-targets --features napi-bindings`.
#![cfg_attr(test, allow(dead_code))]

use crate::types::{
    ChatCoreStatus, ChatMessage, ConnectionState, ListOptions, PresenceEntry, SearchOptions,
    TypingEntry,
};
use crate::{ChatCore, ChatCoreOptions, ChatError};
// NB: signatures must spell `Result<..>` literally — napi-derive detects
// fallible async exports by that ident, and an alias (e.g. `NapiResult`) makes
// a rejected call *resolve* with the Error object instead of rejecting.
use napi::bindgen_prelude::{JsFunction, Result};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

fn to_napi(error: ChatError) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

#[napi(object)]
pub struct ChatCoreOptionsJs {
    pub relay_url: String,
    pub db_path: String,
    pub secret_key_hex: String,
    pub channels: Option<Vec<String>>,
}

#[napi(object)]
pub struct ChatMessageJs {
    pub id: String,
    pub channel_id: String,
    pub pubkey: String,
    pub content: String,
    pub created_at: i64,
    pub kind: i64,
    pub tags: Vec<Vec<String>>,
    pub edited_at: Option<i64>,
    pub deleted_at: Option<i64>,
    pub pending: Option<bool>,
}

impl From<ChatMessage> for ChatMessageJs {
    fn from(message: ChatMessage) -> Self {
        Self {
            id: message.id,
            channel_id: message.channel_id,
            pubkey: message.pubkey,
            content: message.content,
            created_at: message.created_at,
            kind: message.kind as i64,
            tags: message.tags,
            edited_at: message.edited_at,
            deleted_at: message.deleted_at,
            pending: message.pending,
        }
    }
}

#[napi(object)]
pub struct PresenceEntryJs {
    pub user_id: String,
    pub pubkey: String,
    pub status: String,
    pub last_seen_at: i64,
}

impl From<PresenceEntry> for PresenceEntryJs {
    fn from(entry: PresenceEntry) -> Self {
        Self {
            user_id: entry.user_id,
            pubkey: entry.pubkey,
            status: entry.status.as_str().to_string(),
            last_seen_at: entry.last_seen_at,
        }
    }
}

#[napi(object)]
pub struct TypingEntryJs {
    pub channel_id: String,
    pub pubkey: String,
    pub until: i64,
}

impl From<TypingEntry> for TypingEntryJs {
    fn from(entry: TypingEntry) -> Self {
        Self {
            channel_id: entry.channel_id,
            pubkey: entry.pubkey,
            until: entry.until,
        }
    }
}

#[napi(object)]
pub struct ChatCoreStatusJs {
    pub state: String,
    pub attempt: Option<u32>,
}

impl From<ChatCoreStatus> for ChatCoreStatusJs {
    fn from(status: ChatCoreStatus) -> Self {
        let state = match status.state {
            ConnectionState::Connected => "connected",
            ConnectionState::Reconnecting => "reconnecting",
            ConnectionState::Offline => "offline",
        };
        Self {
            state: state.to_string(),
            attempt: status.attempt,
        }
    }
}

#[napi(object)]
pub struct MessageRefJs {
    pub id: String,
}

#[napi(object)]
pub struct ListOptionsJs {
    pub limit: Option<u32>,
    pub before: Option<i64>,
}

#[napi(object)]
pub struct SearchOptionsJs {
    pub channel_id: Option<String>,
    pub limit: Option<u32>,
}

// ---- handle registry ---------------------------------------------------------
//
// The addon exposes *free functions over an opaque numeric handle* instead of a
// `#[napi]` class. A napi class makes napi-derive emit `napi_unwrap` +
// raw-pointer dereferences of the wrapped struct (and leaks `&'static self`
// into async futures), which is exactly the pattern CodeQL flags as
// `rust/access-invalid-pointer`. With a handle, every native entry point only
// sees plain values: the `ChatCore` lives in an `Arc` inside this registry, an
// unknown/disposed handle is a normal JS error, and no pointer ever crosses the
// boundary. The JS package (`packages/chat-core/index.js`) wraps the handle
// back into the `ChatCore` object described by `index.d.ts`.

fn registry() -> &'static Mutex<HashMap<u32, Arc<ChatCore>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<u32, Arc<ChatCore>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT_HANDLE: AtomicU32 = AtomicU32::new(1);

fn core_for(handle: u32) -> Result<Arc<ChatCore>> {
    let guard = registry()
        .lock()
        .map_err(|_| napi::Error::from_reason("chat core registry poisoned"))?;
    guard.get(&handle).cloned().ok_or_else(|| {
        napi::Error::from_reason(format!("unknown or disposed chat core handle {handle}"))
    })
}

fn listener_id(id: u64) -> Result<u32> {
    u32::try_from(id).map_err(|_| napi::Error::from_reason("listener id overflow"))
}

/// Builds a chat core and returns its opaque handle.
#[napi]
pub fn chat_core_create(options: ChatCoreOptionsJs) -> Result<u32> {
    let core = ChatCore::new(ChatCoreOptions {
        relay_url: options.relay_url,
        db_path: options.db_path,
        secret_key_hex: options.secret_key_hex,
        channels: options.channels.unwrap_or_default(),
    })
    .map_err(to_napi)?;
    let handle = NEXT_HANDLE.fetch_add(1, Ordering::SeqCst);
    registry()
        .lock()
        .map_err(|_| napi::Error::from_reason("chat core registry poisoned"))?
        .insert(handle, Arc::new(core));
    Ok(handle)
}

/// Drops the registry's reference to a core. Returns `false` for an unknown handle.
#[napi]
pub fn chat_core_dispose(handle: u32) -> Result<bool> {
    let removed = registry()
        .lock()
        .map_err(|_| napi::Error::from_reason("chat core registry poisoned"))?
        .remove(&handle);
    Ok(removed.is_some())
}

#[napi]
pub async fn chat_core_start(handle: u32) -> Result<()> {
    core_for(handle)?.start().await.map_err(to_napi)
}

#[napi]
pub async fn chat_core_stop(handle: u32) -> Result<()> {
    core_for(handle)?.stop().await.map_err(to_napi)
}

#[napi]
pub async fn chat_core_subscribe(handle: u32, channel: String) -> Result<()> {
    core_for(handle)?.subscribe(&channel).await.map_err(to_napi)
}

#[napi]
pub async fn chat_core_unsubscribe(handle: u32, channel: String) -> Result<()> {
    core_for(handle)?
        .unsubscribe(&channel)
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn chat_core_send_message(
    handle: u32,
    channel: String,
    content: String,
) -> Result<MessageRefJs> {
    let sent = core_for(handle)?
        .send_message(&channel, &content)
        .await
        .map_err(to_napi)?;
    Ok(MessageRefJs { id: sent.id })
}

#[napi]
pub async fn chat_core_edit_message(
    handle: u32,
    id: String,
    content: String,
) -> Result<MessageRefJs> {
    let edited = core_for(handle)?
        .edit_message(&id, &content)
        .await
        .map_err(to_napi)?;
    Ok(MessageRefJs { id: edited.id })
}

#[napi]
pub async fn chat_core_delete_message(handle: u32, id: String) -> Result<MessageRefJs> {
    let deleted = core_for(handle)?
        .delete_message(&id)
        .await
        .map_err(to_napi)?;
    Ok(MessageRefJs { id: deleted.id })
}

#[napi]
pub async fn chat_core_list_messages(
    handle: u32,
    channel: String,
    options: Option<ListOptionsJs>,
) -> Result<Vec<ChatMessageJs>> {
    let options = options.unwrap_or(ListOptionsJs {
        limit: None,
        before: None,
    });
    let messages = core_for(handle)?
        .list_messages(
            &channel,
            ListOptions {
                limit: options.limit,
                before: options.before,
            },
        )
        .await
        .map_err(to_napi)?;
    Ok(messages.into_iter().map(ChatMessageJs::from).collect())
}

#[napi]
pub async fn chat_core_search_messages(
    handle: u32,
    query: String,
    options: Option<SearchOptionsJs>,
) -> Result<Vec<ChatMessageJs>> {
    let options = options.unwrap_or(SearchOptionsJs {
        channel_id: None,
        limit: None,
    });
    let messages = core_for(handle)?
        .search_messages(
            &query,
            SearchOptions {
                channel_id: options.channel_id,
                limit: options.limit,
            },
        )
        .await
        .map_err(to_napi)?;
    Ok(messages.into_iter().map(ChatMessageJs::from).collect())
}

#[napi]
pub async fn chat_core_mark_read(handle: u32, channel: String, seq: i64) -> Result<()> {
    core_for(handle)?
        .mark_read(&channel, seq)
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn chat_core_publish_typing(handle: u32, channel: String, until_ms: i64) -> Result<()> {
    core_for(handle)?
        .publish_typing(&channel, until_ms)
        .await
        .map_err(to_napi)
}

#[napi]
pub async fn chat_core_pending_count(handle: u32) -> Result<u32> {
    let count = core_for(handle)?.pending_count().await.map_err(to_napi)?;
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

#[napi]
pub async fn chat_core_flush_outbox(handle: u32) -> Result<()> {
    core_for(handle)?.flush_outbox().await.map_err(to_napi)
}

/// Registers a message listener; returns the listener id for `chatCoreOff`.
#[napi]
pub fn chat_core_on_message(handle: u32, callback: JsFunction) -> Result<u32> {
    let core = core_for(handle)?;
    let tsfn: ThreadsafeFunction<ChatMessageJs, ErrorStrategy::Fatal> =
        callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
    listener_id(core.on_message(move |message| {
        let _ = tsfn.call(
            ChatMessageJs::from(message),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }))
}

#[napi]
pub fn chat_core_on_presence(handle: u32, callback: JsFunction) -> Result<u32> {
    let core = core_for(handle)?;
    let tsfn: ThreadsafeFunction<PresenceEntryJs, ErrorStrategy::Fatal> =
        callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
    listener_id(core.on_presence(move |entry| {
        let _ = tsfn.call(
            PresenceEntryJs::from(entry),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }))
}

#[napi]
pub fn chat_core_on_typing(handle: u32, callback: JsFunction) -> Result<u32> {
    let core = core_for(handle)?;
    let tsfn: ThreadsafeFunction<TypingEntryJs, ErrorStrategy::Fatal> =
        callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
    listener_id(core.on_typing(move |entry| {
        let _ = tsfn.call(
            TypingEntryJs::from(entry),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }))
}

#[napi]
pub fn chat_core_on_status(handle: u32, callback: JsFunction) -> Result<u32> {
    let core = core_for(handle)?;
    let tsfn: ThreadsafeFunction<ChatCoreStatusJs, ErrorStrategy::Fatal> =
        callback.create_threadsafe_function(0, |ctx| Ok(vec![ctx.value]))?;
    listener_id(core.on_status(move |status| {
        let _ = tsfn.call(
            ChatCoreStatusJs::from(status),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }))
}

/// Removes a listener registered by any `chatCoreOn*` function.
#[napi]
pub fn chat_core_off(handle: u32, listener: u32) -> Result<bool> {
    Ok(core_for(handle)?.off(u64::from(listener)))
}
