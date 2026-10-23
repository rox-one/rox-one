//! Event signing. The key is handed in by the host on every start and is kept
//! in memory only — nothing in this module persists it.

use crate::error::ChatError;
use crate::event::{event_id_bytes, Event};
use secp256k1::{Keypair, Message, Secp256k1, SecretKey};
use std::sync::LazyLock;

/// Shared signing/verification context (expensive to build, cheap to reuse).
static SECP: LazyLock<Secp256k1<secp256k1::All>> = LazyLock::new(Secp256k1::new);

pub fn secp() -> &'static Secp256k1<secp256k1::All> {
    &SECP
}

pub struct Keys {
    secret: SecretKey,
    pubkey_hex: String,
}

impl std::fmt::Debug for Keys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keys")
            .field("pubkey_hex", &self.pubkey_hex)
            .field("secret", &"<redacted>")
            .finish()
    }
}

impl Keys {
    pub fn from_hex(secret_key_hex: &str) -> Result<Self, ChatError> {
        let raw = secret_key_hex.trim();
        let bytes = hex::decode(raw).map_err(|e| ChatError::Key(format!("not hex: {e}")))?;
        if bytes.len() != 32 {
            return Err(ChatError::Key(format!(
                "expected a 32-byte secp256k1 secret, got {} bytes",
                bytes.len()
            )));
        }
        let secret = SecretKey::from_slice(&bytes)?;
        Ok(Self::from_secret(secret))
    }

    pub fn from_secret(secret: SecretKey) -> Self {
        let keypair = Keypair::from_secret_key(secp(), &secret);
        let (xonly, _parity) = keypair.x_only_public_key();
        let pubkey_hex = hex::encode(xonly.serialize());
        Self {
            secret,
            pubkey_hex,
        }
    }

    pub fn pubkey_hex(&self) -> &str {
        &self.pubkey_hex
    }

    /// BIP340 sign over a raw 32-byte digest (deterministic nonce, aux = 0).
    pub fn sign_digest(&self, digest: [u8; 32]) -> [u8; 64] {
        let keypair = Keypair::from_secret_key(secp(), &self.secret);
        let message = Message::from_digest(digest);
        secp().sign_schnorr_no_aux_rand(&message, &keypair).serialize()
    }

    /// Build a signed, NIP-01 canonical event.
    pub fn sign_event(
        &self,
        kind: u32,
        tags: Vec<Vec<String>>,
        content: &str,
        created_at: i64,
    ) -> Event {
        let id = event_id_bytes(&self.pubkey_hex, created_at, kind, &tags, content);
        let sig = self.sign_digest(id);
        Event {
            id: hex::encode(id),
            pubkey: self.pubkey_hex.clone(),
            created_at,
            kind,
            tags,
            content: content.to_string(),
            sig: hex::encode(sig),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::verify_event;

    const KEY_ONE: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const KEY_THREE: &str = "0000000000000000000000000000000000000000000000000000000000000003";

    #[test]
    fn rejects_bad_keys() {
        assert!(Keys::from_hex("").is_err());
        assert!(Keys::from_hex("zz").is_err());
        assert!(Keys::from_hex(&"11".repeat(31)).is_err());
        assert!(Keys::from_hex(&"00".repeat(32)).is_err(), "zero is not a scalar");
    }

    #[test]
    fn x_only_pubkey_matches_generator_for_key_one() {
        let keys = Keys::from_hex(KEY_ONE).unwrap();
        assert_eq!(
            keys.pubkey_hex(),
            "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
        );
    }

    /// BIP340 official test vector 0 (secret key 3, aux_rand 0, message 0).
    #[test]
    fn bip340_test_vector_zero() {
        let keys = Keys::from_hex(KEY_THREE).unwrap();
        assert_eq!(
            keys.pubkey_hex(),
            "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
        );
        let sig = keys.sign_digest([0u8; 32]);
        assert_eq!(
            hex::encode(sig),
            "e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0"
        );
    }

    #[test]
    fn signed_event_verifies_and_tampering_is_rejected() {
        let keys = Keys::from_hex(KEY_ONE).unwrap();
        let tags = vec![vec!["h".to_string(), "chan-1".to_string()]];
        let event = keys.sign_event(9, tags, "hello", 1_700_000_000);
        // Independently derived: sha256 of
        // `[0,"79be…1798",1700000000,9,[["h","chan-1"]],"hello"]`.
        assert_eq!(
            event.id,
            "3aa51e73d7179504b15d8b0f8f6562780c5803eeb735252d64e061f8cbe24d67"
        );
        assert!(verify_event(&event).is_ok());

        let mut tampered = event.clone();
        tampered.content = "tampered".into();
        assert!(verify_event(&tampered).is_err());

        let mut replayed = event;
        replayed.pubkey = Keys::from_hex(KEY_THREE).unwrap().pubkey_hex().to_string();
        assert!(verify_event(&replayed).is_err());
    }
}
