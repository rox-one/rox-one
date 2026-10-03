import { readFile } from 'node:fs/promises';
import type { AppContext } from '../app/context.js';
import { parseCommandArgs, optionValue } from '../app/cli-args.js';
import { requireDb } from '../app/db.js';
import { requireAccountId } from '../app/account.js';
import {
  normalizeStoredPeerKind,
  type StoredPeerKind,
} from '../db/peerIdentity.js';

interface JsonExportPayload {
  peers?: Array<Record<string, unknown>>;
  dialogs?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  tags?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  summaries?: Array<Record<string, unknown>>;
  rules?: Array<Record<string, unknown>>;
}

async function ensureImportedPeer(
  db: ReturnType<typeof requireDb>,
  params: {
    accountId: bigint;
    row: Record<string, unknown>;
  },
): Promise<StoredPeerKind> {
  const peerId = params.row.peer_id;
  if (peerId === undefined || peerId === null) {
    throw new Error('Import row is missing peer_id.');
  }

  let peerKind: StoredPeerKind;
  if (params.row.peer_kind !== undefined && params.row.peer_kind !== null) {
    peerKind = normalizeStoredPeerKind(params.row.peer_kind);
  } else {
    const existing = await db.query<{ peerKind: StoredPeerKind }>(
      `SELECT peer_kind as "peerKind"
       FROM peers
       WHERE account_id = $1 AND peer_id = $2
       ORDER BY peer_kind
       LIMIT 2`,
      [params.accountId.toString(), peerId],
    );
    if (existing.rows.length > 1) {
      throw new Error(`Import row for peer ${String(peerId)} must include peer_kind.`);
    }
    peerKind = existing.rows[0]?.peerKind ?? 'chat';
  }

  await db.query(
    `
INSERT INTO peers (account_id, peer_id, peer_kind, username, display_name, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (account_id, peer_kind, peer_id)
DO UPDATE SET
  username = COALESCE(excluded.username, peers.username),
  display_name = CASE
    WHEN peers.display_name LIKE 'Imported peer %' THEN excluded.display_name
    ELSE peers.display_name
  END,
  updated_at = now()
`,
    [
      params.accountId.toString(),
      peerId,
      peerKind,
      params.row.username ?? null,
      typeof params.row.display_name === 'string' && params.row.display_name.trim()
        ? params.row.display_name
        : `Imported peer ${String(peerId)}`,
    ],
  );
  return peerKind;
}

