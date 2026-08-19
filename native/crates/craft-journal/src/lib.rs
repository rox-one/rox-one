//! Session JSONL journal.
//!
//! Shadow (`write_journal`) writes `{sessionDir}/session.native.jsonl` only.
//! Primary (`write_primary_journal`) writes `{sessionDir}/session.jsonl`
//! behind CRAFT_FEATURE_NATIVE_JOURNAL_PRIMARY. Same atomic tmp+rename.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const NATIVE_JOURNAL_FILE: &str = "session.native.jsonl";
pub const PRIMARY_JOURNAL_FILE: &str = "session.jsonl";

#[derive(Debug, Clone)]
pub struct JournalError {
    pub code: &'static str,
    pub message: String,
}

impl JournalError {
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

pub type JournalResult<T> = Result<T, JournalError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalStatus {
    pub path: String,
    pub exists: bool,
    pub valid: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalRead {
    pub path: String,
    pub lines: Vec<Value>,
    pub skipped: usize,
}

pub fn native_journal_path(session_dir: &Path) -> PathBuf {
    session_dir.join(NATIVE_JOURNAL_FILE)
}

pub fn primary_journal_path(session_dir: &Path) -> PathBuf {
    session_dir.join(PRIMARY_JOURNAL_FILE)
}

fn atomic_write_lines(path: &Path, lines: &[String]) -> JournalResult<()> {
    let mut body = lines.join("\n");
    if !body.ends_with('\n') {
        body.push('\n');
    }
    let tmp = PathBuf::from(format!("{}.tmp", path.display()));
    fs::write(&tmp, body).map_err(|e| JournalError::io(e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| JournalError::io(e.to_string()))?;
    Ok(())
}

pub fn write_journal(session_dir: &Path, lines: &[String]) -> JournalResult<JournalStatus> {
    validate_session_dir(session_dir)?;
    fs::create_dir_all(session_dir).map_err(|e| JournalError::io(e.to_string()))?;
    atomic_write_lines(&native_journal_path(session_dir), lines)?;
    read_status(session_dir)
}

pub fn write_primary_journal(session_dir: &Path, lines: &[String]) -> JournalResult<JournalStatus> {
    validate_session_dir(session_dir)?;
    fs::create_dir_all(session_dir).map_err(|e| JournalError::io(e.to_string()))?;
    atomic_write_lines(&primary_journal_path(session_dir), lines)?;
    let path = primary_journal_path(session_dir);
    let parsed = parse_file(&path)?;
    Ok(JournalStatus {
        path: path.to_string_lossy().into_owned(),
        exists: true,
        valid: parsed.lines.len(),
        skipped: parsed.skipped,
    })
}

pub fn read_journal(session_dir: &Path) -> JournalResult<JournalRead> {
    validate_session_dir(session_dir)?;
    let path = native_journal_path(session_dir);
    let parsed = parse_file(&path)?;
    Ok(JournalRead {
        path: path.to_string_lossy().into_owned(),
        lines: parsed.lines,
        skipped: parsed.skipped,
    })
}

pub fn read_status(session_dir: &Path) -> JournalResult<JournalStatus> {
    validate_session_dir(session_dir)?;
    let path = native_journal_path(session_dir);
    if !path.exists() {
        return Ok(JournalStatus {
            path: path.to_string_lossy().into_owned(),
            exists: false,
            valid: 0,
            skipped: 0,
        });
    }
    let parsed = parse_file(&path)?;
    Ok(JournalStatus {
        path: path.to_string_lossy().into_owned(),
        exists: true,
        valid: parsed.lines.len(),
        skipped: parsed.skipped,
    })
}

struct Parsed {
    lines: Vec<Value>,
    skipped: usize,
}

fn parse_file(path: &Path) -> JournalResult<Parsed> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Parsed {
                lines: Vec::new(),
                skipped: 0,
            });
        }
        Err(err) => return Err(JournalError::io(err.to_string())),
    };
    let mut lines = Vec::new();
    let mut skipped = 0usize;
    for line in raw.split('\n') {
        if line.is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(line) {
            Ok(value) => lines.push(value),
            Err(_) => skipped += 1,
        }
    }
    Ok(Parsed { lines, skipped })
}

fn validate_session_dir(session_dir: &Path) -> JournalResult<()> {
    if session_dir.as_os_str().is_empty() {
        return Err(JournalError::invalid("sessionDir is empty"));
    }
    if session_dir
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(JournalError::invalid(format!(
            "sessionDir must not contain '..': {}",
            session_dir.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn lines(n: usize) -> Vec<String> {
        (0..n)
            .map(|i| format!(r#"{{"id":"m{i}","type":"user","content":"c{i}"}}"#))
            .collect()
    }

    #[test]
    fn write_primary_uses_session_jsonl() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_primary_journal(dir, &lines(2)).unwrap();
        assert!(primary_journal_path(dir).exists());
        assert!(!native_journal_path(dir).exists());
        let status = write_primary_journal(dir, &lines(1)).unwrap();
        assert!(status.path.ends_with(PRIMARY_JOURNAL_FILE));
        assert_eq!(status.valid, 1);
    }

    #[test]
    fn write_uses_native_filename_not_session_jsonl() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_journal(dir, &lines(2)).unwrap();
        assert!(native_journal_path(dir).exists());
        assert!(!dir.join("session.jsonl").exists());
        let status = read_status(dir).unwrap();
        assert!(status.exists);
        assert_eq!(status.valid, 2);
        assert_eq!(status.skipped, 0);
        assert!(status.path.ends_with(NATIVE_JOURNAL_FILE));
    }

    #[test]
    fn read_skips_truncated_last_line() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_journal(dir, &lines(2)).unwrap();
        let path = native_journal_path(dir);
        let mut body = fs::read_to_string(&path).unwrap();
        body.push_str("{\"id\":\"m2\",\"type\":\"user\",\"content\":\"cut");
        fs::write(&path, body).unwrap();
        let read = read_journal(dir).unwrap();
        assert_eq!(read.lines.len(), 2);
        assert_eq!(read.skipped, 1);
        assert_eq!(read.lines[0]["id"], "m0");
        assert_eq!(read.lines[1]["id"], "m1");
    }

    #[test]
    fn rejects_parent_dir_components() {
        let err = write_journal(Path::new("/tmp/foo/../bar"), &lines(1)).unwrap_err();
        assert_eq!(err.code, "invalid_spec");
    }
}
