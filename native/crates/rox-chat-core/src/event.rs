//! NIP-01 event: canonical id serialisation and signature verification.
//!
//! Canonical id (NIP-01): `sha256(utf8(JSON.stringify([0, pubkey, created_at,
//! kind, tags, content])))` — compact JSON, no whitespace. Signatures are
//! BIP340 schnorr over the raw 32-byte id.

use crate::error::ChatError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const KIND_TEXT_NOTE: u32 = 1;
pub const KIND_DELETE: u32 = 5;
pub const KIND_STREAM_MESSAGE: u32 = 9;
pub const KIND_AUTH: u32 = 22242;
pub const EPHEMERAL_PRESENCE: u32 = 20001;
pub const EPHEMERAL_TYPING: u32 = 20002;

/// Kinds that never reach the message list (control + ephemeral).
pub const NON_MESSAGE_KINDS: [u32; 3] = [KIND_DELETE, EPHEMERAL_PRESENCE, EPHEMERAL_TYPING];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub pubkey: String,
    pub created_at: i64,
    pub kind: u32,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

/// The exact byte string NIP-01 hashes to produce an event id.
pub fn canonical_id_serialization(
    pubkey: &str,
    created_at: i64,
    kind: u32,
    tags: &[Vec<String>],
    content: &str,
) -> String {
    let value = serde_json::json!([0, pubkey, created_at, kind, tags, content]);
    // `json!` of these primitives cannot fail to serialise.
    serde_json::to_string(&value).expect("canonical serialisation is infallible")
}

pub fn event_id_bytes(
    pubkey: &str,
    created_at: i64,
    kind: u32,
    tags: &[Vec<String>],
    content: &str,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(canonical_id_serialization(pubkey, created_at, kind, tags, content).as_bytes());
    hasher.finalize().into()
}

pub fn event_id_hex(
    pubkey: &str,
    created_at: i64,
    kind: u32,
    tags: &[Vec<String>],
    content: &str,
) -> String {
    hex::encode(event_id_bytes(pubkey, created_at, kind, tags, content))
}

pub fn event_id_of(event: &Event) -> String {
    event_id_hex(
        &event.pubkey,
        event.created_at,
        event.kind,
        &event.tags,
        &event.content,
    )
}

/// First value of every tag whose name matches `name`.
pub fn event_tag_values(event: &Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) == Some(name))
        .filter_map(|tag| tag.get(1).cloned())
        .collect()
}

/// The channel an event belongs to: the NIP-29 `h` tag, if present.
pub fn event_channel_id(event: &Event) -> Option<String> {
    event_tag_values(event, "h").into_iter().next()
}

/// An edit envelope is a message-kind event carrying `["e", <target>, "", "edit"]`.
pub fn is_edit_event(event: &Event) -> bool {
    event.tags.iter().any(|tag| {
        tag.first().map(String::as_str) == Some("e")
            && tag.get(3).map(String::as_str) == Some("edit")
    })
}

/// Recompute the id and check the BIP340 signature. Rejects malformed events.
pub fn verify_event(event: &Event) -> Result<(), ChatError> {
    use secp256k1::{Message, XOnlyPublicKey};

    let expected = event_id_of(event);
    if expected != event.id {
        return Err(ChatError::Wire(format!(
            "event id mismatch: computed {expected}, received {}",
            event.id
        )));
    }
    let pubkey_bytes = hex::decode(&event.pubkey)?;
    if pubkey_bytes.len() != 32 {
        return Err(ChatError::Wire("pubkey must be 32 bytes".into()));
    }
    let xonly = XOnlyPublicKey::from_slice(&pubkey_bytes)?;
    let sig_bytes = hex::decode(&event.sig)?;
    let signature = secp256k1::schnorr::Signature::from_slice(&sig_bytes)?;
    let message = Message::from_digest(event_id_bytes(
        &event.pubkey,
        event.created_at,
        event.kind,
        &event.tags,
        &event.content,
    ));
    crate::keys::secp().verify_schnorr(&signature, &message, &xonly)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_serialization_is_compact_json_array() {
        let tags = vec![vec!["h".to_string(), "c1".to_string()]];
        let canon = canonical_id_serialization("ab", 1700000000, 9, &tags, "hi");
        assert_eq!(canon, r#"[0,"ab",1700000000,9,[["h","c1"]],"hi"]"#);
    }

    #[test]
    fn canonical_serialization_escapes_like_json_stringify() {
        let canon = canonical_id_serialization("ab", 1, 1, &[], "line1\nline2 \"q\" \\ é");
        assert_eq!(
            canon,
            "[0,\"ab\",1,1,[],\"line1\\nline2 \\\"q\\\" \\\\ é\"]"
        );
    }

    #[test]
    fn tag_helpers_read_names_and_values() {
        let event = Event {
            id: String::new(),
            pubkey: String::new(),
            created_at: 0,
            kind: 9,
            tags: vec![
                vec!["h".into(), "c1".into()],
                vec!["e".into(), "abc".into(), "".into(), "edit".into()],
            ],
            content: String::new(),
            sig: String::new(),
        };
        assert_eq!(event_channel_id(&event).as_deref(), Some("c1"));
        assert_eq!(event_tag_values(&event, "e"), vec!["abc".to_string()]);
        assert!(is_edit_event(&event));
    }
}
