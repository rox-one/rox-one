//! Local durable runs for the native sidecar.
//!
//! On-disk layout matches `LocalSubprocessProvider`:
//! `<baseDir>/<id>/{spec.json,state.json,events.jsonl,runner.pid,artifacts/}`

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const DEFAULT_MAX_WALL_CLOCK_SEC: u64 = 30 * 60;

#[derive(Debug, Clone)]
pub struct RundError {
    pub code: &'static str,
    pub message: String,
}

impl RundError {
    fn not_found(id: &str) -> Self {
        Self {
            code: "not_found",
            message: format!("run not found: {id}"),
        }
    }

    fn invalid_spec(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_spec",
            message: message.into(),
        }
    }

    fn path_traversal(path: &str) -> Self {
        Self {
            code: "path_traversal",
            message: format!("unsafe artifact path: {path}"),
        }
    }

    fn other(message: impl Into<String>) -> Self {
        Self {
            code: "provider_error",
            message: message.into(),
        }
    }
}

pub type RundResult<T> = Result<T, RundError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRunSubtask {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunLimits {
    #[serde(default)]
    pub max_wall_clock_sec: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
    pub id: String,
    pub name: String,
    pub subtasks: Vec<CloudRunSubtask>,
    #[serde(default)]
    pub limits: Option<RunLimits>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunHandle {
    pub id: String,
    pub provider: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactMeta {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsPage {
    pub events: Vec<Value>,
    pub next_offset: u64,
    pub terminal: bool,
}

pub fn default_stub_command(exe: &Path) -> Vec<String> {
    vec![exe.to_string_lossy().into_owned(), "--stub-run".to_string()]
}

pub fn max_wall_clock_sec(spec: &RunSpec) -> u64 {
    spec.limits
        .as_ref()
        .and_then(|limits| limits.max_wall_clock_sec)
        .unwrap_or(DEFAULT_MAX_WALL_CLOCK_SEC)
}

pub fn create_run(base_dir: &Path, spec: &RunSpec, command: &[String]) -> RundResult<RunHandle> {
    validate_run_id(&spec.id)?;
    if spec.subtasks.is_empty() {
        return Err(RundError::invalid_spec("spec.subtasks must not be empty"));
    }
    if command.is_empty() {
        return Err(RundError::other("runner command is empty"));
    }

    let dir = run_dir(base_dir, &spec.id);
    let state_path = dir.join("state.json");
    if let Some(existing) = read_status(&state_path)? {
        return Ok(RunHandle {
            id: spec.id.clone(),
            provider: "native".into(),
            created_at: existing.started_at.unwrap_or_else(now_ms),
        });
    }

    fs::create_dir_all(dir.join("artifacts")).map_err(|e| RundError::other(e.to_string()))?;
    write_pretty(&dir.join("spec.json"), spec)?;
    let queued = RunStatus {
        id: spec.id.clone(),
        state: "queued".into(),
        started_at: None,
        finished_at: None,
        failure_reason: None,
        progress: None,
    };
    write_status(&dir, &queued)?;

    let pid = spawn_runner(command, &dir)?;
    fs::write(dir.join("runner.pid"), pid.to_string())
        .map_err(|e| RundError::other(e.to_string()))?;

    Ok(RunHandle {
        id: spec.id.clone(),
        provider: "native".into(),
        created_at: now_ms(),
    })
}

pub fn get_status(base_dir: &Path, id: &str) -> RundResult<RunStatus> {
    validate_run_id(id)?;
    let dir = run_dir(base_dir, id);
    let mut state =
        read_status(&dir.join("state.json"))?.ok_or_else(|| RundError::not_found(id))?;
    if (state.state == "running" || state.state == "queued")
        && !matches!(read_pid(&dir)?, Some(pid) if pid_alive(pid))
    {
        state.state = "failed".into();
        state.failure_reason = Some("runner_error".into());
        state.finished_at = Some(now_ms());
        write_status(&dir, &state)?;
    }
    Ok(state)
}

/// Returns the runner pid when a live process was signalled, so the caller can
/// schedule a delayed SIGKILL without blocking the RPC.
pub fn cancel(base_dir: &Path, id: &str) -> RundResult<Option<i32>> {
    validate_run_id(id)?;
    let dir = run_dir(base_dir, id);
    let state = read_status(&dir.join("state.json"))?.ok_or_else(|| RundError::not_found(id))?;
    if matches!(state.state.as_str(), "done" | "failed" | "cancelled") {
        return Ok(None);
    }
    let pid = read_pid(&dir)?;
    let signalled = match pid {
        Some(pid) if pid_alive(pid) => {
            kill_tree(pid, libc_sigterm());
            Some(pid)
        }
        _ => None,
    };
    let cancelled = RunStatus {
        id: id.to_string(),
        state: "cancelled".into(),
        started_at: state.started_at,
        finished_at: Some(now_ms()),
        failure_reason: Some("cancelled".into()),
        progress: state.progress,
    };
    write_status(&dir, &cancelled)?;
    Ok(signalled)
}

pub fn kill_pid_tree(pid: i32, sigkill: bool) {
    kill_tree(
        pid,
        if sigkill {
            libc_sigkill()
        } else {
            libc_sigterm()
        },
    );
}

pub fn list_artifacts(base_dir: &Path, id: &str) -> RundResult<Vec<ArtifactMeta>> {
    validate_run_id(id)?;
    let dir = run_dir(base_dir, id);
    if read_status(&dir.join("state.json"))?.is_none() {
        return Err(RundError::not_found(id));
    }
    let root = dir.join("artifacts");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    walk_artifacts(&root, Path::new(""), &mut out)?;
    Ok(out)
}

pub fn fetch_artifact(base_dir: &Path, id: &str, path: &str) -> RundResult<Vec<u8>> {
    validate_run_id(id)?;
    assert_safe_artifact_path(path)?;
    let dir = run_dir(base_dir, id);
    if read_status(&dir.join("state.json"))?.is_none() {
        return Err(RundError::not_found(id));
    }
    let root = dir
        .join("artifacts")
        .canonicalize()
        .unwrap_or(dir.join("artifacts"));
    let abs = root.join(path);
    let canon = abs.canonicalize().map_err(|_| RundError {
        code: "not_found",
        message: format!("artifact not found: {path}"),
    })?;
    if !canon.starts_with(&root) {
        return Err(RundError::path_traversal(path));
    }
    if !canon.is_file() {
        return Err(RundError {
            code: "not_found",
            message: format!("artifact not found: {path}"),
        });
    }
    fs::read(&canon).map_err(|e| RundError::other(e.to_string()))
}

pub fn read_events(base_dir: &Path, id: &str, offset: u64) -> RundResult<EventsPage> {
    validate_run_id(id)?;
    let dir = run_dir(base_dir, id);
    let events_path = dir.join("events.jsonl");
    if !events_path.exists() && read_status(&dir.join("state.json"))?.is_none() {
        return Err(RundError::not_found(id));
    }
    let data = fs::read(&events_path).unwrap_or_default();
    if offset as usize > data.len() {
        return Ok(EventsPage {
            events: Vec::new(),
            next_offset: data.len() as u64,
            terminal: false,
        });
    }
    let tail = &data[offset as usize..];
    let text = String::from_utf8_lossy(tail);
    let mut events = Vec::new();
    let mut consumed = 0usize;
    let mut terminal = false;
    for line in text.split('\n') {
        if line.is_empty() {
            consumed += 1;
            continue;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(event) => {
                consumed += line.len() + 1;
                if event.get("type").and_then(Value::as_str) == Some("state") {
                    let state = event
                        .get("status")
                        .and_then(|s| s.get("state"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if state != "queued" && state != "running" {
                        terminal = true;
                    }
                }
                events.push(event);
            }
            Err(_) => break,
        }
    }
    Ok(EventsPage {
        events,
        next_offset: offset + consumed as u64,
        terminal,
    })
}

pub fn enforce_clock_budget(base_dir: &Path, id: &str) -> RundResult<()> {
    validate_run_id(id)?;
    let dir = run_dir(base_dir, id);
    let state = match read_status(&dir.join("state.json"))? {
        Some(state) => state,
        None => return Ok(()),
    };
    if matches!(state.state.as_str(), "done" | "failed" | "cancelled") {
        return Ok(());
    }
    // Write terminal state first so a concurrent getStatus cannot race the
    // dead pid into runner_error and swallow budget_exceeded.
    let failed = RunStatus {
        id: id.to_string(),
        state: "failed".into(),
        started_at: state.started_at,
        finished_at: Some(now_ms()),
        failure_reason: Some("budget_exceeded".into()),
        progress: state.progress,
    };
    write_status(&dir, &failed)?;
    if let Some(pid) = read_pid(&dir)? {
        if pid_alive(pid) {
            kill_tree(pid, libc_sigkill());
        }
    }
    Ok(())
}

/// Built-in stub runner: same artifacts as `packages/cloud-runner/src/runners/stub-runner.ts`.
pub fn run_stub(dir: &Path) -> Result<(), String> {
    let spec: RunSpec =
        serde_json::from_slice(&fs::read(dir.join("spec.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let running = RunStatus {
        id: spec.id.clone(),
        state: "running".into(),
        started_at: Some(now_ms()),
        finished_at: None,
        failure_reason: None,
        progress: None,
    };
    write_status(dir, &running).map_err(|e| e.message)?;

    let total = spec.subtasks.len();
    let mut completed = 0usize;
    for subtask in &spec.subtasks {
        let out_dir = dir.join("artifacts").join(&subtask.id);
        fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
        let marker = out_dir.join("done.marker");
        if !marker.exists() {
            std::thread::sleep(Duration::from_millis(30));
            let title = subtask.title.as_deref().unwrap_or(&subtask.id);
            let notes = format!(
                "# {title}\n\n> Stub artifact for run {}.\n\n## Prompt\n\n{}\n",
                spec.id, subtask.prompt
            );
            fs::write(out_dir.join("notes.md"), notes).map_err(|e| e.to_string())?;
            fs::write(&marker, format!("{}\n", now_ms())).map_err(|e| e.to_string())?;
        }
        completed += 1;
        append_event(
            dir,
            &json!({ "type": "progress", "completed": completed, "total": total }),
        )
        .map_err(|e| e.message)?;
    }

    let done = RunStatus {
        id: spec.id.clone(),
        state: "done".into(),
        started_at: running.started_at,
        finished_at: Some(now_ms()),
        failure_reason: None,
        progress: Some(json!({ "completed": total, "total": total })),
    };
    write_status(dir, &done).map_err(|e| e.message)?;
    Ok(())
}

fn validate_run_id(id: &str) -> RundResult<()> {
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err(RundError::invalid_spec(format!(
            "invalid run id: {}",
            serde_json::to_string(id).unwrap_or_else(|_| id.to_string())
        )));
    }
    Ok(())
}

fn run_dir(base_dir: &Path, id: &str) -> PathBuf {
    base_dir.join(id)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn write_pretty<T: Serialize>(path: &Path, value: &T) -> RundResult<()> {
    let body = serde_json::to_string_pretty(value).map_err(|e| RundError::other(e.to_string()))?;
    fs::write(path, body).map_err(|e| RundError::other(e.to_string()))
}

fn write_status(dir: &Path, status: &RunStatus) -> RundResult<()> {
    write_pretty(&dir.join("state.json"), status)?;
    append_event(dir, &json!({ "type": "state", "status": status }))
}

fn append_event(dir: &Path, event: &Value) -> RundResult<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("events.jsonl"))
        .map_err(|e| RundError::other(e.to_string()))?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(event).map_err(|e| RundError::other(e.to_string()))?
    )
    .map_err(|e| RundError::other(e.to_string()))
}

fn read_status(path: &Path) -> RundResult<Option<RunStatus>> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(RundError::other(err.to_string())),
    };
    match serde_json::from_str(&raw) {
        Ok(status) => Ok(Some(status)),
        Err(_) => Ok(None),
    }
}

fn read_pid(dir: &Path) -> RundResult<Option<i32>> {
    let raw = match fs::read_to_string(dir.join("runner.pid")) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(RundError::other(err.to_string())),
    };
    Ok(raw.trim().parse::<i32>().ok().filter(|pid| *pid > 0))
}

fn spawn_runner(command: &[String], dir: &Path) -> RundResult<u32> {
    let mut cmd = Command::new(&command[0]);
    cmd.args(&command[1..])
        .arg("--dir")
        .arg(dir)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
    let child = cmd.spawn().map_err(|e| RundError::other(e.to_string()))?;
    let pid = child.id();
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });
    Ok(pid)
}

