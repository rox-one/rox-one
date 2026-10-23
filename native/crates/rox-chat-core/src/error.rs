//! Error type shared by the whole crate.

use std::fmt;

#[derive(Debug)]
pub enum ChatError {
    /// The host-supplied key is not a valid secp256k1 secret / hex string.
    Key(String),
    /// A JSON value could not be encoded or decoded.
    Json(String),
    /// SQLite / rusqlite failure.
    Db(String),
    /// A relay frame did not match the NIP-01 shape.
    Wire(String),
    /// WebSocket transport failure.
    Transport(String),
    /// `ChatCoreOptions` were unusable (bad relay URL, wrong key length, …).
    InvalidOptions(String),
    /// The referenced message is not in the local cache.
    NotFound(String),
    /// The client has not been started yet.
    NotStarted,
    /// The client has been stopped.
    Stopped,
    /// An internal mutex was poisoned by a panicking callback.
    Lock,
}

impl fmt::Display for ChatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChatError::Key(m) => write!(f, "invalid key: {m}"),
            ChatError::Json(m) => write!(f, "json error: {m}"),
            ChatError::Db(m) => write!(f, "database error: {m}"),
            ChatError::Wire(m) => write!(f, "wire error: {m}"),
            ChatError::Transport(m) => write!(f, "transport error: {m}"),
            ChatError::InvalidOptions(m) => write!(f, "invalid options: {m}"),
            ChatError::NotFound(m) => write!(f, "not found: {m}"),
            ChatError::NotStarted => write!(f, "chat core is not started"),
            ChatError::Stopped => write!(f, "chat core is stopped"),
            ChatError::Lock => write!(f, "internal lock poisoned"),
        }
    }
}

impl std::error::Error for ChatError {}

impl From<rusqlite::Error> for ChatError {
    fn from(value: rusqlite::Error) -> Self {
        ChatError::Db(value.to_string())
    }
}

impl From<serde_json::Error> for ChatError {
    fn from(value: serde_json::Error) -> Self {
        ChatError::Json(value.to_string())
    }
}

impl From<hex::FromHexError> for ChatError {
    fn from(value: hex::FromHexError) -> Self {
        ChatError::Key(value.to_string())
    }
}

impl From<secp256k1::Error> for ChatError {
    fn from(value: secp256k1::Error) -> Self {
        ChatError::Key(value.to_string())
    }
}
