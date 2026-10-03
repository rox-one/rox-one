import { describe, expect, it, vi } from 'vitest';
import { MIGRATIONS } from './schema.js';
import {
  canonicalPeerKind,
  resolveStoredPeerKind,
} from './peerIdentity.js';
import type { DbPool } from './pool.js';

describe('kind-aware Telegram peer identity', () => {
  it('distinguishes basic chats from channel-namespace chats', () => {
    expect(canonicalPeerKind({ type: 'user' } as never)).toBe('user');
    expect(canonicalPeerKind({ type: 'chat', chatType: 'group' } as never)).toBe('chat');
    expect(canonicalPeerKind({ type: 'chat', chatType: 'supergroup' } as never)).toBe(
      'channel',
    );
  });

  it('rejects a numeric peer id that exists in more than one Telegram namespace', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ peerKind: 'channel' }, { peerKind: 'user' }],
      }),
    } as unknown as DbPool;

    await expect(
      resolveStoredPeerKind(pool, { accountId: 1n, peerId: 42 }),
    ).rejects.toThrow('ambiguous');
  });

  it('migrates peer-dependent primary and foreign keys to include peer kind', () => {
    const migration = MIGRATIONS.find(
      (candidate) => candidate.id === '005_kind_aware_peer_identity',
    );
    expect(migration?.sql).toContain(
      'ALTER TABLE peers ADD PRIMARY KEY (account_id, peer_kind, peer_id)',
    );
    expect(migration?.sql).toContain(
      'ALTER TABLE messages ADD PRIMARY KEY (account_id, peer_kind, peer_id, message_id)',
    );
    expect(migration?.sql).toContain(
      'ADD PRIMARY KEY (account_id, snapshot_generation, peer_kind, peer_id)',
    );
    expect(migration?.sql).toContain(
      'FOREIGN KEY (account_id, peer_kind, peer_id)',
    );
  });
});
