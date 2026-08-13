//! Wire `MessageEnvelope` — same JSON shape as `packages/shared/src/protocol/types.ts`.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "1.0";
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

pub const NATIVE_CHANNELS: &[&str] = &[
    "native:health",
    "native:version",
    "native:capabilities",
    "index:reindex",
    "index:search",
    "index:retrieve",
    "index:count",
    "index:status",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MessageEnvelope {
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WireError>,
    #[serde(rename = "protocolVersion", skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<String>,
    #[serde(rename = "workspaceId", skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(rename = "clientId", skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(rename = "serverId", skip_serializing_if = "Option::is_none")]
    pub server_id: Option<String>,
    #[serde(rename = "clientCapabilities", skip_serializing_if = "Option::is_none")]
    pub client_capabilities: Option<Vec<String>>,
    #[serde(rename = "registeredChannels", skip_serializing_if = "Option::is_none")]
    pub registered_channels: Option<Vec<String>>,
    #[serde(rename = "serverVersion", skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
}

pub fn major_version(version: &str) -> u32 {
    version
        .split('.')
        .next()
        .and_then(|part| part.parse().ok())
        .unwrap_or(0)
}

pub fn protocol_major_matches(client: &str, server: &str) -> bool {
    major_version(client) == major_version(server)
}

pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() > MAX_FRAME_BYTES {
        return Err(format!("native frame too large: {}", payload.len()));
    }
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

#[derive(Debug, Default)]
pub struct FrameDecoder {
    buf: Vec<u8>,
    max: usize,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self {
            buf: Vec::new(),
            max: MAX_FRAME_BYTES,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        loop {
            if self.buf.len() < 4 {
                break;
            }
            let mut header = [0u8; 4];
            header.copy_from_slice(&self.buf[..4]);
            let len = u32::from_be_bytes(header) as usize;
            if len > self.max {
                return Err(format!("native frame too large: {len}"));
            }
            if self.buf.len() < 4 + len {
                break;
            }
            out.push(self.buf[4..4 + len].to_vec());
            self.buf.drain(..4 + len);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HANDSHAKE_FIXTURE: &str =
        include_str!("../../../../packages/shared/src/protocol/__fixtures__/handshake.json");
    const HANDSHAKE_ACK_FIXTURE: &str =
        include_str!("../../../../packages/shared/src/protocol/__fixtures__/handshake-ack.json");

    #[test]
    fn handshake_fixture_is_protocol_1() {
        let env: MessageEnvelope = serde_json::from_str(HANDSHAKE_FIXTURE).unwrap();
        assert_eq!(env.msg_type, "handshake");
        assert_eq!(env.protocol_version.as_deref(), Some(PROTOCOL_VERSION));
        assert!(protocol_major_matches(
            env.protocol_version.as_deref().unwrap(),
            PROTOCOL_VERSION
        ));
    }

    #[test]
    fn handshake_ack_fixture_lists_index_channels() {
        let env: MessageEnvelope = serde_json::from_str(HANDSHAKE_ACK_FIXTURE).unwrap();
        assert_eq!(env.msg_type, "handshake_ack");
        let channels = env.registered_channels.expect("channels");
        assert!(channels.iter().any(|c| c == "native:health"));
        assert!(channels.iter().any(|c| c == "index:reindex"));
    }

    #[test]
    fn skips_unknown_fields() {
        let raw = r#"{"id":"x","type":"handshake","protocolVersion":"1.0","futureField":true}"#;
        let env: MessageEnvelope = serde_json::from_str(raw).unwrap();
        assert_eq!(env.id, "x");
    }

    #[test]
    fn major_mismatch_is_detected() {
        assert!(!protocol_major_matches("2.0", PROTOCOL_VERSION));
        assert!(protocol_major_matches("1.9", PROTOCOL_VERSION));
    }

    #[test]
    fn frame_round_trip() {
        let payload = b"{\"id\":\"a\"}";
        let frame = encode_frame(payload).unwrap();
        let mut decoder = FrameDecoder::new();
        let out = decoder.push(&frame).unwrap();
        assert_eq!(out, vec![payload.to_vec()]);
    }
}
