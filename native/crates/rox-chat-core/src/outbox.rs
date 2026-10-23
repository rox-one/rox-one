//! Durable outbox.
//!
//! Every locally authored event is persisted before it is put on the wire, so a
//! crash or a dropped relay connection cannot lose it. Rows replay in `seq`
//! order; `event_id` is `UNIQUE`, which makes enqueueing idempotent and makes a
//! replay after reconnect safe.

use crate::error::ChatError;
use crate::event::{event_channel_id, Event};
use crate::store::Store;
use rusqlite::{params, OptionalExtension};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboxEntry {
    pub seq: i64,
    pub event_id: String,
    pub payload: String,
    pub channel_id: String,
    pub created_at: i64,
    pub attempts: i64,
    pub sent: bool,
}

impl OutboxEntry {
    /// The stored event, if the payload still parses.
    pub fn event(&self) -> Result<Event, ChatError> {
        let event: Event = serde_json::from_str(&self.payload)?;
        Ok(event)
    }
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxEntry> {
    Ok(OutboxEntry {
        seq: row.get(0)?,
        event_id: row.get(1)?,
        payload: row.get(2)?,
        channel_id: row.get(3)?,
        created_at: row.get(4)?,
        attempts: row.get(5)?,
        sent: row.get::<_, i64>(6)? != 0,
    })
}

const OUTBOX_COLUMNS: &str = "seq, event_id, payload, channel_id, created_at, attempts, sent";

impl Store {
    /// Queue a signed event. Returns `true` when a new row was written and
    /// `false` when the event was already present (idempotent re-enqueue).
    pub fn outbox_enqueue(&self, event: &Event) -> Result<bool, ChatError> {
        let payload = serde_json::to_string(event)?;
        let channel_id = event_channel_id(event).unwrap_or_default();
        let written = self.conn().execute(
            "INSERT INTO outbox (event_id, payload, channel_id, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(event_id) DO NOTHING",
            params![event.id, payload, channel_id, event.created_at],
        )?;
        Ok(written == 1)
    }

