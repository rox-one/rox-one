//! Message cache: `events`, `channels`, `read_state` plus FTS5 search over
//! message content.

use crate::error::ChatError;
use crate::event::{event_channel_id, Event, NON_MESSAGE_KINDS};
use crate::store::Store;
use crate::types::{ChatMessage, ListOptions, SearchOptions};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

/// Column list for the `events` table aliased as `e` (the FTS join makes an
/// unqualified list ambiguous).
const MESSAGE_COLUMNS: &str = "e.id, e.channel_id, e.pubkey, e.created_at, e.kind, e.tags, \
                                e.content, e.edited_at, e.deleted_at, e.pending";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRecord {
    pub channel_id: String,
    pub name: Option<String>,
    pub channel_type: Option<String>,
    pub joined: bool,
    pub updated_at: i64,
}

fn kind_exclusion() -> String {
    NON_MESSAGE_KINDS
        .iter()
        .map(|k| k.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

fn row_to_message(row: &Row<'_>) -> rusqlite::Result<ChatMessage> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<Vec<String>> = serde_json::from_str(&tags_json).unwrap_or_default();
    let pending: i64 = row.get(9)?;
    Ok(ChatMessage {
        id: row.get(0)?,
        channel_id: row.get(1)?,
        pubkey: row.get(2)?,
        created_at: row.get(3)?,
        kind: row.get::<_, i64>(4)? as u32,
        tags,
        content: row.get(6)?,
        edited_at: row.get(7)?,
        deleted_at: row.get(8)?,
        pending: if pending == 0 { None } else { Some(true) },
    })
}

/// Split a query into FTS5 terms and OR them together, each quoted so user
/// input cannot inject FTS syntax.
fn fts_match_query(query: &str) -> Option<String> {
    const MAX_TERMS: usize = 16;
    let mut terms: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in query.chars() {
        if ch.is_alphanumeric() || ch == '_' {
            current.push(ch);
        } else if !current.is_empty() {
            terms.push(std::mem::take(&mut current));
        }
        if terms.len() == MAX_TERMS {
            break;
        }
    }
    if !current.is_empty() && terms.len() < MAX_TERMS {
        terms.push(current);
    }
    if terms.is_empty() {
        return None;
    }
    Some(
        terms
            .iter()
            .map(|t| format!("\"{}\"", t.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

impl Store {
    // ---- channels ----------------------------------------------------------

    pub fn upsert_channel(&self, record: &ChannelRecord) -> Result<(), ChatError> {
        self.conn().execute(
            "INSERT INTO channels (channel_id, name, channel_type, joined, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(channel_id) DO UPDATE SET
                name = excluded.name,
                channel_type = excluded.channel_type,
                joined = excluded.joined,
                updated_at = excluded.updated_at",
            params![
                record.channel_id,
                record.name,
                record.channel_type,
                i64::from(record.joined),
                record.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn list_channels(&self) -> Result<Vec<ChannelRecord>, ChatError> {
        let mut stmt = self.conn().prepare(
            "SELECT channel_id, name, channel_type, joined, updated_at
             FROM channels ORDER BY channel_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ChannelRecord {
                channel_id: row.get(0)?,
                name: row.get(1)?,
                channel_type: row.get(2)?,
                joined: row.get::<_, i64>(3)? != 0,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    // ---- read state --------------------------------------------------------

    pub fn set_read_state(&self, channel_id: &str, seq: i64, now: i64) -> Result<(), ChatError> {
        self.conn().execute(
            "INSERT INTO read_state (channel_id, seq, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(channel_id) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at",
            params![channel_id, seq, now],
        )?;
        Ok(())
    }

    pub fn read_state(&self, channel_id: &str) -> Result<i64, ChatError> {
        let seq = self
            .conn()
            .query_row(
                "SELECT seq FROM read_state WHERE channel_id = ?1",
                params![channel_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        Ok(seq.unwrap_or(0))
    }

    // ---- events ------------------------------------------------------------

    pub fn insert_event(&self, event: &Event) -> Result<(), ChatError> {
        self.insert_event_with_pending(event, false)
    }

    /// Insert or refresh an event. `pending` marks locally authored events that
    /// the relay has not acknowledged yet; existing `edited_at` / `deleted_at`
    /// markers survive a re-insert.
    pub fn insert_event_with_pending(&self, event: &Event, pending: bool) -> Result<(), ChatError> {
        let tags = serde_json::to_string(&event.tags)?;
        let channel_id = event_channel_id(event).unwrap_or_default();
        self.conn().execute(
            "INSERT INTO events
                (id, channel_id, pubkey, created_at, kind, tags, content, sig, pending)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                channel_id = excluded.channel_id,
                pubkey     = excluded.pubkey,
                created_at = excluded.created_at,
                kind       = excluded.kind,
                tags       = excluded.tags,
                content    = excluded.content,
                sig        = excluded.sig,
                pending    = excluded.pending",
            params![
                event.id,
                channel_id,
                event.pubkey,
                event.created_at,
                event.kind as i64,
                tags,
                event.content,
                event.sig,
                i64::from(pending)
            ],
        )?;
        Ok(())
    }

    pub fn set_event_pending(&self, event_id: &str, pending: bool) -> Result<(), ChatError> {
        self.conn().execute(
            "UPDATE events SET pending = ?2 WHERE id = ?1",
            params![event_id, i64::from(pending)],
        )?;
        Ok(())
    }

    pub fn mark_event_edited(
        &self,
        event_id: &str,
        content: &str,
        edited_at: i64,
    ) -> Result<bool, ChatError> {
        let changed = self.conn().execute(
            "UPDATE events SET content = ?2, edited_at = ?3 WHERE id = ?1",
            params![event_id, content, edited_at],
        )?;
        Ok(changed > 0)
    }

    pub fn mark_event_deleted(&self, event_id: &str, deleted_at: i64) -> Result<bool, ChatError> {
        let changed = self.conn().execute(
            "UPDATE events SET deleted_at = ?2 WHERE id = ?1",
            params![event_id, deleted_at],
        )?;
        Ok(changed > 0)
    }

    pub fn get_event(&self, event_id: &str) -> Result<Option<ChatMessage>, ChatError> {
        let sql = format!("SELECT {MESSAGE_COLUMNS} FROM events e WHERE e.id = ?1");
        let message = self
            .conn()
            .query_row(&sql, params![event_id], row_to_message)
            .optional()?;
        Ok(message)
    }

    /// Newest `limit` messages of a channel older than `before`, returned in
    /// ascending (chronological) order.
    pub fn list_messages(
        &self,
        channel_id: &str,
        options: &ListOptions,
    ) -> Result<Vec<ChatMessage>, ChatError> {
        let limit = options.limit.unwrap_or(50).clamp(1, 500) as i64;
        let before = options.before.unwrap_or(i64::MAX);
        let sql = format!(
            "SELECT {MESSAGE_COLUMNS} FROM events e
             WHERE e.channel_id = ?1 AND e.created_at < ?2 AND e.kind NOT IN ({})
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT ?3",
            kind_exclusion()
        );
        let mut stmt = self.conn().prepare(&sql)?;
        let rows = stmt.query_map(params![channel_id, before, limit], row_to_message)?;
        let mut messages = rows.collect::<Result<Vec<_>, _>>()?;
        messages.reverse();
        Ok(messages)
    }

    /// Full-text search over cached message content. Falls back to `LIKE` when
    /// SQLite was built without FTS5.
    pub fn search_messages(
        &self,
        query: &str,
        options: &SearchOptions,
    ) -> Result<Vec<ChatMessage>, ChatError> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = options.limit.unwrap_or(50).clamp(1, 200) as i64;
        if self.fts_enabled() {
            if let Some(match_query) = fts_match_query(query) {
                let sql = format!(
                    "SELECT {MESSAGE_COLUMNS} FROM events_fts
                     JOIN events e ON e.rowid = events_fts.rowid
                     WHERE events_fts MATCH ?1
                       AND (?2 IS NULL OR e.channel_id = ?2)
                       AND e.kind NOT IN ({})
                     ORDER BY rank, e.created_at DESC
                     LIMIT ?3",
                    kind_exclusion()
                );
                let mut stmt = self.conn().prepare(&sql)?;
                let rows = stmt.query_map(
                    params![match_query, options.channel_id, limit],
                    row_to_message,
                )?;
                return Ok(rows.collect::<Result<Vec<_>, _>>()?);
            }
            return Ok(Vec::new());
        }
        let like = format!("%{}%", query.replace(['%', '_'], ""));
        let sql = format!(
            "SELECT {MESSAGE_COLUMNS} FROM events e
             WHERE e.content LIKE ?1
               AND (?2 IS NULL OR e.channel_id = ?2)
               AND e.kind NOT IN ({})
             ORDER BY e.created_at DESC
             LIMIT ?3",
            kind_exclusion()
        );
        let mut stmt = self.conn().prepare(&sql)?;
        let rows = stmt.query_map(params![like, options.channel_id, limit], row_to_message)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn count_events(&self) -> Result<usize, ChatError> {
        let count: i64 = self
            .conn()
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))?;
        Ok(count as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::{KIND_DELETE, KIND_STREAM_MESSAGE};
    use crate::keys::Keys;

    fn keys() -> Keys {
        Keys::from_hex("0000000000000000000000000000000000000000000000000000000000000001").unwrap()
    }

    fn message(channel: &str, content: &str, created_at: i64) -> Event {
        keys().sign_event(
            KIND_STREAM_MESSAGE,
            vec![vec!["h".to_string(), channel.to_string()]],
            content,
            created_at,
        )
    }

    #[test]
    fn insert_then_list_returns_messages_chronologically() {
        let store = Store::open_in_memory().unwrap();
        let a = message("c1", "first", 100);
        let b = message("c1", "second", 200);
        let other = message("c2", "elsewhere", 300);
        store.insert_event(&a).unwrap();
        store.insert_event(&b).unwrap();
        store.insert_event(&other).unwrap();

        let listed = store.list_messages("c1", &ListOptions::default()).unwrap();
        assert_eq!(
            listed.iter().map(|m| m.content.as_str()).collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        assert_eq!(listed[0].id, a.id);
        assert_eq!(listed[0].channel_id, "c1");
        assert_eq!(listed[0].pubkey, keys().pubkey_hex());
        assert_eq!(listed[0].kind, KIND_STREAM_MESSAGE);
        assert_eq!(listed[0].tags[0], vec!["h".to_string(), "c1".to_string()]);
        assert!(listed[0].edited_at.is_none());
        assert!(listed[0].pending.is_none());
        assert_eq!(store.count_events().unwrap(), 3);
    }

    #[test]
    fn list_respects_limit_and_before_cursor() {
        let store = Store::open_in_memory().unwrap();
        for i in 0..5 {
            store.insert_event(&message("c1", &format!("m{i}"), 100 + i)).unwrap();
        }
        let newest = store
            .list_messages(
                "c1",
                &ListOptions {
                    limit: Some(2),
                    before: None,
                },
            )
            .unwrap();
        assert_eq!(
            newest.iter().map(|m| m.content.as_str()).collect::<Vec<_>>(),
            vec!["m3", "m4"]
        );

        let older = store
            .list_messages(
                "c1",
                &ListOptions {
                    limit: Some(2),
                    before: Some(102),
                },
            )
            .unwrap();
        assert_eq!(
            older.iter().map(|m| m.content.as_str()).collect::<Vec<_>>(),
            vec!["m0", "m1"]
        );
    }

    #[test]
    fn reinserting_the_same_event_keeps_one_row() {
        let store = Store::open_in_memory().unwrap();
        let event = message("c1", "dup", 100);
        store.insert_event(&event).unwrap();
        store.insert_event(&event).unwrap();
        assert_eq!(store.count_events().unwrap(), 1);
        let listed = store.list_messages("c1", &ListOptions::default()).unwrap();
        assert_eq!(listed.len(), 1, "FTS triggers must not duplicate rows");
    }

    #[test]
    fn pending_flag_round_trips() {
        let store = Store::open_in_memory().unwrap();
        let event = message("c1", "queued", 100);
        store.insert_event_with_pending(&event, true).unwrap();
        let listed = store.list_messages("c1", &ListOptions::default()).unwrap();
        assert_eq!(listed[0].pending, Some(true));
        store.set_event_pending(&event.id, false).unwrap();
        let listed = store.list_messages("c1", &ListOptions::default()).unwrap();
        assert_eq!(listed[0].pending, None);
    }

    #[test]
    fn fts_search_matches_content_and_scopes_to_channel() {
        let store = Store::open_in_memory().unwrap();
        store.insert_event(&message("c1", "the quick brown fox", 100)).unwrap();
        store.insert_event(&message("c2", "lazy dog sleeps here", 101)).unwrap();
        store.insert_event(&message("c2", "another fox in c2", 102)).unwrap();

        let hits = store
            .search_messages("fox", &SearchOptions::default())
            .unwrap();
        assert_eq!(hits.len(), 2);

        let scoped = store
            .search_messages(
                "fox",
                &SearchOptions {
                    channel_id: Some("c2".into()),
                    limit: None,
                },
            )
            .unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].channel_id, "c2");

        assert!(store
            .search_messages("   ", &SearchOptions::default())
            .unwrap()
            .is_empty());
        assert!(store
            .search_messages("nonsense-term", &SearchOptions::default())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn fts_index_follows_edits_and_hides_deleted_messages() {
        let store = Store::open_in_memory().unwrap();
        let event = message("c1", "original wording", 100);
        store.insert_event(&event).unwrap();
        assert_eq!(store.search_messages("original", &SearchOptions::default()).unwrap().len(), 1);

        assert!(store.mark_event_edited(&event.id, "rewritten text", 150).unwrap());
        assert!(store.search_messages("original", &SearchOptions::default()).unwrap().is_empty());
        assert_eq!(store.search_messages("rewritten", &SearchOptions::default()).unwrap().len(), 1);
        let edited = store.get_event(&event.id).unwrap().unwrap();
        assert_eq!(edited.content, "rewritten text");
        assert_eq!(edited.edited_at, Some(150));

        let deletion = keys().sign_event(
            KIND_DELETE,
            vec![vec!["e".to_string(), event.id.clone()]],
            "",
            200,
        );
        store.insert_event(&deletion).unwrap();
        assert!(store.mark_event_deleted(&event.id, 200).unwrap());
        let listed = store.list_messages("c1", &ListOptions::default()).unwrap();
        assert_eq!(listed.len(), 1, "deletion envelopes are not messages");
        assert_eq!(listed[0].deleted_at, Some(200));
    }

    #[test]
    fn channels_upsert_and_list() {
        let store = Store::open_in_memory().unwrap();
        let mut record = ChannelRecord {
            channel_id: "c1".into(),
            name: Some("General".into()),
            channel_type: Some("stream".into()),
            joined: true,
            updated_at: 10,
        };
        store.upsert_channel(&record).unwrap();
        record.name = Some("Renamed".into());
        record.updated_at = 20;
        store.upsert_channel(&record).unwrap();
        store
            .upsert_channel(&ChannelRecord {
                channel_id: "c2".into(),
                name: None,
                channel_type: Some("dm".into()),
                joined: false,
                updated_at: 30,
            })
            .unwrap();

        let channels = store.list_channels().unwrap();
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].channel_id, "c1");
        assert_eq!(channels[0].name.as_deref(), Some("Renamed"));
        assert!(channels[0].joined);
        assert!(!channels[1].joined);
    }

    #[test]
    fn read_state_is_durable_and_defaults_to_zero() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.read_state("c1").unwrap(), 0);
        store.set_read_state("c1", 42, 1_000).unwrap();
        store.set_read_state("c1", 43, 1_001).unwrap();
        assert_eq!(store.read_state("c1").unwrap(), 43);
    }
}
