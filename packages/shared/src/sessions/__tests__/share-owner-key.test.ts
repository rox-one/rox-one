/**
 * Persistence + leak-prevention for the share owner capability key.
 *
 * `sharedOwnerKey` is the desktop-side copy of the viewer share mutation
 * capability (see apps/viewer/SECURITY.md). It MUST:
 *   - persist in session.jsonl (survives restarts, drives update/revoke)
 *   - NEVER appear in SessionMetadata list payloads (headerToMetadata)
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionJsonl, writeSessionJsonl } from '../jsonl.ts';
import { listSessions, updateSessionMetadata } from '../storage.ts';
import { SESSION_PERSISTENT_FIELDS, type StoredSession } from '../types.ts';

function makeStored(root: string, sessionId: string): StoredSession {
  return {
    id: sessionId,
    workspaceRootPath: root,
    createdAt: 100,
    lastUsedAt: 200,
    lastMessageAt: 200,
    sharedUrl: 'https://agents.rox.one/s/abc',
    sharedId: 'abc',
    sharedOwnerKey: 'owner-key-32-bytes-of-entropy-aaaaaaaaaaa',
    messages: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
  };
}

describe('session persistence: sharedOwnerKey', () => {
  it('includes sharedOwnerKey in SESSION_PERSISTENT_FIELDS', () => {
    expect(SESSION_PERSISTENT_FIELDS).toContain('sharedOwnerKey');
  });

  it('round-trips sharedOwnerKey through JSONL write/read', () => {
    const root = mkdtempSync(join(tmpdir(), 'share-owner-key-'));
    try {
      const sessionId = 'shared-session';
      const sessionDir = join(root, 'sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      const file = join(sessionDir, 'session.jsonl');

      writeSessionJsonl(file, makeStored(root, sessionId));

      const reread = readSessionJsonl(file);
      expect(reread?.sharedId).toBe('abc');
      expect(reread?.sharedOwnerKey).toBe('owner-key-32-bytes-of-entropy-aaaaaaaaaaa');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT leak sharedOwnerKey into SessionMetadata list payloads', () => {
    const root = mkdtempSync(join(tmpdir(), 'share-owner-key-meta-'));
    try {
      const sessionId = 'shared-session';
      const sessionDir = join(root, 'sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      writeSessionJsonl(join(sessionDir, 'session.jsonl'), makeStored(root, sessionId));

      const listed = listSessions(root);
      const meta = listed.find((s) => s.id === sessionId);
      expect(meta).toBeDefined();
      expect(meta?.sharedId).toBe('abc');
      // The owner capability must not cross into list/DTO payloads
      expect((meta as unknown as Record<string, unknown>).sharedOwnerKey).toBeUndefined();
      expect(JSON.stringify(meta)).not.toContain('owner-key-32-bytes-of-entropy');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('updateSessionMetadata sets and clears sharedOwnerKey', async () => {
    const root = mkdtempSync(join(tmpdir(), 'share-owner-key-upd-'));
    try {
      const sessionId = 'shared-session';
      const sessionDir = join(root, 'sessions', sessionId);
      mkdirSync(sessionDir, { recursive: true });
      const file = join(sessionDir, 'session.jsonl');
      const stored = makeStored(root, sessionId);
      stored.sharedOwnerKey = undefined;
      writeSessionJsonl(file, stored);

      await updateSessionMetadata(root, sessionId, { sharedOwnerKey: 'key-v1' });
      expect(readSessionJsonl(file)?.sharedOwnerKey).toBe('key-v1');

      await updateSessionMetadata(root, sessionId, { sharedOwnerKey: undefined });
      expect(readSessionJsonl(file)?.sharedOwnerKey).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
