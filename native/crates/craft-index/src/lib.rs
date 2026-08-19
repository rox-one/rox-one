//! Source-index module. Walk/hash match TypeScript; file/byte caps are lifted
//! (20k / 256MB vs TS 2000 / 32MB). Database:
//! `{workspace}/.craft/source-index.native.sqlite` — never the bun:sqlite file.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const TEXT_EXTS: &[&str] = &[
    "md", "mdx", "txt", "json", "jsonl", "yaml", "yml", "ts", "tsx", "js", "jsx", "mjs", "cjs",
    "py", "rs", "go", "java", "kt", "swift", "css", "html", "xml", "csv", "toml", "ini", "sh",
    "bash", "zsh", "sql",
];

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".craft",
    ".svn",
    ".hg",
    "dist",
    "build",
    ".next",
    "coverage",
    "__pycache__",
];

/// N-03 gate: no truncate at 20k files. TS `source-index.ts` stays at 2000/32MB.
const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_BODY_CHARS: usize = 200_000;
const SOURCE_RETRIEVE_MAX_TOKENS: usize = 2000;
const SOURCE_RETRIEVE_DEFAULT_LIMIT: usize = 5;
const SOURCE_RETRIEVE_MAX_EXCERPT_CHARS: usize = 4_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRoot {
    pub slug: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexResult {
    pub indexed: usize,
    pub skipped: usize,
    pub truncated: bool,
    pub db_path: String,
    pub fts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub path: String,
    pub chars: i64,
    pub tokens: i64,
    pub mtime: i64,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub total: usize,
    pub fts: bool,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrieveHit {
    pub path: String,
    pub excerpt: String,
    pub rank: f64,
    pub tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveResult {
    pub hits: Vec<RetrieveHit>,
    pub total_tokens: usize,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub db_path: String,
    pub fts: bool,
    pub indexed: usize,
}

struct WalkedFile {
    rel_path: String,
    mtime: i64,
    body: String,
}

struct WalkOutcome {
    files: Vec<WalkedFile>,
    truncated: bool,
    skipped: usize,
}

pub fn native_db_path(workspace: &Path) -> PathBuf {
    workspace.join(".craft").join("source-index.native.sqlite")
}

pub fn hash_text(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(32);
    for &byte in digest.iter().take(16) {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        0
    } else {
        text.len().div_ceil(4)
    }
}

fn is_probably_text(path: &Path, size: u64) -> bool {
    if size == 0 || size > MAX_FILE_BYTES {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if TEXT_EXTS.contains(&ext.as_str()) {
        return true;
    }
    if ext.is_empty() && size < 64 * 1024 {
        return true;
    }
    false
}

fn walk_source_tree(root: &Path) -> WalkOutcome {
    let mut files = Vec::new();
    let mut truncated = false;
    let mut skipped = 0usize;
    let mut total_bytes = 0u64;
    if !root.exists() {
        return WalkOutcome {
            files,
            truncated,
            skipped,
        };
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') && name_str != ".env.example" {
                // Match TS: comment says skip hidden, but there is no `continue`.
            }
            if SKIP_DIRS.contains(&name_str.as_ref()) {
                continue;
            }
            let full = entry.path();
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if file_type.is_dir() {
                stack.push(full);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if files.len() >= MAX_FILES {
                truncated = true;
                return WalkOutcome {
                    files,
                    truncated,
                    skipped,
                };
            }
            let meta = match fs::metadata(&full) {
                Ok(m) => m,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if !is_probably_text(&full, meta.len()) {
                skipped += 1;
                continue;
            }
            total_bytes += meta.len();
            if total_bytes > MAX_TOTAL_BYTES {
                truncated = true;
                return WalkOutcome {
                    files,
                    truncated,
                    skipped,
                };
            }
            let raw = match fs::read_to_string(&full) {
                Ok(s) => s,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let body: String = raw.chars().take(MAX_BODY_CHARS).collect();
            let rel = full
                .strip_prefix(root)
                .unwrap_or(&full)
                .to_string_lossy()
                .replace('\\', "/");
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            files.push(WalkedFile {
                rel_path: rel,
                mtime,
                body,
            });
        }
    }
    WalkOutcome {
        files,
        truncated,
        skipped,
    }
}

fn open_db(workspace: &Path) -> Result<(Connection, PathBuf, bool), String> {
    let db_path = native_db_path(workspace);
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode = WAL")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY NOT NULL,
            hash TEXT NOT NULL,
            chars INTEGER NOT NULL DEFAULT 0,
            tokens INTEGER NOT NULL DEFAULT 0,
            mtime INTEGER NOT NULL DEFAULT 0,
            body_text TEXT NOT NULL DEFAULT ''
        )",
    )
    .map_err(|e| e.to_string())?;
    let fts = conn
        .execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                path UNINDEXED,
                body_text,
                content='files',
                content_rowid='rowid'
            );
            CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
              INSERT INTO files_fts(rowid, path, body_text) VALUES (new.rowid, new.path, new.body_text);
            END;
            CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
              INSERT INTO files_fts(files_fts, rowid, path, body_text) VALUES('delete', old.rowid, old.path, old.body_text);
            END;
            CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
              INSERT INTO files_fts(files_fts, rowid, path, body_text) VALUES('delete', old.rowid, old.path, old.body_text);
              INSERT INTO files_fts(rowid, path, body_text) VALUES (new.rowid, new.path, new.body_text);
            END;",
        )
        .is_ok();
    Ok((conn, db_path, fts))
}

fn index_tree(
    conn: &Connection,
    root: &Path,
    slug: &str,
    clear_source: bool,
) -> Result<(usize, usize, bool), String> {
    if clear_source {
        conn.execute(
            "DELETE FROM files WHERE path = ?1 OR path LIKE ?2",
            params![slug, format!("{slug}/%")],
        )
        .map_err(|e| e.to_string())?;
    }
    let walked = walk_source_tree(root);
    let prefix = if slug.is_empty() {
        String::new()
    } else {
        format!("{slug}/")
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO files (path, hash, chars, tokens, mtime, body_text)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(path) DO UPDATE SET
                   hash = excluded.hash,
                   chars = excluded.chars,
                   tokens = excluded.tokens,
                   mtime = excluded.mtime,
                   body_text = excluded.body_text",
            )
            .map_err(|e| e.to_string())?;
        for file in &walked.files {
            let path = format!("{}{}", prefix, file.rel_path);
            let hash = hash_text(&file.body);
            let chars = file.body.chars().count() as i64;
            let tokens = estimate_tokens(&file.body) as i64;
            stmt.execute(params![path, hash, chars, tokens, file.mtime, file.body])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok((walked.files.len(), walked.skipped, walked.truncated))
}

pub fn reindex_workspace(workspace: &Path, roots: &[SourceRoot]) -> Result<ReindexResult, String> {
    let (conn, db_path, fts) = open_db(workspace)?;
    conn.execute("DELETE FROM files", [])
        .map_err(|e| e.to_string())?;
    if fts {
        let _ = conn.execute_batch("INSERT INTO files_fts(files_fts) VALUES('rebuild')");
    }
    let mut indexed = 0usize;
    let mut skipped = 0usize;
    let mut truncated = false;
    for root in roots {
        let (i, s, t) = index_tree(&conn, Path::new(&root.path), &root.slug, false)?;
        indexed += i;
        skipped += s;
        truncated = truncated || t;
    }
    Ok(ReindexResult {
        indexed,
        skipped,
        truncated,
        db_path: db_path.to_string_lossy().into_owned(),
        fts,
    })
}

fn tokenize(query: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut seen = HashSet::new();
    let mut current = String::new();
    let flush = |current: &mut String, terms: &mut Vec<String>, seen: &mut HashSet<String>| {
        if current.is_empty() {
            return;
        }
        let folded = current.to_lowercase();
        if seen.insert(folded) {
            terms.push(std::mem::take(current));
        } else {
            current.clear();
        }
    };
    for c in query.chars() {
        if c.is_alphanumeric() || c == '_' {
            current.push(c);
        } else {
            flush(&mut current, &mut terms, &mut seen);
            if terms.len() >= 24 {
                break;
            }
        }
    }
    if terms.len() < 24 {
        flush(&mut current, &mut terms, &mut seen);
    }
    terms
}

fn build_match_query(query: &str) -> String {
    tokenize(query)
        .into_iter()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn snippet_for(body: &str, query: &str, max_len: usize) -> String {
    let q = query.trim().to_lowercase();
    if body.is_empty() {
        return String::new();
    }
    let lower = body.to_lowercase();
    let mut idx: Option<usize> = None;
    for token in q.split_whitespace() {
        if let Some(found) = lower.find(token) {
            idx = Some(found);
            break;
        }
    }
    match idx {
        None => body
            .chars()
            .take(max_len)
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
        Some(i) => {
            let start = i.saturating_sub(40);
            let slice: String = body.chars().skip(start).take(max_len).collect();
            let collapsed = slice.split_whitespace().collect::<Vec<_>>().join(" ");
            let prefix = if start > 0 { "…" } else { "" };
            let suffix = if start + max_len < body.len() {
                "…"
            } else {
                ""
            };
            format!("{prefix}{collapsed}{suffix}")
        }
    }
}

pub fn search(workspace: &Path, query: &str, limit: Option<u32>) -> Result<SearchResult, String> {
    let q = query.trim();
    let empty = SearchResult {
        hits: vec![],
        total: 0,
        fts: false,
        query: q.to_string(),
    };
    if q.is_empty() {
        return Ok(empty);
    }
    let db_path = native_db_path(workspace);
    if !db_path.exists() {
        return Ok(empty);
    }
    let (conn, _, fts) = open_db(workspace)?;
    let limit = limit.unwrap_or(20).clamp(1, 100) as i64;
    if fts {
        let match_q = build_match_query(q);
        if match_q.is_empty() {
            return Ok(empty);
        }
        let mut stmt = conn
            .prepare(
                "SELECT f.path, f.chars, f.tokens, f.mtime, f.body_text, files_fts.rank AS rank
                 FROM files_fts
                 JOIN files f ON f.rowid = files_fts.rowid
                 WHERE files_fts MATCH ?1
                 ORDER BY rank
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let hits: Result<Vec<_>, _> = stmt
            .query_map(params![match_q, limit], |row| {
                let path: String = row.get(0)?;
                let chars: i64 = row.get(1)?;
                let tokens: i64 = row.get(2)?;
                let mtime: i64 = row.get(3)?;
                let body: String = row.get(4)?;
                let rank: f64 = row.get(5)?;
                Ok(SearchHit {
                    path,
                    chars,
                    tokens,
                    mtime,
                    snippet: snippet_for(&body, q, 160),
                    rank,
                })
            })
            .map_err(|e| e.to_string())?
            .collect();
        let hits = hits.map_err(|e| e.to_string())?;
        let total = hits.len();
        return Ok(SearchResult {
            hits,
            total,
            fts: true,
            query: q.to_string(),
        });
    }
    let tokens = tokenize(q).into_iter().take(8).collect::<Vec<_>>();
    if tokens.is_empty() {
        return Ok(empty);
    }
    let clauses: Vec<String> = tokens
        .iter()
        .map(|_| "(path LIKE ? OR body_text LIKE ?)".to_string())
        .collect();
    let sql = format!(
        "SELECT path, chars, tokens, mtime, body_text FROM files WHERE {} LIMIT ?",
        clauses.join(" AND ")
    );
    let mut values: Vec<String> = Vec::new();
    for t in &tokens {
        let like = format!("%{}%", t.replace(['%', '_'], ""));
        values.push(like.clone());
        values.push(like);
    }
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params_vec: Vec<&dyn rusqlite::types::ToSql> = values
        .iter()
        .map(|v| v as &dyn rusqlite::types::ToSql)
        .collect();
    params_vec.push(&limit);
    let hits: Result<Vec<_>, _> = stmt
        .query_map(params_vec.as_slice(), |row| {
            let path: String = row.get(0)?;
            let chars: i64 = row.get(1)?;
            let tokens: i64 = row.get(2)?;
            let mtime: i64 = row.get(3)?;
            let body: String = row.get(4)?;
            Ok((path, chars, tokens, mtime, body))
        })
        .map_err(|e| e.to_string())?
        .collect();
    let hits = hits
        .map_err(|e| e.to_string())?
        .into_iter()
        .enumerate()
        .map(|(i, (path, chars, tokens, mtime, body))| SearchHit {
            path,
            chars,
            tokens,
            mtime,
            snippet: snippet_for(&body, q, 160),
            rank: i as f64,
        })
        .collect::<Vec<_>>();
    let total = hits.len();
    Ok(SearchResult {
        hits,
        total,
        fts: false,
        query: q.to_string(),
    })
}

pub fn retrieve(
    workspace: &Path,
    query: &str,
    limit: Option<u32>,
    max_tokens: Option<u32>,
) -> Result<RetrieveResult, String> {
    let q = query.trim();
    let empty = RetrieveResult {
        hits: vec![],
        total_tokens: 0,
        query: q.to_string(),
    };
    if q.is_empty() {
        return Ok(empty);
    }
    let search = search(
        workspace,
        q,
        Some(
            limit
                .unwrap_or(SOURCE_RETRIEVE_DEFAULT_LIMIT as u32)
                .min(20),
        ),
    )?;
    if search.hits.is_empty() {
        return Ok(empty);
    }
    let max_tokens = max_tokens
        .map(|n| n.max(1) as usize)
        .unwrap_or(SOURCE_RETRIEVE_MAX_TOKENS);
    let mut hits = Vec::new();
    let mut total_tokens = 0usize;
    let (conn, _, _) = open_db(workspace)?;
    for hit in &search.hits {
        let body: String = conn
            .query_row(
                "SELECT body_text FROM files WHERE path = ?1",
                params![hit.path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or_default();
        let raw = {
            let excerpt = snippet_for(&body, q, SOURCE_RETRIEVE_MAX_EXCERPT_CHARS);
            let from_body = excerpt.trim();
            if !from_body.is_empty() {
                from_body.to_string()
            } else {
                hit.snippet.trim().to_string()
            }
        };
        if raw.is_empty() {
            continue;
        }
        let header = format!("### {}\n", hit.path);
        let header_tokens = estimate_tokens(&header);
        let remaining = max_tokens
            .saturating_sub(total_tokens)
            .saturating_sub(header_tokens);
        if remaining == 0 {
            break;
        }
        let mut excerpt = raw.clone();
        let mut excerpt_tokens = estimate_tokens(&excerpt);
        if excerpt_tokens > remaining {
            let body_budget = remaining.saturating_sub(1);
            let char_budget = body_budget * 4;
            if char_budget < 24 {
                if !hits.is_empty() {
                    break;
                }
                excerpt = format!("{}…", raw.chars().take(80).collect::<String>().trim_end());
                excerpt_tokens = estimate_tokens(&excerpt);
            } else {
                excerpt = format!(
                    "{}…",
                    raw.chars().take(char_budget).collect::<String>().trim_end()
                );
                excerpt_tokens = estimate_tokens(&excerpt);
                while excerpt_tokens > remaining && excerpt.len() > 4 {
                    let trimmed: String = excerpt
                        .chars()
                        .take(excerpt.len().saturating_sub(8))
                        .collect();
                    excerpt = format!("{}…", trimmed.trim_end());
                    excerpt_tokens = estimate_tokens(&excerpt);
                }
            }
            if excerpt_tokens == 0 {
                break;
            }
        }
        let cost = header_tokens + excerpt_tokens;
        if total_tokens + cost > max_tokens && !hits.is_empty() {
            break;
        }
        hits.push(RetrieveHit {
            path: hit.path.clone(),
            excerpt,
            rank: hit.rank,
            tokens: cost,
        });
        total_tokens = (total_tokens + cost).min(max_tokens);
        if total_tokens >= max_tokens {
            break;
        }
    }
    Ok(RetrieveResult {
        hits,
        total_tokens,
        query: q.to_string(),
    })
}

pub fn count_indexed(workspace: &Path) -> Result<usize, String> {
    let db_path = native_db_path(workspace);
    if !db_path.exists() {
        return Ok(0);
    }
    let (conn, _, _) = open_db(workspace)?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(n as usize)
}

pub fn status(workspace: &Path) -> Result<IndexStatus, String> {
    let db_path = native_db_path(workspace);
    if !db_path.exists() {
        return Ok(IndexStatus {
            db_path: db_path.to_string_lossy().into_owned(),
            fts: false,
            indexed: 0,
        });
    }
    let (conn, db_path, fts) = open_db(workspace)?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(IndexStatus {
        db_path: db_path.to_string_lossy().into_owned(),
        fts,
        indexed: n as usize,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn hash_is_sha256_prefix_32_hex() {
        assert_eq!(hash_text("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e");
    }

    fn write_md_tree(root: &Path, n: usize) {
        for i in 0..n {
            let bucket = root.join(format!("b{}", i / 100));
            fs::create_dir_all(&bucket).unwrap();
            fs::write(bucket.join(format!("f{i}.md")), format!("doc {i} fox")).unwrap();
        }
    }

    #[test]
    fn walk_does_not_truncate_at_2500_files() {
        let dir = tempfile::tempdir().unwrap();
        write_md_tree(dir.path(), 2500);
        let walked = walk_source_tree(dir.path());
        assert_eq!(walked.files.len(), 2500);
        assert!(!walked.truncated);
    }

    #[test]
    fn walk_does_not_truncate_at_20000_files() {
        let dir = tempfile::tempdir().unwrap();
        write_md_tree(dir.path(), 20_000);
        let walked = walk_source_tree(dir.path());
        assert_eq!(walked.files.len(), 20_000);
        assert!(!walked.truncated);
    }

    #[test]
    fn walk_skips_node_modules() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("readme.md"), "# Hello craft sources index").unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::write(dir.path().join("node_modules/pkg/x.md"), "skip me").unwrap();
        fs::create_dir_all(dir.path().join("docs")).unwrap();
        fs::write(dir.path().join("docs/guide.txt"), "keyword alpha beta").unwrap();
        let walked = walk_source_tree(dir.path());
        let mut rels: Vec<_> = walked.files.iter().map(|f| f.rel_path.as_str()).collect();
        rels.sort();
        assert_eq!(rels, vec!["docs/guide.txt", "readme.md"]);
        assert!(!walked.truncated);
    }

    #[test]
    fn reindex_and_search_unique_keyword() {
        let workspace = tempfile::tempdir().unwrap();
        let folder = workspace.path().join("docs");
        fs::create_dir_all(&folder).unwrap();
        let mut f = fs::File::create(folder.join("alpha.md")).unwrap();
        writeln!(f, "The quick brown fox jumps over craft agents").unwrap();
        let result = reindex_workspace(
            workspace.path(),
            &[SourceRoot {
                slug: "docs".into(),
                path: folder.to_string_lossy().into_owned(),
            }],
        )
        .unwrap();
        assert_eq!(result.indexed, 1);
        assert!(result.fts);
        assert!(native_db_path(workspace.path()).ends_with("source-index.native.sqlite"));
        let search = search(workspace.path(), "fox", Some(5)).unwrap();
        assert!(search.hits.iter().any(|h| h.path.contains("docs/alpha.md")));
        assert!(search.hits[0].snippet.to_lowercase().contains("fox"));
        assert_eq!(count_indexed(workspace.path()).unwrap(), 1);
    }
}