fn walk_artifacts(abs: &Path, rel: &Path, out: &mut Vec<ArtifactMeta>) -> RundResult<()> {
    let entries = fs::read_dir(abs).map_err(|e| RundError::other(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| RundError::other(e.to_string()))?;
        let name = entry.file_name();
        let child_rel = if rel.as_os_str().is_empty() {
            PathBuf::from(&name)
        } else {
            rel.join(&name)
        };
        let ft = entry
            .file_type()
            .map_err(|e| RundError::other(e.to_string()))?;
        if ft.is_dir() {
            walk_artifacts(&entry.path(), &child_rel, out)?;
        } else if ft.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(ArtifactMeta {
                path: child_rel.to_string_lossy().replace('\\', "/"),
                size,
            });
        }
    }
    Ok(())
}

fn assert_safe_artifact_path(path: &str) -> RundResult<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.split('/').any(|part| part == "..")
    {
        return Err(RundError::path_traversal(path));
    }
    Ok(())
}

fn pid_alive(pid: i32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

fn kill_tree(pid: i32, signal: i32) {
    #[cfg(unix)]
    {
        unsafe {
            let _ = libc::kill(-pid, signal);
            let _ = libc::kill(pid, signal);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (pid, signal);
    }
}

fn libc_sigterm() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGTERM
    }
    #[cfg(not(unix))]
    {
        15
    }
}

