//! `rox-chat-core` — the native chat core behind `@rox/chat-core`.
//!
//! Part of the Rox native chat client. Portions derived from Block's Buzz
//! (<https://github.com/block/buzz>), Apache-2.0 — see `NOTICE` at the repo root.
//!
//! ## What it does
//!
//! * Speaks NIP-01 over a Tokio WebSocket: client frames `REQ` / `EVENT` /
//!   `CLOSE` / `AUTH`, relay frames `EVENT` / `EOSE` / `OK` / `AUTH` / `NOTICE`.
//! * Reconnects with exponential backoff and re-subscribes to every channel the
//!   host asked for.
//! * Caches events in SQLite (`events`, `channels`, `read_state`) with an FTS5
//!   virtual table over message content.
//! * Keeps a durable outbox: pending events are persisted and replayed in
//!   insertion order on reconnect, keyed by event id so a replay is idempotent.
//! * Signs events from a host-supplied hex key. The key lives in memory only —
//!   it is never written to the cache.
//! * Surfaces ephemeral presence (kind 20001) and typing (kind 20002) through
//!   callbacks instead of persisting them.
//!
//! The optional `napi-bindings` feature adds the napi-rs surface used by the JS
//! package. Core modules never reference napi.

mod cache;
mod client;
mod error;
mod event;
mod keys;
#[cfg(feature = "napi-bindings")]
mod napi_bindings;
mod outbox;
mod store;
mod types;
mod wire;

#[cfg(test)]
mod mock;

pub use cache::ChannelRecord;
pub use client::{sub_id_for, unix_millis, unix_seconds, BackoffPolicy, ChatCore, ChatCoreBuilder};
pub use error::ChatError;
pub use event::{
    canonical_id_serialization, event_channel_id, event_id_hex, event_id_of, event_tag_values,
    is_edit_event, verify_event, Event, EPHEMERAL_PRESENCE, EPHEMERAL_TYPING, KIND_AUTH,
    KIND_DELETE, KIND_STREAM_MESSAGE, KIND_TEXT_NOTE, NON_MESSAGE_KINDS,
};
pub use keys::Keys;
pub use outbox::OutboxEntry;
pub use store::Store;
pub use types::{
    ChatCoreOptions, ChatCoreStatus, ChatMessage, ConnectionState, ListOptions, MessageRef,
    PresenceEntry, PresenceStatus, SearchOptions, TypingEntry,
};
pub use wire::{ClientFrame, Filter, RelayFrame};
