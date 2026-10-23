//! Serialisable value types. Field names match the frozen `@rox/chat-core`
//! TypeScript surface (`packages/chat-core/index.d.ts`).

use serde::{Deserialize, Serialize};
use std::fmt;

/// Host-provided configuration. `secret_key_hex` is kept in memory only.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatCoreOptions {
    pub relay_url: String,
    pub db_path: String,
    pub secret_key_hex: String,
    #[serde(default)]
    pub channels: Vec<String>,
}

impl fmt::Debug for ChatCoreOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never let the relay key reach a log line.
        f.debug_struct("ChatCoreOptions")
            .field("relay_url", &self.relay_url)
            .field("db_path", &self.db_path)
            .field("secret_key_hex", &"<redacted>")
            .field("channels", &self.channels)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub channel_id: String,
    pub pubkey: String,
    pub content: String,
    /// Unix seconds (NIP-01 `created_at`).
    pub created_at: i64,
    pub kind: u32,
    pub tags: Vec<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresenceStatus {
    Online,
    Away,
    Offline,
}

impl PresenceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            PresenceStatus::Online => "online",
            PresenceStatus::Away => "away",
            PresenceStatus::Offline => "offline",
        }
    }

    pub fn parse(raw: &str) -> Self {
        match raw {
            "away" => PresenceStatus::Away,
            "offline" => PresenceStatus::Offline,
            _ => PresenceStatus::Online,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceEntry {
    pub user_id: String,
    pub pubkey: String,
    pub status: PresenceStatus,
    /// Unix milliseconds.
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypingEntry {
    pub channel_id: String,
    pub pubkey: String,
    /// Unix milliseconds.
    pub until: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Connected,
    Reconnecting,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatCoreStatus {
    pub state: ConnectionState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u32>,
}

impl ChatCoreStatus {
    pub fn offline() -> Self {
        Self {
            state: ConnectionState::Offline,
            attempt: None,
        }
    }

    pub fn connected() -> Self {
        Self {
            state: ConnectionState::Connected,
            attempt: None,
        }
    }

    pub fn reconnecting(attempt: u32) -> Self {
        Self {
            state: ConnectionState::Reconnecting,
            attempt: Some(attempt),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    pub limit: Option<u32>,
    /// Return messages strictly older than this `created_at` (unix seconds).
    pub before: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub channel_id: Option<String>,
    pub limit: Option<u32>,
}

/// Returned by `sendMessage` / `editMessage` / `deleteMessage`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageRef {
    pub id: String,
}

impl MessageRef {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presence_status_round_trips_through_its_wire_string() {
        for status in [
            PresenceStatus::Online,
            PresenceStatus::Away,
            PresenceStatus::Offline,
        ] {
            assert_eq!(PresenceStatus::parse(status.as_str()), status);
        }
        assert_eq!(PresenceStatus::parse("online"), PresenceStatus::Online);
        assert_eq!(PresenceStatus::parse("garbage"), PresenceStatus::Online);
        assert_eq!(PresenceStatus::Online.as_str(), "online");
    }

    #[test]
    fn status_helpers_shape_the_ts_union() {
        assert_eq!(ChatCoreStatus::offline().attempt, None);
        assert_eq!(
            ChatCoreStatus::connected().state,
            ConnectionState::Connected
        );
        let reconnecting = ChatCoreStatus::reconnecting(3);
        assert_eq!(reconnecting.state, ConnectionState::Reconnecting);
        assert_eq!(reconnecting.attempt, Some(3));
        assert_eq!(
            serde_json::to_string(&reconnecting).unwrap(),
            r#"{"state":"reconnecting","attempt":3}"#
        );
        assert_eq!(
            serde_json::to_string(&ChatCoreStatus::connected()).unwrap(),
            r#"{"state":"connected"}"#
        );
    }

    #[test]
    fn chat_message_serialises_to_camel_case_without_empty_markers() {
        let message = ChatMessage {
            id: "e1".into(),
            channel_id: "c1".into(),
            pubkey: "ab".into(),
            content: "hi".into(),
            created_at: 10,
            kind: 9,
            tags: vec![vec!["h".into(), "c1".into()]],
            edited_at: None,
            deleted_at: None,
            pending: Some(true),
        };
        let value = serde_json::to_value(&message).unwrap();
        assert_eq!(value["channelId"], serde_json::json!("c1"));
        assert_eq!(value["createdAt"], serde_json::json!(10));
        assert_eq!(value["pending"], serde_json::json!(true));
        assert!(value.get("editedAt").is_none());
        assert!(value.get("deletedAt").is_none());
    }

    #[test]
    fn options_debug_redacts_the_secret() {
        let options = ChatCoreOptions {
            relay_url: "wss://chat.rox.one".into(),
            db_path: "/tmp/chat.db".into(),
            secret_key_hex: "deadbeef".repeat(8),
            channels: vec!["c1".into()],
        };
        let rendered = format!("{options:?}");
        assert!(rendered.contains("<redacted>"));
        assert!(!rendered.contains("deadbeef"));
    }
}
