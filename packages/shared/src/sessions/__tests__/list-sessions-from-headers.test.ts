import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionHeader } from '../jsonl.ts';
import { createSession, getSessionFilePath, listSessions, listSessionsFromHeaders } from '../storage.ts';
import type { SessionMetadata } from '../types.ts';

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Order-independent comparable form: id-keyed, JSON-serialized (key order included). */
function keyed(metas: SessionMetadata[]): string {
  return JSON.stringify(metas.map((meta) => [meta.id, meta]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

describe('listSessionsFromHeaders', () => {
  it('matches the scanning listSessions output byte-for-byte', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-headers-'));
    roots.push(root);
    const one = await createSession(root, { name: 'One' });
    const two = await createSession(root, { name: 'Two', labels: ['x'] });

    const headers = [one.id, two.id].map((id) => readSessionHeader(getSessionFilePath(root, id))!);
    const fromHeaders = listSessionsFromHeaders(root, headers);
    const scanned = listSessions(root);

    expect(keyed(fromHeaders)).toBe(keyed(scanned));
    expect(fromHeaders.map((meta) => meta.id).sort()).toEqual([one.id, two.id].sort());
  });

  it('returns an empty list for no headers', () => {
    const root = mkdtempSync(join(tmpdir(), 'session-headers-'));
    roots.push(root);
    expect(listSessionsFromHeaders(root, [])).toEqual([]);
  });
});