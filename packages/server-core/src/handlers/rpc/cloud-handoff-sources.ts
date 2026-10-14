/**
 * Local file collection for cloud handoff: the session folder (messages,
 * attachments, plans, …) plus workspace files the conversation references.
 * Symlinks are never followed; references must stay inside the working dir.
 */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { SnapshotSource } from '@rox/cloud-runner';

const MAX_WALK_ENTRIES = 10_000;
const MAX_REFERENCES = 500;

function toPosix(rel: string): string {
  return rel.split(sep).join('/');
}

/** Inside `root` (already realpath'd)? Handles '..foo' names and cross-drive absolute results. */
export function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

function fileSource(abs: string, dest: string, size: number, root?: string): SnapshotSource {
  return {
    path: dest,
    size,
    read: async () => {
      // Re-validate at read time (TOCTOU): still a regular file, not a symlink,
      // and — for workspace files — still resolving inside the working dir.
      const st = await lstat(abs);
      if (!st.isFile()) throw new Error('file changed during handoff');
      if (root && !isContained(root, await realpath(abs))) throw new Error('file escaped the working directory');
      return new Uint8Array(await readFile(abs));
    },
  };
}

/** Desktop-only share capabilities that must never leave this machine. */
export const HANDOFF_STRIPPED_HEADER_FIELDS = ['sharedOwnerKey', 'sharedUrl', 'sharedId'] as const;

/** Drop share capabilities from the transcript header line; other lines untouched. */
export function stripShareFieldsFromTranscript(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  let header: unknown;
  try {
    header = JSON.parse(first);
  } catch {
    throw new Error('session.jsonl header is not valid JSON');
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('session.jsonl header is not an object');
  const h = header as Record<string, unknown>;
  if (!HANDOFF_STRIPPED_HEADER_FIELDS.some((f) => f in h)) return bytes;
  for (const f of HANDOFF_STRIPPED_HEADER_FIELDS) delete h[f];
  return new TextEncoder().encode(JSON.stringify(h) + (nl === -1 ? '' : text.slice(nl)));
}

function transcriptSource(abs: string, dest: string, size: number): SnapshotSource {
  const inner = fileSource(abs, dest, size);
  return { ...inner, read: async () => stripShareFieldsFromTranscript(await inner.read()) };
}

async function walk(root: string, prefix: string, out: SnapshotSource[]): Promise<void> {
  const stack = [root];
  let seen = 0;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if ((seen += 1) > MAX_WALK_ENTRIES) return;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        const st = await lstat(abs).catch(() => null);
        if (!st?.isFile()) continue;
        const dest = `${prefix}/${toPosix(relative(root, abs))}`;
        out.push(dest === 'session/session.jsonl' ? transcriptSource(abs, dest, st.size) : fileSource(abs, dest, st.size));
      }
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Absolute paths inside `workingDirectory` mentioned in the transcript. */
export function extractReferencedPaths(transcript: string, workingDirectory: string): string[] {
  const base = workingDirectory.replace(/[\\/]+$/, '');
  if (!base) return [];
  // JSONL escapes backslashes; match both raw and JSON-escaped separators.
  const re = new RegExp(`${escapeRegExp(base)}(?:/|\\\\\\\\|\\\\)[^\\s"'\`<>|*?]+`, 'g');
  const found = new Set<string>();
  for (const match of transcript.matchAll(re)) {
    const cleaned = match[0].replace(/\\\\/g, '\\').replace(/[),.;:\]}]+$/, '');
    found.add(cleaned);
    if (found.size >= MAX_REFERENCES) break;
  }
  return [...found];
}

export async function collectHandoffSources(input: {
  sessionDir: string;
  workingDirectory?: string;
}): Promise<SnapshotSource[]> {
  const out: SnapshotSource[] = [];
  await walk(input.sessionDir, 'session', out);
  const wd = input.workingDirectory;
  if (!wd || wd === 'none' || wd === 'user_default') return out;
  let realWd: string;
  try {
    realWd = await realpath(wd);
  } catch {
    return out;
  }
  let transcript = '';
  try {
    transcript = await readFile(join(input.sessionDir, 'session.jsonl'), 'utf8');
  } catch {
    return out;
  }
  for (const candidate of extractReferencedPaths(transcript, wd)) {
    try {
      const st = await lstat(candidate);
      if (!st.isFile()) continue;
      const real = await realpath(candidate);
      if (!isContained(realWd, real)) continue;
      out.push(fileSource(real, `workspace/${toPosix(relative(realWd, real))}`, st.size, realWd));
    } catch {
      // Referenced file no longer exists — skip.
    }
  }
  return out;
}