export async function runImport(ctx: AppContext, args: string[]): Promise<void> {
  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);
  const parsed = parseCommandArgs(args, ['--from']);
  const fromPath = optionValue(parsed, ['--from']) ?? parsed.positionals[0];
  if (!fromPath) {
    throw new Error('Usage: tgchats import --from <path>');
  }

  const raw = await readFile(fromPath, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Import file is empty.');
  }

  if (trimmed.startsWith('{')) {
    const payload = JSON.parse(trimmed) as JsonExportPayload;

    for (const row of payload.peers ?? []) {
      await db.query(
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
          accountId.toString(),
          row.peer_id,
          normalizeStoredPeerKind(row.peer_kind),
          row.username ?? null,
          row.display_name ?? String(row.peer_id),
        ],
      );
    }

    for (const row of payload.dialogs ?? []) {
      const peerKind = await ensureImportedPeer(db, { accountId, row });
      await db.query(
        `
INSERT INTO dialogs (
  account_id, peer_kind, peer_id, archived, pinned, last_message_id,
  last_message_at, unread_count, updated_at
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
          accountId.toString(),
          peerKind,
          row.peer_id,
          row.archived ?? false,
          row.pinned ?? false,
          row.last_message_id ?? null,
          row.last_message_at ?? null,
          row.unread_count ?? 0,
        ],
      );
    }

    for (const row of payload.messages ?? []) {
      const peerKind = await ensureImportedPeer(db, { accountId, row });
      await db.query(
        `
INSERT INTO messages (
  account_id, peer_kind, peer_id, message_id, sent_at, sender_peer_id,
  sender_peer_kind, text, is_service, media_type
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (account_id, peer_kind, peer_id, message_id) DO NOTHING
`,
        [
          accountId.toString(),
          peerKind,
          row.peer_id,
          row.message_id,
          row.sent_at,
          row.sender_peer_id ?? null,
          row.sender_peer_kind ?? null,
          row.text ?? '',
          row.is_service ?? false,
          row.media_type ?? null,
        ],
      );
    }

    for (const row of payload.tags ?? []) {
      const peerKind = await ensureImportedPeer(db, { accountId, row });
      await db.query(
        `
INSERT INTO tags (account_id, tag)
VALUES ($1, $2)
ON CONFLICT (account_id, tag) DO NOTHING
`,
        [accountId.toString(), row.tag],
      );
      await db.query(
        `
INSERT INTO peer_tags (account_id, peer_kind, peer_id, tag, source, confidence)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (account_id, peer_kind, peer_id, tag)
DO UPDATE SET source = excluded.source, confidence = excluded.confidence
`,
        [
          accountId.toString(),
          peerKind,
          row.peer_id,
          row.tag,
          row.source ?? 'manual',
          row.confidence ?? null,
        ],
      );
    }

    for (const row of payload.tasks ?? []) {
      const peerKind = await ensureImportedPeer(db, { accountId, row });
      await db.query(
        `
INSERT INTO tasks (
  account_id, peer_kind, peer_id, due_at, status, why, priority,
  created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
`,
        [
          accountId.toString(),
          peerKind,
          row.peer_id,
          row.due_at ?? new Date().toISOString(),
          row.status ?? 'open',
          row.why ?? '',
          row.priority ?? 'med',
        ],
      );
    }

    for (const row of payload.summaries ?? []) {
      const peerKind = await ensureImportedPeer(db, { accountId, row });
      await db.query(
        `
INSERT INTO summaries (
  account_id, peer_kind, peer_id, kind, content, source_model, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (account_id, peer_kind, peer_id, kind)
DO UPDATE SET content = excluded.content, source_model = excluded.source_model, updated_at = now()
`,
        [
          accountId.toString(),
          peerKind,
          row.peer_id,
          row.kind ?? 'rolling',
          row.content ?? '',
          row.source_model ?? null,
        ],
      );
    }

    for (const row of payload.rules ?? []) {
      await db.query(
        `
INSERT INTO automation_rules (account_id, name, contains_text, set_tag, followup_days, enabled)
VALUES ($1, $2, $3, $4, $5, $6)
`,
        [
          accountId.toString(),
          row.name ?? 'imported-rule',
          row.contains_text ?? '',
          row.set_tag ?? null,
          row.followup_days ?? null,
          row.enabled ?? true,
        ],
      );
    }

    console.log(`Import complete from ${fromPath}.`);
    return;
  }

  // JSONL fallback: treats each line as a message row
  const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
  let inserted = 0;
  for (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown>;
    const peerKind = await ensureImportedPeer(db, { accountId, row });
    await db.query(
      `
INSERT INTO messages (
  account_id, peer_kind, peer_id, message_id, sent_at, sender_peer_id,
  sender_peer_kind, text, is_service, media_type
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (account_id, peer_kind, peer_id, message_id) DO NOTHING
`,
      [
        accountId.toString(),
        peerKind,
        row.peer_id,
        row.message_id,
        row.sent_at ?? new Date().toISOString(),
        row.sender_peer_id ?? null,
        row.sender_peer_kind ?? null,
        row.text ?? '',
        row.is_service ?? false,
        row.media_type ?? null,
      ],
    );
    inserted += 1;
  }
  console.log(`Imported ${inserted} JSONL records from ${fromPath}.`);
}
