/**
 * Session snapshot packaging for cloud handoff.
 *
 * Streams files one at a time (never the whole bundle in memory), enforces
 * size/count limits, and drops anything that looks like a credential —
 * by path and by content — so secrets never leave the machine.
 */
import { createHash } from 'node:crypto';
import { HandoffError, type HandoffLimits } from './types.ts';

export interface SnapshotSource {
  /** Destination path inside the bundle, POSIX, relative (e.g. `session/session.jsonl`). */
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export type ExclusionReason = 'secret_path' | 'secret_content' | 'unsafe_path' | 'file_too_large' | 'ignored_dir';

export interface SnapshotFile {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface SnapshotManifest {
  version: 1;
  handoffId: string;
  sessionId: string;
  createdAt: string;
  files: { path: string; size: number; sha256: string }[];
  excluded: { path: string; reason: ExclusionReason }[];
}

const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[^/]*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|gpg|asc)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(^|\/)\.(npmrc|netrc|pypirc|git-credentials|pgpass)$/i,
  /(^|\/)(credentials|secrets?|service[-_]?account)[^/]*\.(json|ya?ml|toml|ini)$/i,
  /(^|\/)cloud-runs\.env$/i,
  /(^|\/)credentials\.enc$/i,
];

const IGNORED_DIRS = /(^|\/)(\.git|node_modules|\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.config\/gcloud)(\/|$)/i;

const SECRET_CONTENT_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\bdtn_[A-Za-z0-9]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

/** Content scan window: secrets are looked for in the first 2 MiB of text-like files. */
const SCAN_BYTES = 2 * 1024 * 1024;

export function normalizeSnapshotPath(raw: string): string | null {
  if (!raw || raw.includes('\0') || raw.includes('\\')) return null;
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null;
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

export function secretPathReason(path: string): ExclusionReason | null {
  if (IGNORED_DIRS.test(path)) return 'ignored_dir';
  if (SECRET_PATH_PATTERNS.some((re) => re.test(path))) return 'secret_path';
  return null;
}

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.byteLength, 8192);
  for (let i = 0; i < n; i += 1) if (bytes[i] === 0) return true;
  return false;
}

export function containsSecret(bytes: Uint8Array, extraSecrets: readonly string[] = []): boolean {
  if (looksBinary(bytes)) return false;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, SCAN_BYTES));
  if (SECRET_CONTENT_PATTERNS.some((re) => re.test(text))) return true;
  return extraSecrets.some((s) => s.length >= 8 && text.includes(s));
}

/**
 * Yield the files to upload, in order, collecting exclusions into `excluded`.
 * Throws `too_large` when the kept set exceeds count/total limits — partial
 * handoffs are worse than a clear refusal.
 */
export async function* packSnapshot(
  sources: readonly SnapshotSource[],
  limits: Pick<HandoffLimits, 'maxFileBytes' | 'maxTotalBytes' | 'maxFiles'>,
  excluded: SnapshotManifest['excluded'],
  options: { knownSecrets?: readonly string[]; signal?: AbortSignal } = {},
): AsyncGenerator<SnapshotFile> {
  const seen = new Set<string>();
  const plan: { path: string; source: SnapshotSource }[] = [];
  let total = 0;
  for (const source of sources) {
    const path = normalizeSnapshotPath(source.path);
    if (!path) {
      excluded.push({ path: source.path, reason: 'unsafe_path' });
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    const reason = secretPathReason(path);
    if (reason) {
      excluded.push({ path, reason });
      continue;
    }
    if (source.size > limits.maxFileBytes) {
      excluded.push({ path, reason: 'file_too_large' });
      continue;
    }
    total += source.size;
    plan.push({ path, source });
  }
  if (plan.length > limits.maxFiles) {
    throw new HandoffError('too_large', `session has ${plan.length} files (limit ${limits.maxFiles})`);
  }
  if (total > limits.maxTotalBytes) {
    throw new HandoffError('too_large', `session is ${total} bytes (limit ${limits.maxTotalBytes})`);
  }
  let actualTotal = 0;
  for (const { path, source } of plan) {
    if (options.signal?.aborted) throw new HandoffError('cancelled', 'handoff cancelled');
    const bytes = await source.read();
    // Size is re-checked on the real bytes: the stat may be stale or lie.
    if (bytes.byteLength > limits.maxFileBytes) {
      excluded.push({ path, reason: 'file_too_large' });
      continue;
    }
    actualTotal += bytes.byteLength;
    if (actualTotal > limits.maxTotalBytes) {
      throw new HandoffError('too_large', `session exceeds ${limits.maxTotalBytes} bytes`);
    }
    if (containsSecret(bytes, options.knownSecrets)) {
      excluded.push({ path, reason: 'secret_content' });
      continue;
    }
    yield { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
}
