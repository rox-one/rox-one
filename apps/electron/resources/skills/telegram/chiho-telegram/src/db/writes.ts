import type { Dialog, Message, Peer } from '@mtcute/node';
import type { DbPool } from './pool.js';
import { canonicalPeerKind } from './peerIdentity.js';

export async function upsertAccount(
  pool: DbPool,
  params: { label: string; sessionPath: string },
): Promise<bigint> {
  const result = await pool.query<{ id: string }>(
    `
INSERT INTO accounts (label, session_path)
VALUES ($1, $2)
ON CONFLICT (label)
DO UPDATE SET session_path = excluded.session_path
RETURNING id
`,
    [params.label, params.sessionPath],
  );

  return BigInt(result.rows[0].id);
}

export async function upsertPeer(pool: DbPool, params: {
  accountId: bigint;
  peer: Peer;
}): Promise<void> {
  const peer = params.peer;
  await pool.query(
    `
INSERT INTO peers (account_id, peer_id, peer_kind, username, display_name, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (account_id, peer_kind, peer_id)
DO UPDATE SET
  username = excluded.username,
  display_name = excluded.display_name,
  updated_at = now()
`,
    [
      params.accountId.toString(),
      peer.id,
      canonicalPeerKind(peer),
      peer.username,
      peer.displayName,
    ],
  );
}

export async function upsertDialog(pool: DbPool, params: {
  accountId: bigint;
  dialog: Dialog;
}): Promise<void> {
  const dialog = params.dialog;
  const lastMessage = dialog.lastMessage;

  await pool.query(
    `
INSERT INTO dialogs (
  account_id,
  peer_kind,
  peer_id,
  archived,
  pinned,
  last_message_id,
  last_message_at,
  unread_count,
  updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
ON CONFLICT (account_id, peer_kind, peer_id)
DO UPDATE SET
  archived = excluded.archived,
  pinned = excluded.pinned,
  last_message_id = excluded.last_message_id,
  last_message_at = excluded.last_message_at,
  unread_count = excluded.unread_count,
  updated_at = now()
`,
    [
      params.accountId.toString(),
      canonicalPeerKind(dialog.peer),
      dialog.peer.id,
      dialog.isArchived,
      dialog.isPinned,
      lastMessage?.id ?? null,
      lastMessage?.date ?? null,
      dialog.unreadCount,
    ],
  );
}

export async function insertMessage(pool: DbPool, params: {
  accountId: bigint;
  peer: Peer;
  message: Message;
}): Promise<void> {
  const message = params.message;
  const mediaType = message.media ? message.media.type : null;
  const senderPeerId = message.sender.id;

  await pool.query(
    `
INSERT INTO messages (
  account_id,
  peer_kind,
  peer_id,
  message_id,
  sent_at,
  sender_peer_id,
  sender_peer_kind,
  text,
  is_service,
  media_type
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (account_id, peer_kind, peer_id, message_id)
DO NOTHING
`,
    [
      params.accountId.toString(),
      canonicalPeerKind(params.peer),
      params.peer.id,
      message.id,
      message.date,
      senderPeerId,
      canonicalPeerKind(message.sender),
      message.text,
      message.isService,
      mediaType,
    ],
  );
}
