//! napi-rs bindings for the JS package (`@rox/chat-core`).
//!
//! Compiled only with the `napi-bindings` feature. The core modules never
//! reference napi, so `cargo test`/`cargo build` without the feature links no
//! Node symbols.

use crate::types::{
    ChatCoreStatus, ChatMessage, ConnectionState, ListOptions, PresenceEntry, PresenceStatus,
    SearchOptions, TypingEntry,
};
use crate::{ChatCore, ChatCoreOptions, ChatError};
use napi::bindgen_prelude::{JsFunction, Result as NapiResult};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::sync::Arc;

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

#[napi]
pub struct ChatCoreJs {
    inner: Arc<ChatCore>,
}

#[napi]
impl ChatCoreJs {
    #[napi]
    pub async fn start(&self) -> NapiResult<()> {
        let core = Arc::clone(&self.inner);
        core.start().await.map_err(to_napi)
    }

    #[napi]
    pub async fn stop(&self) -> NapiResult<()> {
        let core = Arc::clone(&self.inner);
        core.stop().await.map_err(to_napi)
    }

    #[napi]
    pub async fn subscribe(&self, channel: String) -> NapiResult<()> {
        let core = Arc::clone(&self.inner);
        core.subscribe(&channel).await.map_err(to_napi)
    }

    #[napi]
    pub async fn unsubscribe(&self, channel: String) -> NapiResult<()> {
        let core = Arc::clone(&self.inner);
        core.unsubscribe(&channel).await.map_err(to_napi)
    }

    #[napi]
    pub async fn send_message(&self, channel: String, content: String) -> NapiResult<MessageRefJs> {
        let core = Arc::clone(&self.inner);
        let sent = core
            .send_message(&channel, &content)
            .await
            .map_err(to_napi)?;
        Ok(MessageRefJs { id: sent.id })
    }

    #[napi]
    pub async fn edit_message(&self, id: String, content: String) -> NapiResult<MessageRefJs> {
        let core = Arc::clone(&self.inner);
        let edited = core.edit_message(&id, &content).await.map_err(to_napi)?;
        Ok(MessageRefJs { id: edited.id })
    }

    #[napi]
    pub async fn delete_message(&self, id: String) -> NapiResult<MessageRefJs> {
        let core = Arc::clone(&self.inner);
        let deleted = core.delete_message(&id).await.map_err(to_napi)?;
        Ok(MessageRefJs { id: deleted.id })
    }

    #[napi]
    pub async fn list_messages(
        &self,
        channel: String,
        options: Option<ListOptionsJs>,
    ) -> NapiResult<Vec<ChatMessageJs>> {
        let core = Arc::clone(&self.inner);
        let options = options.unwrap_or(ListOptionsJs {
            limit: None,
            before: None,
        });
        let messages = core
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
    pub async fn search_messages(
        &self,
        query: String,
        options: Option<SearchOptionsJs>,
    ) -> NapiResult<Vec<ChatMessageJs>> {
        let core = Arc::clone(&self.inner);
        let options = options.unwrap_or(SearchOptionsJs {
            channel_id: None,
            limit: None,
        });
        let messages = core
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
    pub async fn mark_read(&self, channel: String, seq: i64) -> NapiResult<()> {
        let core = Arc::clone(&self.inner);
        core.mark_read(&channel, seq).await.map_err(to_napi)
    }

    #[napi]
    pub async fn publish_typing(&self, channel: String, until_ms: i64) -> NapiResult<()> {
        let core = Arc::clone(&self.inner);
        core.publish_typing(&channel, until_ms)
            .await
            .map_err(to_napi)
    }

    #[napi]
    pub async fn pending_count(&self) -> NapiResult<u32> {
        let core = Arc::clone(&self.inner);
        let count = core.pending_count().await.map_err(to_napi)?;
        Ok(count as u32)
    }

    #[napi]
    pub async fn flush_outbox(&self) -> NapiResult<()> {
        let core = Arc::clone(&self.inner);
        core.flush_outbox().await.map_err(to_napi)
    }

    #[napi(ts_return_type = "() => void")]
    pub fn on_message(&self, callback: JsFunction) -> NapiResult<u32> {
        let tsfn: ThreadsafeFunction<ChatMessageJs, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| ctx.env.to_js_value(&ctx.value))?;
        let id = self.inner.on_message(move |message| {
            let _ = tsfn.call(
                ChatMessageJs::from(message),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        });
        Ok(id as u32)
    }

    #[napi(ts_return_type = "() => void")]
    pub fn on_presence(&self, callback: JsFunction) -> NapiResult<u32> {
        let tsfn: ThreadsafeFunction<PresenceEntryJs, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| ctx.env.to_js_value(&ctx.value))?;
        let id = self.inner.on_presence(move |entry| {
            let _ = tsfn.call(
                PresenceEntryJs::from(entry),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        });
        Ok(id as u32)
    }

    #[napi(ts_return_type = "() => void")]
    pub fn on_typing(&self, callback: JsFunction) -> NapiResult<u32> {
        let tsfn: ThreadsafeFunction<TypingEntryJs, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| ctx.env.to_js_value(&ctx.value))?;
        let id = self.inner.on_typing(move |entry| {
            let _ = tsfn.call(
                TypingEntryJs::from(entry),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        });
        Ok(id as u32)
    }

    #[napi(ts_return_type = "() => void")]
    pub fn on_status(&self, callback: JsFunction) -> NapiResult<u32> {
        let tsfn: ThreadsafeFunction<ChatCoreStatusJs, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| ctx.env.to_js_value(&ctx.value))?;
        let id = self.inner.on_status(move |status| {
            let _ = tsfn.call(
                ChatCoreStatusJs::from(status),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        });
        Ok(id as u32)
    }
}

#[napi]
pub fn create_chat_core(options: ChatCoreOptionsJs) -> NapiResult<ChatCoreJs> {
    let core = ChatCore::new(ChatCoreOptions {
        relay_url: options.relay_url,
        db_path: options.db_path,
        secret_key_hex: options.secret_key_hex,
        channels: options.channels.unwrap_or_default(),
    })
    .map_err(to_napi)?;
    Ok(ChatCoreJs {
        inner: Arc::new(core),
    })
}