fn libc_sigkill() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGKILL
    }
    #[cfg(not(unix))]
    {
        9
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn spec(id: &str) -> RunSpec {
        RunSpec {
            id: id.into(),
            name: "t".into(),
            subtasks: vec![
                CloudRunSubtask {
                    id: "t1".into(),
                    title: Some("subtask one".into()),
                    prompt: "Research topic A".into(),
                },
                CloudRunSubtask {
                    id: "t2".into(),
                    title: Some("subtask two".into()),
                    prompt: "Research topic B".into(),
                },
            ],
            limits: None,
        }
    }

    /// Local provider always appends `--dir <runDir>`; GNU sleep rejects that flag.
    fn sleep_cmd(secs: &str) -> Vec<String> {
        vec!["bash".into(), "-c".into(), format!("exec sleep {secs}")]
    }

    #[test]
    fn stub_writes_prompt_artifacts_and_done() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        fs::create_dir_all(dir.join("artifacts")).unwrap();
        write_pretty(&dir.join("spec.json"), &spec("run-a")).unwrap();
        run_stub(dir).unwrap();
        let status = read_status(&dir.join("state.json")).unwrap().unwrap();
        assert_eq!(status.state, "done");
        let notes = fs::read_to_string(dir.join("artifacts/t1/notes.md")).unwrap();
        assert!(notes.contains("Research topic A"));
        assert!(dir.join("artifacts/t2/done.marker").exists());
    }

    #[test]
    fn create_is_idempotent_and_rejects_bad_ids() {
        let tmp = tempfile::tempdir().unwrap();
        let s = spec("ok-id");
        let h1 = create_run(tmp.path(), &s, &sleep_cmd("2")).unwrap();
        let h2 = create_run(tmp.path(), &s, &sleep_cmd("2")).unwrap();
        assert_eq!(h1.id, h2.id);
        assert_eq!(h1.provider, "native");
        let bad = RunSpec {
            id: "../x".into(),
            name: "n".into(),
            subtasks: s.subtasks.clone(),
            limits: None,
        };
        assert_eq!(
            create_run(tmp.path(), &bad, &["true".into()])
                .unwrap_err()
                .code,
            "invalid_spec"
        );
        assert_eq!(
            get_status(tmp.path(), "missing").unwrap_err().code,
            "not_found"
        );
        let _ = cancel(tmp.path(), "ok-id");
    }

    #[test]
    fn fetch_rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let s = spec("art");
        fs::create_dir_all(tmp.path().join("art/artifacts")).unwrap();
        write_pretty(&tmp.path().join("art/spec.json"), &s).unwrap();
        run_stub(&tmp.path().join("art")).unwrap();
        assert_eq!(
            fetch_artifact(tmp.path(), "art", "../spec.json")
                .unwrap_err()
                .code,
            "path_traversal"
        );
        assert_eq!(
            fetch_artifact(tmp.path(), "art", "/etc/passwd")
                .unwrap_err()
                .code,
            "path_traversal"
        );
        let bytes = fetch_artifact(tmp.path(), "art", "t1/notes.md").unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("Research topic A"));
        let listed = list_artifacts(tmp.path(), "art").unwrap();
        assert!(listed.iter().any(|a| a.path.ends_with(".md")));
    }

    #[test]
    fn kill_of_runner_pid_reconciles_runner_error() {
        let tmp = tempfile::tempdir().unwrap();
        let s = RunSpec {
            id: "crash".into(),
            name: "c".into(),
            subtasks: vec![CloudRunSubtask {
                id: "t1".into(),
                title: None,
                prompt: "p".into(),
            }],
            limits: None,
        };
        create_run(tmp.path(), &s, &sleep_cmd("120")).unwrap();
        let pid: i32 = fs::read_to_string(tmp.path().join("crash/runner.pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(pid_alive(pid));
        kill_tree(pid, libc_sigkill());
        thread::sleep(Duration::from_millis(50));
        let status = get_status(tmp.path(), "crash").unwrap();
        assert_eq!(status.state, "failed");
        assert_eq!(status.failure_reason.as_deref(), Some("runner_error"));
    }

    #[test]
    fn cancel_kills_nested_child() {
        let tmp = tempfile::tempdir().unwrap();
        let s = RunSpec {
            id: "tree".into(),
            name: "t".into(),
            subtasks: vec![CloudRunSubtask {
                id: "t1".into(),
                title: None,
                prompt: "p".into(),
            }],
            limits: None,
        };
        create_run(
            tmp.path(),
            &s,
            &[
                "bash".into(),
                "-c".into(),
                "sleep 120 & echo $! > \"$1/nested.pid\"; wait".into(),
            ],
        )
        .unwrap();
        let nested_path = tmp.path().join("tree/nested.pid");
        let deadline = now_ms() + 2_000;
        while !nested_path.exists() && now_ms() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let nested: i32 = fs::read_to_string(&nested_path)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(pid_alive(nested));
        cancel(tmp.path(), "tree").unwrap();
        kill_pid_tree(
            fs::read_to_string(tmp.path().join("tree/runner.pid"))
                .unwrap()
                .trim()
                .parse()
                .unwrap(),
            true,
        );
        let gone_by = now_ms() + 2_000;
        while pid_alive(nested) && now_ms() < gone_by {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!pid_alive(nested));
        let status = get_status(tmp.path(), "tree").unwrap();
        assert_eq!(status.state, "cancelled");
    }

    #[test]
    fn wall_clock_budget_marks_budget_exceeded() {
        let tmp = tempfile::tempdir().unwrap();
        let s = RunSpec {
            id: "budget".into(),
            name: "b".into(),
            subtasks: vec![CloudRunSubtask {
                id: "t1".into(),
                title: None,
                prompt: "p".into(),
            }],
            limits: Some(RunLimits {
                max_wall_clock_sec: Some(1),
            }),
        };
        create_run(tmp.path(), &s, &sleep_cmd("120")).unwrap();
        let pid: i32 = fs::read_to_string(tmp.path().join("budget/runner.pid"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(pid_alive(pid));
        thread::sleep(Duration::from_millis(1_050));
        enforce_clock_budget(tmp.path(), "budget").unwrap();
        let status = get_status(tmp.path(), "budget").unwrap();
        assert_eq!(status.state, "failed");
        assert_eq!(status.failure_reason.as_deref(), Some("budget_exceeded"));
    }
}
