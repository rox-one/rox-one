/**
 * Local file collection for cloud handoff: the session folder (messages,
 * attachments, plans, …) plus workspace files the conversation references.
 * Symlinks are never followed; references must stay inside the working dir.
 */
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { SnapshotSource } from '@rox/cloud-runner';

const MAX_WALK_ENTRIES = 10_000;
const MAX_REFERENCES = 500;

function toPosix(rel: string): string {
  return rel.split(sep).join('/');
}

function fileSource(abs: string, dest: string, size: number): SnapshotSource {
  return { path: dest, size, read: async () => new Uint8Array(await readFile(abs)) };
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
        out.push(fileSource(abs, `${prefix}/${toPosix(relative(root, abs))}`, st.size));
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
      const rel = relative(realWd, real);
      if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) continue;
      out.push(fileSource(real, `workspace/${toPosix(rel)}`, st.size));
    } catch {
      // Referenced file no longer exists — skip.
    }
  }
  return out;
}
