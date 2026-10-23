//! SQLite store: schema + connection ownership. Cache and outbox behaviour live
//! in `cache.rs` / `outbox.rs` as additional inherent impls.

use crate::error::ChatError;
use rusqlite::Connection;
use std::path::Path;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS channels (
    channel_id   TEXT PRIMARY KEY NOT NULL,
    name         TEXT,
    channel_type TEXT,
    joined       INTEGER NOT NULL DEFAULT 0,
    updated_at   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY NOT NULL,
    channel_id TEXT NOT NULL DEFAULT '',
    pubkey     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    kind       INTEGER NOT NULL,
    tags       TEXT NOT NULL,
    content    TEXT NOT NULL,
    sig        TEXT NOT NULL DEFAULT '',
    edited_at  INTEGER,
    deleted_at INTEGER,
    pending    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS events_channel_created
    ON events(channel_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS read_state (
    channel_id TEXT PRIMARY KEY NOT NULL,
    seq        INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);

-- Durable outbox. `seq` fixes the replay order; `event_id` makes enqueueing
-- idempotent (a re-enqueue of the same signed event is a no-op).
CREATE TABLE IF NOT EXISTS outbox (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id   TEXT NOT NULL UNIQUE,
    payload    TEXT NOT NULL,
    channel_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT 0,
    attempts   INTEGER NOT NULL DEFAULT 0,
    sent       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(sent, seq);
"#;

const FTS_SCHEMA: &str = r#"
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
    content,
    id UNINDEXED,
    channel_id UNINDEXED,
    content='events',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS events_fts_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, content, id, channel_id)
    VALUES (new.rowid, new.content, new.id, new.channel_id);
END;

CREATE TRIGGER IF NOT EXISTS events_fts_ad AFTER DELETE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, content, id, channel_id)
    VALUES ('delete', old.rowid, old.content, old.id, old.channel_id);
END;

CREATE TRIGGER IF NOT EXISTS events_fts_au AFTER UPDATE ON events BEGIN
    INSERT INTO events_fts(events_fts, rowid, content, id, channel_id)
    VALUES ('delete', old.rowid, old.content, old.id, old.channel_id);
    INSERT INTO events_fts(rowid, content, id, channel_id)
    VALUES (new.rowid, new.content, new.id, new.channel_id);
END;
"#;

pub struct Store {
    conn: Connection,
    fts: bool,
}

impl Store {
    /// Open (creating parent directories and the file if needed). `":memory:"`
    /// opens a private in-memory database instead.
    pub fn open(db_path: &str) -> Result<Self, ChatError> {
        if db_path == ":memory:" || db_path.is_empty() {
            return Self::open_in_memory();
        }
        let path = Path::new(db_path);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| ChatError::Db(format!("create {parent:?}: {e}")))?;
            }
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self, ChatError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self, ChatError> {
        // WAL is a no-op for in-memory databases; ignore the result either way.
        let _ = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
        conn.execute_batch(SCHEMA)?;
        // FTS5 is optional: `bundled` SQLite always has it, but a fallback
        // LIKE-based search keeps the cache usable if it is missing.
        let fts = conn.execute_batch(FTS_SCHEMA).is_ok();
        Ok(Self { conn, fts })
    }

    pub fn fts_enabled(&self) -> bool {
        self.fts
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_schema_and_detects_fts() {
        let store = Store::open_in_memory().unwrap();
        assert!(store.fts_enabled(), "bundled SQLite ships FTS5");
        let tables: Vec<String> = {
            let mut stmt = store
                .conn()
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            rows
        };
        for expected in ["events", "channels", "read_state", "outbox"] {
            assert!(tables.iter().any(|t| t == expected), "missing {expected}");
        }
    }

    #[test]
    fn open_creates_missing_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a").join("b").join("chat.db");
        let store = Store::open(nested.to_str().unwrap()).unwrap();
        assert!(store.fts_enabled());
        assert!(nested.exists());
    }
}
