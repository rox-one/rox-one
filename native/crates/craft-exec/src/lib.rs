//! Host-tool Bash. Craft-native `exec:run` — not a full sandbox.
//!
//! Caps match the TypeScript `handleHostBash` path: credential env scrub,
//! stdout/stderr size, wall-clock timeout, process-tree kill, optional
//! workspace-root cwd jail.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub const MAX_OUTPUT_CHARS: usize = 20_000;
pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
pub const MAX_TIMEOUT_MS: u64 = 120_000;

const BLOCKED_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "STRIPE_SECRET_KEY",
    "NPM_TOKEN",
    "INFISICAL_TOKEN",
];
const BLOCKED_ENV_PREFIXES: &[&str] = &["ROX_SECRET_"];

#[derive(Debug, Clone)]
pub struct ExecError {
    pub code: &'static str,
    pub message: String,
}

impl ExecError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_spec",
            message: message.into(),
        }
    }

    fn io(message: impl Into<String>) -> Self {
        Self {
            code: "provider_error",
            message: message.into(),
        }
    }
}

pub type ExecResult<T> = Result<T, ExecError>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecRequest {
    pub command: String,
    pub cwd: String,
    pub timeout_ms: Option<u64>,
    /// When set, `cwd` must resolve inside this directory.
    #[serde(default)]
    pub workspace_root: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResponse {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub cwd: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

fn is_blocked_env(key: &str) -> bool {
    BLOCKED_ENV.contains(&key) || BLOCKED_ENV_PREFIXES.iter().any(|p| key.starts_with(p))
}

fn truncate(text: String) -> (String, bool) {
    if text.chars().count() <= MAX_OUTPUT_CHARS {
        return (text, false);
    }
    (
        text.chars().take(MAX_OUTPUT_CHARS).collect(),
        true,
    )
}

fn read_capped<R: Read>(mut reader: R) -> String {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let cap = MAX_OUTPUT_CHARS * 2;
    loop {
        match reader.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                let remain = cap.saturating_sub(buf.len());
                if remain > 0 {
                    buf.extend_from_slice(&tmp[..n.min(remain)]);
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

fn kill_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", &format!("-{pid}")])
            .status();
    }
    let _ = child.kill();
}

fn resolve_cwd(req: &ExecRequest) -> ExecResult<std::path::PathBuf> {
    let cwd = Path::new(&req.cwd);
    if !cwd.is_dir() {
        return Err(ExecError::invalid(format!(
            "bash working directory does not exist: {}",
            req.cwd
        )));
    }
    let cwd = cwd.canonicalize().map_err(|e| {
        ExecError::invalid(format!("bash working directory is not accessible: {e}"))
    })?;
    let Some(root) = req.workspace_root.as_deref().filter(|s| !s.is_empty()) else {
        return Ok(cwd);
    };
    let root = Path::new(root);
    if !root.is_dir() {
        return Err(ExecError::invalid(format!(
            "bash workspace root does not exist: {}",
            root.display()
        )));
    }
    let root = root.canonicalize().map_err(|e| {
        ExecError::invalid(format!("bash workspace root is not accessible: {e}"))
    })?;
    if cwd != root && !cwd.starts_with(&root) {
        return Err(ExecError::invalid(
            "bash working directory is outside the workspace.",
        ));
    }
    Ok(cwd)
}

pub fn run(req: ExecRequest) -> ExecResult<ExecResponse> {
    let command = req.command.trim();
    if command.is_empty() {
        return Err(ExecError::invalid("bash requires a non-empty command."));
    }
    let cwd = resolve_cwd(&req)?;
    let timeout_ms = req
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1, MAX_TIMEOUT_MS);

    let shell = if cfg!(windows) { "bash" } else { "/bin/bash" };
    let mut cmd = Command::new(shell);
    cmd.args(["-lc", command])
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    for (key, _) in std::env::vars() {
        if is_blocked_env(&key) {
            cmd.env_remove(&key);
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| ExecError::io(e.to_string()))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let t_out = thread::spawn(move || stdout.map(read_capped).unwrap_or_default());
    let t_err = thread::spawn(move || stderr.map(read_capped).unwrap_or_default());

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if Instant::now() >= deadline => {
                timed_out = true;
                kill_tree(&mut child);
                let _ = child.wait();
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(15)),
            Err(e) => return Err(ExecError::io(e.to_string())),
        }
    };

    let stdout_raw = t_out.join().unwrap_or_default();
    let stderr_raw = t_err.join().unwrap_or_default();
    let (stdout, stdout_truncated) = truncate(stdout_raw);
    let (stderr, stderr_truncated) = truncate(stderr_raw);

    Ok(ExecResponse {
        stdout,
        stderr,
        exit_code: if timed_out {
            None
        } else {
            status.and_then(|s| s.code())
        },
        timed_out,
        duration_ms: started.elapsed().as_millis() as u64,
        cwd: cwd.to_string_lossy().into_owned(),
        stdout_truncated,
        stderr_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn rejects_blank_command() {
        let dir = tempdir().unwrap();
        let err = run(ExecRequest {
            command: "  ".into(),
            cwd: dir.path().to_string_lossy().into_owned(),
            timeout_ms: None,
            workspace_root: None,
        })
        .unwrap_err();
        assert_eq!(err.code, "invalid_spec");
    }

    #[test]
    fn runs_echo_in_cwd() {
        let dir = tempdir().unwrap();
        let result = run(ExecRequest {
            command: "pwd && echo craft-exec-ok".into(),
            cwd: dir.path().to_string_lossy().into_owned(),
            timeout_ms: Some(5_000),
            workspace_root: None,
        })
        .unwrap();
        assert!(!result.timed_out);
        assert_eq!(result.exit_code, Some(0));
        assert!(result.stdout.contains("craft-exec-ok"));
        assert!(result.stdout.contains(dir.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn times_out_sleep() {
        let dir = tempdir().unwrap();
        let result = run(ExecRequest {
            command: "sleep 8".into(),
            cwd: dir.path().to_string_lossy().into_owned(),
            timeout_ms: Some(250),
            workspace_root: None,
        })
        .unwrap();
        assert!(result.timed_out);
    }

    #[test]
    fn rejects_cwd_outside_workspace_root() {
        let workspace = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let err = run(ExecRequest {
            command: "echo no".into(),
            cwd: outside.path().to_string_lossy().into_owned(),
            timeout_ms: None,
            workspace_root: Some(workspace.path().to_string_lossy().into_owned()),
        })
        .unwrap_err();
        assert_eq!(err.code, "invalid_spec");
        assert!(err.message.contains("workspace"));
    }

    #[test]
    fn rejects_parent_escape_from_workspace_root() {
        let root = tempdir().unwrap();
        let workspace = root.path().join("ws");
        let outside = root.path().join("outside");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let err = run(ExecRequest {
            command: "echo no".into(),
            cwd: workspace.join("..").join("outside").to_string_lossy().into_owned(),
            timeout_ms: None,
            workspace_root: Some(workspace.to_string_lossy().into_owned()),
        })
        .unwrap_err();
        assert_eq!(err.code, "invalid_spec");
        assert!(err.message.contains("outside the workspace"));
    }

    #[test]
    fn allows_cwd_inside_workspace_root() {
        let workspace = tempdir().unwrap();
        let inner = workspace.path().join("src");
        std::fs::create_dir(&inner).unwrap();
        let result = run(ExecRequest {
            command: "echo jailed-ok".into(),
            cwd: inner.to_string_lossy().into_owned(),
            timeout_ms: Some(5_000),
            workspace_root: Some(workspace.path().to_string_lossy().into_owned()),
        })
        .unwrap();
        assert_eq!(result.exit_code, Some(0));
        assert!(result.stdout.contains("jailed-ok"));
    }

    #[test]
    fn scrubs_blocked_env() {
        let dir = tempdir().unwrap();
        std::env::set_var("AWS_SECRET_ACCESS_KEY", "secret-should-not-leak");
        let result = run(ExecRequest {
            command: "printenv AWS_SECRET_ACCESS_KEY || true".into(),
            cwd: dir.path().to_string_lossy().into_owned(),
            timeout_ms: Some(5_000),
            workspace_root: None,
        })
        .unwrap();
        std::env::remove_var("AWS_SECRET_ACCESS_KEY");
        assert!(!result.stdout.contains("secret-should-not-leak"));
    }
}
