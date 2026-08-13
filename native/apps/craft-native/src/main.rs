use craft_index::{count_indexed, reindex_workspace, retrieve, search, status, SourceRoot};
use craft_journal::{self, JournalError};
use craft_protocol::{
    encode_frame, protocol_major_matches, FrameDecoder, MessageEnvelope, WireError,
    NATIVE_CHANNELS, PROTOCOL_VERSION,
};
use craft_rund::{self, RunSpec};
use serde_json::{json, Value};
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixListener;

enum Mode {
    Sidecar(String),
    StubRun(PathBuf),
}

struct HandlerError {
    code: String,
    message: String,
}

impl From<String> for HandlerError {
    fn from(message: String) -> Self {
        Self {
            code: "HANDLER_ERROR".into(),
            message,
        }
    }
}

impl From<craft_rund::RundError> for HandlerError {
    fn from(error: craft_rund::RundError) -> Self {
        Self {
            code: error.code.to_string(),
            message: error.message,
        }
    }
}

impl From<JournalError> for HandlerError {
    fn from(error: JournalError) -> Self {
        Self {
            code: error.code.to_string(),
            message: error.message,
        }
    }
}

#[cfg(not(unix))]
fn main() {
    eprintln!("craft-native does not support Windows x64 yet");
    std::process::exit(2);
}

#[cfg(unix)]
#[tokio::main]
async fn main() {
    match parse_mode() {
        Ok(Mode::StubRun(dir)) => {
            if let Err(error) = craft_rund::run_stub(&dir) {
                eprintln!("craft-native stub-run: {error}");
                std::process::exit(1);
            }
        }
        Ok(Mode::Sidecar(socket)) => {
            if let Err(error) = real_main(socket).await {
                eprintln!("craft-native: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("craft-native: {error}");
            std::process::exit(1);
        }
    }
}

fn parse_mode() -> Result<Mode, String> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("--socket") => args
            .next()
            .ok_or_else(|| "missing value for --socket".to_string())
            .map(Mode::Sidecar),
        Some("--stub-run") => match args.next().as_deref() {
            Some("--dir") => args
                .next()
                .ok_or_else(|| "missing value for --dir".to_string())
                .map(|dir| Mode::StubRun(PathBuf::from(dir))),
            Some(other) => Err(format!("expected --dir after --stub-run, got {other}")),
            None => Err("required: --stub-run --dir <runDir>".to_string()),
        },
        Some("-h") | Some("--help") => {
            eprintln!("craft-native --socket <path>");
            eprintln!("craft-native --stub-run --dir <runDir>");
            std::process::exit(0);
        }
        Some(other) => Err(format!("unknown argument: {other}")),
        None => Err("required: --socket <path> | --stub-run --dir <runDir>".to_string()),
    }
}

#[cfg(unix)]
async fn real_main(socket: String) -> Result<(), String> {
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
        Err(error) => error_env(&env.id, &error.code, &error.message),
    }
}