    /// Unacknowledged events in replay order (oldest first).
    pub fn outbox_pending(&self) -> Result<Vec<OutboxEntry>, ChatError> {
        let sql = format!(
            "SELECT {OUTBOX_COLUMNS} FROM outbox WHERE sent = 0 ORDER BY seq ASC"
        );
        let mut stmt = self.conn().prepare(&sql)?;
        let rows = stmt.query_map([], row_to_entry)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Every row, sent or not — used by tests and diagnostics.
    pub fn outbox_all(&self) -> Result<Vec<OutboxEntry>, ChatError> {
        let sql = format!("SELECT {OUTBOX_COLUMNS} FROM outbox ORDER BY seq ASC");
        let mut stmt = self.conn().prepare(&sql)?;
        let rows = stmt.query_map([], row_to_entry)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn outbox_pending_count(&self) -> Result<usize, ChatError> {
        let count: i64 = self.conn().query_row(
            "SELECT COUNT(*) FROM outbox WHERE sent = 0",
            [],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    pub fn outbox_get(&self, event_id: &str) -> Result<Option<OutboxEntry>, ChatError> {
        let sql = format!("SELECT {OUTBOX_COLUMNS} FROM outbox WHERE event_id = ?1");
        let entry = self
            .conn()
            .query_row(&sql, params![event_id], row_to_entry)
            .optional()?;
        Ok(entry)
    }

    /// Mark an event acknowledged. Returns `true` when this call flipped the
    /// row from pending to sent (a second `OK` for the same id is a no-op).
    pub fn outbox_mark_sent(&self, event_id: &str) -> Result<bool, ChatError> {
        let changed = self.conn().execute(
            "UPDATE outbox SET sent = 1 WHERE event_id = ?1 AND sent = 0",
            params![event_id],
        )?;
        Ok(changed > 0)
    }

    pub fn outbox_mark_attempt(&self, event_id: &str) -> Result<(), ChatError> {
        self.conn().execute(
            "UPDATE outbox SET attempts = attempts + 1 WHERE event_id = ?1",
            params![event_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::Keys;

    fn keys() -> Keys {
        Keys::from_hex("0000000000000000000000000000000000000000000000000000000000000001").unwrap()
    }

    fn event(seq: usize) -> Event {
        keys().sign_event(
            9,
            vec![vec!["h".to_string(), "c1".to_string()]],
            &format!("message {seq}"),
            1_700_000_000 + seq as i64,
        )
    }

    #[test]
    fn pending_events_replay_in_insertion_order() {
        let store = Store::open_in_memory().unwrap();
        let events: Vec<Event> = (0..4).map(event).collect();
        for ev in &events {
            assert!(store.outbox_enqueue(ev).unwrap());
        }
        let pending = store.outbox_pending().unwrap();
        assert_eq!(
            pending.iter().map(|e| e.event_id.as_str()).collect::<Vec<_>>(),
            events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>()
        );
        assert_eq!(store.outbox_pending_count().unwrap(), 4);
        assert_eq!(pending[0].channel_id, "c1");
        assert_eq!(pending[0].event().unwrap().id, events[0].id);
        assert_eq!(pending[0].attempts, 0);
        assert!(!pending[0].sent);
    }

    #[test]
    fn re_enqueueing_the_same_event_is_idempotent() {
        let store = Store::open_in_memory().unwrap();
        let ev = event(1);
        assert!(store.outbox_enqueue(&ev).unwrap());
        assert!(!store.outbox_enqueue(&ev).unwrap(), "second enqueue is a no-op");
        assert_eq!(store.outbox_all().unwrap().len(), 1);
        assert_eq!(store.outbox_pending_count().unwrap(), 1);
    }

    #[test]
    fn sending_keeps_the_row_so_a_replay_is_still_idempotent() {
        let store = Store::open_in_memory().unwrap();
        let ev = event(1);
        store.outbox_enqueue(&ev).unwrap();
        assert!(store.outbox_mark_sent(&ev.id).unwrap());
        assert!(!store.outbox_mark_sent(&ev.id).unwrap(), "already sent");
        assert_eq!(store.outbox_pending_count().unwrap(), 0);
        assert_eq!(store.outbox_all().unwrap().len(), 1);
        assert!(!store.outbox_enqueue(&ev).unwrap());
        assert_eq!(store.outbox_pending_count().unwrap(), 0, "resend stays sent");
    }

    #[test]
    fn only_unacked_events_flush_again() {
        let store = Store::open_in_memory().unwrap();
        let first = event(1);
        let second = event(2);
        store.outbox_enqueue(&first).unwrap();
        store.outbox_enqueue(&second).unwrap();
        store.outbox_mark_sent(&first.id).unwrap();
        store.outbox_mark_attempt(&second.id).unwrap();

        let pending = store.outbox_pending().unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].event_id, second.id);
        assert_eq!(pending[0].attempts, 1);
        assert_eq!(store.outbox_get(&first.id).unwrap().unwrap().sent, true);
        assert!(store.outbox_get("missing").unwrap().is_none());
    }

    #[test]
    fn pending_survives_reopening_the_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chat.db");
        let events: Vec<Event> = (0..3).map(event).collect();
        {
            let store = Store::open(path.to_str().unwrap()).unwrap();
            for ev in &events {
                store.outbox_enqueue(ev).unwrap();
            }
            store.outbox_mark_sent(&events[0].id).unwrap();
        }
        let reopened = Store::open(path.to_str().unwrap()).unwrap();
        let pending = reopened.outbox_pending().unwrap();
        assert_eq!(
            pending.iter().map(|e| e.event_id.as_str()).collect::<Vec<_>>(),
            vec![events[1].id.as_str(), events[2].id.as_str()]
        );
    }
}
