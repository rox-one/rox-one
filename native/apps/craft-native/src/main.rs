use craft_index::{count_indexed, reindex_workspace, retrieve, search, status, SourceRoot};
use craft_protocol::{
    encode_frame, protocol_major_matches, FrameDecoder, MessageEnvelope, WireError,
    NATIVE_CHANNELS, PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use std::env;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixListener;

#[cfg(not(unix))]
fn main() {
    eprintln!("craft-native does not support Windows x64 yet");
    std::process::exit(2);
}

#[cfg(unix)]
#[tokio::main]
async fn main() {
    if let Err(error) = real_main().await {
        eprintln!("craft-native: {error}");
        std::process::exit(1);
    }
}

#[cfg(unix)]
async fn real_main() -> Result<(), String> {
    let socket = parse_socket_arg()?;
    if Path::new(&socket).exists() {
        std::fs::remove_file(&socket).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = Path::new(&socket).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let listener = UnixListener::bind(&socket).map_err(|e| e.to_string())?;
    loop {
        let (stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        tokio::spawn(async move {
            if let Err(error) = handle_conn(stream).await {
                eprintln!("craft-native connection: {error}");
            }
        });
    }
}

fn parse_socket_arg() -> Result<String, String> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("--socket") => args
            .next()
            .ok_or_else(|| "missing value for --socket".to_string()),
        Some("-h") | Some("--help") => {
            eprintln!("craft-native --socket <path>");
            std::process::exit(0);
        }
        Some(other) => Err(format!("unknown argument: {other}")),
        None => Err("required: --socket <path>".to_string()),
    }
}

#[cfg(unix)]
async fn handle_conn(mut stream: tokio::net::UnixStream) -> Result<(), String> {
    let mut decoder = FrameDecoder::new();
    let mut buf = vec![0u8; 8192];
    let mut handshake_done = false;
    loop {
        let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        let frames = decoder.push(&buf[..n])?;
        for payload in frames {
            let env: MessageEnvelope =
                serde_json::from_slice(&payload).map_err(|e| e.to_string())?;
            let reply = dispatch(&env, &mut handshake_done);
            let bytes = serde_json::to_vec(&reply).map_err(|e| e.to_string())?;
            let frame = encode_frame(&bytes)?;
            stream.write_all(&frame).await.map_err(|e| e.to_string())?;
            if reply.msg_type == "error"
                && reply
                    .error
                    .as_ref()
                    .is_some_and(|e| e.code == "PROTOCOL_VERSION_UNSUPPORTED")
            {
                return Ok(());
            }
        }
    }
}

fn dispatch(env: &MessageEnvelope, handshake_done: &mut bool) -> MessageEnvelope {
    if !*handshake_done {
        if env.msg_type != "handshake" {
            return error_env(
                &env.id,
                "PROTOCOL_VERSION_UNSUPPORTED",
                "expected handshake",
            );
        }
        let client_ver = env.protocol_version.as_deref().unwrap_or("");
        if client_ver.is_empty() || !protocol_major_matches(client_ver, PROTOCOL_VERSION) {
            return error_env(
                &env.id,
                "PROTOCOL_VERSION_UNSUPPORTED",
                &format!("Server protocol {PROTOCOL_VERSION}, client {client_ver}"),
            );
        }
        *handshake_done = true;
        return MessageEnvelope {
            id: env.id.clone(),
            msg_type: "handshake_ack".into(),
            protocol_version: Some(PROTOCOL_VERSION.into()),
            client_id: Some("native-sidecar".into()),
            registered_channels: Some(NATIVE_CHANNELS.iter().map(|s| (*s).to_string()).collect()),
            server_version: Some(env!("CARGO_PKG_VERSION").into()),
            ..MessageEnvelope::default()
        };
    }
    if env.msg_type != "request" {
        return error_env(&env.id, "HANDLER_ERROR", "expected request");
    }
    let channel = env.channel.as_deref().unwrap_or("");
    match handle_request(channel, env.args.as_deref().unwrap_or(&[])) {
        Ok(result) => MessageEnvelope {
            id: env.id.clone(),
            msg_type: "response".into(),
            channel: Some(channel.into()),
            result: Some(result),
            ..MessageEnvelope::default()
        },
        Err(message) => error_env(&env.id, "HANDLER_ERROR", &message),
    }
}

fn handle_request(channel: &str, args: &[Value]) -> Result<Value, String> {
    match channel {
        "native:health" => Ok(json!({ "ok": true })),
        "native:version" => Ok(json!({
            "version": env!("CARGO_PKG_VERSION"),
            "protocolVersion": PROTOCOL_VERSION,
        })),
        "native:capabilities" => Ok(json!({ "channels": NATIVE_CHANNELS })),
        "index:reindex" => {
            let workspace = arg_str(args, 0)?;
            let roots = parse_roots(args.get(1))?;
            let result = reindex_workspace(Path::new(workspace), &roots)?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "index:search" => {
            let workspace = arg_str(args, 0)?;
            let query = arg_str(args, 1)?;
            let limit = args
                .get(2)
                .and_then(|v| v.get("limit"))
                .and_then(Value::as_u64);
            let result = search(Path::new(workspace), query, limit.map(|n| n as u32))?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "index:retrieve" => {
            let workspace = arg_str(args, 0)?;
            let query = arg_str(args, 1)?;
            let opts = args.get(2);
            let limit = opts.and_then(|v| v.get("limit")).and_then(Value::as_u64);
            let max_tokens = opts
                .and_then(|v| v.get("maxTokens"))
                .and_then(Value::as_u64);
            let result = retrieve(
                Path::new(workspace),
                query,
                limit.map(|n| n as u32),
                max_tokens.map(|n| n as u32),
            )?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "index:count" => {
            let workspace = arg_str(args, 0)?;
            Ok(json!(count_indexed(Path::new(workspace))?))
        }
        "index:status" => {
            let workspace = arg_str(args, 0)?;
            let result = status(Path::new(workspace))?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        _ => Err(format!("unknown channel: {channel}")),
    }
}

fn arg_str(args: &[Value], index: usize) -> Result<&str, String> {
    args.get(index)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("args[{index}] must be a string"))
}

fn parse_roots(value: Option<&Value>) -> Result<Vec<SourceRoot>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    serde_json::from_value(value.clone()).map_err(|e| format!("invalid roots: {e}"))
}

fn error_env(id: &str, code: &str, message: &str) -> MessageEnvelope {
    MessageEnvelope {
        id: id.to_string(),
        msg_type: "error".into(),
        error: Some(WireError {
            code: code.into(),
            message: message.into(),
            data: None,
        }),
        ..MessageEnvelope::default()
    }
}