fn handle_request(channel: &str, args: &[Value]) -> Result<Value, HandlerError> {
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
            serde_json::to_value(result).map_err(|e| e.to_string().into())
        }
        "index:search" => {
            let workspace = arg_str(args, 0)?;
            let query = arg_str(args, 1)?;
            let limit = args
                .get(2)
                .and_then(|v| v.get("limit"))
                .and_then(Value::as_u64);
            let result = search(Path::new(workspace), query, limit.map(|n| n as u32))?;
            serde_json::to_value(result).map_err(|e| e.to_string().into())
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
            serde_json::to_value(result).map_err(|e| e.to_string().into())
        }
        "index:count" => {
            let workspace = arg_str(args, 0)?;
            Ok(json!(count_indexed(Path::new(workspace))?))
        }
        "index:status" => {
            let workspace = arg_str(args, 0)?;
            let result = status(Path::new(workspace))?;
            serde_json::to_value(result).map_err(|e| e.to_string().into())
        }
        "run:create" => {
            let base = PathBuf::from(arg_str(args, 0)?);
            let spec: RunSpec = serde_json::from_value(args.get(1).cloned().unwrap_or(Value::Null))
                .map_err(|e| HandlerError {
                    code: "invalid_spec".into(),
                    message: format!("invalid run spec: {e}"),
                })?;
            let exe = env::current_exe().map_err(|e| e.to_string())?;
            let command = parse_runner_command(args.get(2))
                .unwrap_or_else(|| craft_rund::default_stub_command(&exe));
            let handle = craft_rund::create_run(&base, &spec, &command)?;
            let secs = craft_rund::max_wall_clock_sec(&spec);
            let id = handle.id.clone();
            let watch_base = base.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(secs)).await;
                let _ = craft_rund::enforce_clock_budget(&watch_base, &id);
            });
            serde_json::to_value(handle).map_err(|e| e.to_string().into())
        }
        "run:status" => {
            let base = arg_str(args, 0)?;
            let id = arg_str(args, 1)?;
            let status = craft_rund::get_status(Path::new(base), id)?;
            serde_json::to_value(status).map_err(|e| e.to_string().into())
        }
        "run:cancel" => {
            let base = arg_str(args, 0)?;
            let id = arg_str(args, 1)?;
            let pid = craft_rund::cancel(Path::new(base), id)?;
            if let Some(pid) = pid {
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    craft_rund::kill_pid_tree(pid, true);
                });
            }
            Ok(json!({ "ok": true }))
        }
        "run:listArtifacts" => {
            let base = arg_str(args, 0)?;
            let id = arg_str(args, 1)?;
            let artifacts = craft_rund::list_artifacts(Path::new(base), id)?;
            serde_json::to_value(artifacts).map_err(|e| e.to_string().into())
        }
        "run:fetchArtifact" => {
            let base = arg_str(args, 0)?;
            let id = arg_str(args, 1)?;
            let path = arg_str(args, 2)?;
            let bytes = craft_rund::fetch_artifact(Path::new(base), id, path)?;
            Ok(json!({
                "base64": encode_base64(&bytes),
                "size": bytes.len(),
            }))
        }
        "run:events" => {
            let base = arg_str(args, 0)?;
            let id = arg_str(args, 1)?;
            let offset = args.get(2).and_then(Value::as_u64).unwrap_or(0);
            let page = craft_rund::read_events(Path::new(base), id, offset)?;
            serde_json::to_value(page).map_err(|e| e.to_string().into())
        }
        "journal:write" => {
            let session_dir = PathBuf::from(arg_str(args, 0)?);
            let lines = parse_journal_lines(args.get(1))?;
            let status = craft_journal::write_journal(&session_dir, &lines)?;
            serde_json::to_value(status).map_err(|e| e.to_string().into())
        }
        "journal:read" => {
            let session_dir = arg_str(args, 0)?;
            let page = craft_journal::read_journal(Path::new(session_dir))?;
            serde_json::to_value(page).map_err(|e| e.to_string().into())
        }
        "journal:status" => {
            let session_dir = arg_str(args, 0)?;
            let status = craft_journal::read_status(Path::new(session_dir))?;
            serde_json::to_value(status).map_err(|e| e.to_string().into())
        }
        _ => Err(format!("unknown channel: {channel}").into()),
    }
}

fn arg_str(args: &[Value], index: usize) -> Result<&str, HandlerError> {
    args.get(index)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("args[{index}] must be a string").into())
}

fn parse_roots(value: Option<&Value>) -> Result<Vec<SourceRoot>, HandlerError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    serde_json::from_value(value.clone()).map_err(|e| format!("invalid roots: {e}").into())
}

fn parse_journal_lines(value: Option<&Value>) -> Result<Vec<String>, HandlerError> {
    let Some(value) = value else {
        return Err("args[1] must be an array of JSONL lines".to_string().into());
    };
    let arr = value
        .as_array()
        .ok_or_else(|| "args[1] must be an array of JSONL lines".to_string())?;
    Ok(arr
        .iter()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect())
}

fn parse_runner_command(value: Option<&Value>) -> Option<Vec<String>> {
    let arr = value
        .and_then(|v| v.get("runnerCommand"))
        .and_then(Value::as_array)?;
    let cmd: Vec<String> = arr
        .iter()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect();
    if cmd.is_empty() {
        None
    } else {
        Some(cmd)
    }
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    let mut i = 0;
    while i < input.len() {
        let remaining = input.len() - i;
        let b0 = input[i];
        let b1 = if remaining > 1 { input[i + 1] } else { 0 };
        let b2 = if remaining > 2 { input[i + 2] } else { 0 };
        let triple = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if remaining > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if remaining > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
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
