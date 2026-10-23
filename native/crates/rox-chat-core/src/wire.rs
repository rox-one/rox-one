//! NIP-01 framing.
//!
//! Client → relay: `["REQ", subId, filters…]`, `["EVENT", event]`,
//! `["CLOSE", subId]`, `["AUTH", event]`.
//! Relay → client: `["EVENT", subId, event]`, `["EOSE", subId]`,
//! `["OK", eventId, accepted, message]`, `["AUTH", challenge]`,
//! `["NOTICE", message]`.

use crate::error::ChatError;
use crate::event::{
    Event, EPHEMERAL_PRESENCE, EPHEMERAL_TYPING, KIND_DELETE, KIND_STREAM_MESSAGE, KIND_TEXT_NOTE,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// NIP-01 subscription filter. Tag filters keep their `#` prefix (`"#h"`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Filter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(flatten)]
    pub tags: BTreeMap<String, Vec<String>>,
}

impl Filter {
    /// Everything a live channel view needs: messages, deletions and the two
    /// ephemeral kinds, scoped to the NIP-29 `h` tag.
    pub fn channel(channel_id: &str) -> Self {
        let mut tags = BTreeMap::new();
        tags.insert("#h".to_string(), vec![channel_id.to_string()]);
        Self {
            kinds: Some(vec![
                KIND_TEXT_NOTE,
                KIND_STREAM_MESSAGE,
                KIND_DELETE,
                EPHEMERAL_PRESENCE,
                EPHEMERAL_TYPING,
            ]),
            limit: Some(500),
            tags,
            ..Self::default()
        }
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| json!({}))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ClientFrame {
    Req { sub_id: String, filters: Vec<Filter> },
    Event(Event),
    Close { sub_id: String },
    Auth(Event),
}

impl ClientFrame {
    /// Serialise to the wire form (compact JSON array).
    pub fn to_json(&self) -> String {
        self.to_value().to_string()
    }

    pub fn to_value(&self) -> Value {
        match self {
            ClientFrame::Req { sub_id, filters } => {
                let mut frame = vec![json!("REQ"), json!(sub_id)];
                for filter in filters {
                    frame.push(filter.to_value());
                }
                Value::Array(frame)
            }
            ClientFrame::Event(event) => json!(["EVENT", event]),
            ClientFrame::Close { sub_id } => json!(["CLOSE", sub_id]),
            ClientFrame::Auth(event) => json!(["AUTH", event]),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum RelayFrame {
    Event { sub_id: String, event: Event },
    Eose { sub_id: String },
    Ok { event_id: String, accepted: bool, message: String },
    Auth { challenge: String },
    Notice { message: String },
    Unknown { label: String },
}

impl RelayFrame {
    pub fn parse(value: &Value) -> Result<RelayFrame, ChatError> {
        let array = value
            .as_array()
            .ok_or_else(|| ChatError::Wire("relay frame is not a JSON array".into()))?;
        let label = array
            .first()
            .and_then(Value::as_str)
            .ok_or_else(|| ChatError::Wire("relay frame has no string label".into()))?;
        let str_at = |idx: usize| -> String {
            array
                .get(idx)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        Ok(match label {
            "EVENT" => {
                let raw = array
                    .get(2)
                    .ok_or_else(|| ChatError::Wire("EVENT frame has no event body".into()))?;
                let event: Event = serde_json::from_value(raw.clone())?;
                RelayFrame::Event {
                    sub_id: str_at(1),
                    event,
                }
            }
            "EOSE" => RelayFrame::Eose { sub_id: str_at(1) },
            "OK" => RelayFrame::Ok {
                event_id: str_at(1),
                accepted: array.get(2).and_then(Value::as_bool).unwrap_or(false),
                message: str_at(3),
            },
            "AUTH" => RelayFrame::Auth {
                challenge: str_at(1),
            },
            "NOTICE" => RelayFrame::Notice {
                message: str_at(1),
            },
            other => RelayFrame::Unknown {
                label: other.to_string(),
            },
        })
    }

    pub fn parse_str(text: &str) -> Result<RelayFrame, ChatError> {
        let value: Value = serde_json::from_str(text)?;
        RelayFrame::parse(&value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::Keys;

    fn event() -> Event {
        Keys::from_hex("0000000000000000000000000000000000000000000000000000000000000001")
            .unwrap()
            .sign_event(9, vec![vec!["h".into(), "c1".into()]], "hi", 1_700_000_000)
    }

    #[test]
    fn req_encodes_subscription_filters() {
        let frame = ClientFrame::Req {
            sub_id: "sub-c1".into(),
            filters: vec![Filter::channel("c1")],
        };
        let value = frame.to_value();
        assert_eq!(value[0], json!("REQ"));
        assert_eq!(value[1], json!("sub-c1"));
        assert_eq!(value[2]["#h"], json!(["c1"]));
        assert_eq!(value[2]["limit"], json!(500));
        assert!(value[2]["kinds"].as_array().unwrap().contains(&json!(9)));
        assert!(value[2]["kinds"].as_array().unwrap().contains(&json!(20001)));
    }

    #[test]
    fn event_and_close_and_auth_round_trip() {
        let ev = event();
        let publish = ClientFrame::Event(ev.clone()).to_json();
        let parsed: Value = serde_json::from_str(&publish).unwrap();
        assert_eq!(parsed[0], json!("EVENT"));
        assert_eq!(parsed[1]["id"], json!(ev.id));

        assert_eq!(
            ClientFrame::Close {
                sub_id: "s".into()
            }
            .to_json(),
            r#"["CLOSE","s"]"#
        );

        let auth = ClientFrame::Auth(ev).to_json();
        let parsed: Value = serde_json::from_str(&auth).unwrap();
        assert_eq!(parsed[0], json!("AUTH"));
    }

    #[test]
    fn parses_every_relay_frame_kind() {
        let ev = event();
        let parsed = RelayFrame::parse_str(&format!(
            r#"["EVENT","sub-c1",{}]"#,
            serde_json::to_string(&ev).unwrap()
        ))
        .unwrap();
        match parsed {
            RelayFrame::Event { sub_id, event } => {
                assert_eq!(sub_id, "sub-c1");
                assert_eq!(event.id, ev.id);
            }
            other => panic!("unexpected {other:?}"),
        }

        assert_eq!(
            RelayFrame::parse_str(r#"["EOSE","sub-c1"]"#).unwrap(),
            RelayFrame::Eose {
                sub_id: "sub-c1".into()
            }
        );
        assert_eq!(
            RelayFrame::parse_str(r#"["OK","abc",true,"saved"]"#).unwrap(),
            RelayFrame::Ok {
                event_id: "abc".into(),
                accepted: true,
                message: "saved".into()
            }
        );
        assert_eq!(
            RelayFrame::parse_str(r#"["AUTH","challenge-1"]"#).unwrap(),
            RelayFrame::Auth {
                challenge: "challenge-1".into()
            }
        );
        assert_eq!(
            RelayFrame::parse_str(r#"["NOTICE","rate limited"]"#).unwrap(),
            RelayFrame::Notice {
                message: "rate limited".into()
            }
        );
        assert_eq!(
            RelayFrame::parse_str(r#"["COUNT",1]"#).unwrap(),
            RelayFrame::Unknown {
                label: "COUNT".into()
            }
        );
    }

    #[test]
    fn rejects_non_array_and_bodyless_event() {
        assert!(RelayFrame::parse_str(r#"{"a":1}"#).is_err());
        assert!(RelayFrame::parse_str(r#"["EVENT","sub"]"#).is_err());
    }
}
