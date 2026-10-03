import type { Peer } from '@mtcute/node';
import type { DbPool } from './pool.js';

export type StoredPeerKind = 'user' | 'chat' | 'channel';

export function canonicalPeerKind(peer: Peer): StoredPeerKind {
  if (peer.type === 'user') return 'user';
  return peer.chatType === 'channel' ||
    peer.chatType === 'supergroup' ||
    peer.chatType === 'gigagroup' ||
    peer.chatType === 'monoforum'
    ? 'channel'
    : 'chat';
}

export function normalizeStoredPeerKind(value: unknown): StoredPeerKind {
  if (value === 'user' || value === 'chat' || value === 'channel') return value;
  if (value === 'self') return 'user';
  throw new Error(`Unsupported Telegram peer kind: ${String(value)}`);
}

export async function resolveStoredPeerKind(
  pool: DbPool,
  params: {
    accountId: bigint;
    peerId: number;
    peerKind?: StoredPeerKind;
  },
): Promise<StoredPeerKind> {
  if (params.peerKind) return params.peerKind;

  const result = await pool.query<{ peerKind: StoredPeerKind }>(
    `
SELECT peer_kind as "peerKind"
FROM peers
WHERE account_id = $1 AND peer_id = $2
ORDER BY peer_kind
LIMIT 2
`,
    [params.accountId.toString(), params.peerId],
  );
  if (result.rows.length === 1) return result.rows[0].peerKind;
  if (result.rows.length > 1) {
    throw new Error(
      `Telegram peer ID ${params.peerId} is ambiguous; resolve the peer by username or explicit Telegram kind.`,
    );
  }
  throw new Error(`Telegram peer ${params.peerId} is not stored for this account.`);
}
