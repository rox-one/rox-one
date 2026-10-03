import { randomUUID } from "node:crypto";
import type { TelegramContactItem, TelegramDialogInventoryItem } from "../services/telegram.js";
import type { DbPool } from "./pool.js";
import { normalizeStoredPeerKind } from "./peerIdentity.js";

export type SyncMode = "recent" | "full";
export type SyncRunStatus =
  | "queued"
  | "running"
  | "waiting_for_telegram"
  | "enriching"
  | "complete"
  | "failed";
export type SyncRunPhase =
  | "active"
  | "archived"
  | "contacts"
  | "enrichment"
  | "complete";

export interface TelegramSyncRun {
  runId: string;
  accountId: bigint;
  mode: SyncMode;
  includeArchived: boolean;
  status: SyncRunStatus;
  phase: SyncRunPhase;
  cursorToken: string | null;
  fetchedCount: number;
  persistedCount: number;
  skippedCount: number;
  failedCount: number;
  activeAvailableCount: number;
  archivedAvailableCount: number;
  resumeAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

interface SyncRunRow {
  runId: string;
  accountId: string;
  mode: SyncMode;
  includeArchived: boolean;
  status: SyncRunStatus;
  phase: SyncRunPhase;
  cursorToken: string | null;
  fetchedCount: number;
  persistedCount: number;
  skippedCount: number;
  failedCount: number;
  activeAvailableCount: number;
  archivedAvailableCount: number;
  resumeAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

const SYNC_RUN_SELECT = `
SELECT
  run_id as "runId",
  account_id as "accountId",
  mode,
  include_archived as "includeArchived",
  status,
  phase,
  cursor_token as "cursorToken",
  fetched_count as "fetchedCount",
  persisted_count as "persistedCount",
  skipped_count as "skippedCount",
  failed_count as "failedCount",
  active_available_count as "activeAvailableCount",
  archived_available_count as "archivedAvailableCount",
  resume_at as "resumeAt",
  last_error_code as "lastErrorCode",
  created_at as "createdAt",
  updated_at as "updatedAt",
  completed_at as "completedAt"
FROM telegram_sync_runs
`;

function mapRun(row: SyncRunRow): TelegramSyncRun {
  return { ...row, accountId: BigInt(row.accountId) };
}

export async function getOrCreateActiveSyncRun(
  pool: DbPool,
  params: { accountId: bigint; mode: SyncMode; includeArchived: boolean },
): Promise<TelegramSyncRun> {
  const existing = await getLatestSyncRun(pool, { accountId: params.accountId, activeOnly: true });
  if (existing) return existing;

  const runId = randomUUID();
  try {
    const result = await pool.query<SyncRunRow>(
      `
INSERT INTO telegram_sync_runs (
  run_id, account_id, mode, include_archived, status, phase
)
VALUES ($1, $2, $3, $4, 'queued', 'active')
RETURNING
  run_id as "runId",
  account_id as "accountId",
  mode,
  include_archived as "includeArchived",
  status,
  phase,
  cursor_token as "cursorToken",
  fetched_count as "fetchedCount",
  persisted_count as "persistedCount",
  skipped_count as "skippedCount",
  failed_count as "failedCount",
  active_available_count as "activeAvailableCount",
  archived_available_count as "archivedAvailableCount",
  resume_at as "resumeAt",
  last_error_code as "lastErrorCode",
  created_at as "createdAt",
  updated_at as "updatedAt",
  completed_at as "completedAt"
`,
      [runId, params.accountId.toString(), params.mode, params.includeArchived],
    );
    return mapRun(result.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    const raced = await getLatestSyncRun(pool, {
      accountId: params.accountId,
      activeOnly: true,
    });
    if (!raced) throw error;
    return raced;
  }
}

export async function getLatestSyncRun(
  pool: DbPool,
  params: { accountId: bigint; runId?: string; activeOnly?: boolean },
): Promise<TelegramSyncRun | null> {
  const values: unknown[] = [params.accountId.toString()];
  const clauses = ["account_id = $1"];
  if (params.runId) {
    values.push(params.runId);
    clauses.push(`run_id = $${values.length}`);
  }
  if (params.activeOnly) {
    clauses.push("status IN ('queued', 'running', 'waiting_for_telegram', 'enriching')");
  }
  const result = await pool.query<SyncRunRow>(
    `${SYNC_RUN_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT 1`,
    values,
  );
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

export async function markSyncRunRunning(
  pool: DbPool,
  runId: string,
): Promise<TelegramSyncRun> {
  const updated = await pool.query<SyncRunRow>(
    `
UPDATE telegram_sync_runs
SET status = 'running', resume_at = NULL, last_error_code = NULL,
    started_at = COALESCE(started_at, now()), updated_at = now()
WHERE run_id = $1
RETURNING
  run_id as "runId", account_id as "accountId", mode,
  include_archived as "includeArchived", status, phase,
  cursor_token as "cursorToken", fetched_count as "fetchedCount",
  persisted_count as "persistedCount", skipped_count as "skippedCount",
  failed_count as "failedCount", active_available_count as "activeAvailableCount",
  archived_available_count as "archivedAvailableCount", resume_at as "resumeAt",
  last_error_code as "lastErrorCode", created_at as "createdAt",
  updated_at as "updatedAt", completed_at as "completedAt"
`,
    [runId],
  );
  if (!updated.rows[0]) throw new Error(`Sync run not found: ${runId}`);
  return mapRun(updated.rows[0]);
}

export async function commitDialogInventoryPage(
  pool: DbPool,
  params: {
    run: TelegramSyncRun;
    phase: "active" | "archived";
    dialogs: TelegramDialogInventoryItem[];
    nextPhase: SyncRunPhase;
    nextCursorToken: string | null;
    activeAvailableCount: number;
    archivedAvailableCount: number;
  },
): Promise<TelegramSyncRun> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const dialog of params.dialogs) {
      const peerKind = normalizeStoredPeerKind(dialog.peer.kind);
      await client.query(
        `
INSERT INTO peers (
  account_id, peer_id, peer_kind, username, display_name, updated_at
)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (account_id, peer_kind, peer_id)
DO UPDATE SET
  username = excluded.username,
  display_name = excluded.display_name,
  updated_at = now()
`,
        [
          params.run.accountId.toString(),
          dialog.peer.id,
          peerKind,
          dialog.peer.username,
          dialog.peer.displayName,
        ],
      );
      await client.query(
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
          params.run.accountId.toString(),
          peerKind,
          dialog.peer.id,
          params.phase === "archived",
          dialog.pinned,
          dialog.lastMessage?.id ?? null,
          dialog.lastMessage?.date ?? null,
          dialog.unreadCount,
        ],
      );

      await client.query(
        `
INSERT INTO telegram_dialog_index (
  account_id, peer_kind, peer_id, display_name, username, location, pinned,
  unread_count, last_message_id, last_message_at, last_message_preview,
  persisted_at, sync_run_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
ON CONFLICT (account_id, peer_kind, peer_id)
DO UPDATE SET
  display_name = excluded.display_name,
  username = excluded.username,
  location = excluded.location,
  pinned = excluded.pinned,
  unread_count = excluded.unread_count,
  last_message_id = excluded.last_message_id,
  last_message_at = excluded.last_message_at,
  last_message_preview = excluded.last_message_preview,
  persisted_at = now(),
  sync_run_id = excluded.sync_run_id
`,
        [
          params.run.accountId.toString(),
          peerKind,
          dialog.peer.id,
          dialog.peer.displayName,
          dialog.peer.username,
          params.phase,
          dialog.pinned,
          dialog.unreadCount,
          dialog.lastMessage?.id ?? null,
          dialog.lastMessage?.date ?? null,
          dialog.lastMessage?.preview ?? null,
          params.run.runId,
        ],
      );
    }

    if (params.nextPhase === "contacts" && params.run.mode === "full") {
      await client.query(
        `DELETE FROM telegram_dialog_index
         WHERE account_id = $1 AND sync_run_id <> $2`,
        [params.run.accountId.toString(), params.run.runId],
      );
    }

    const countResult = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM telegram_dialog_index WHERE account_id = $1",
      [params.run.accountId.toString()],
    );
    const statePersistedCount = Number.parseInt(countResult.rows[0].count, 10);
    const runCountResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM telegram_dialog_index
       WHERE account_id = $1 AND sync_run_id = $2`,
      [params.run.accountId.toString(), params.run.runId],
    );
    const runPersistedCount = Number.parseInt(runCountResult.rows[0].count, 10);

    await client.query(
      `
INSERT INTO telegram_inventory_state (
  account_id, telegram_active_available_count, telegram_archived_available_count,
  crm_dialog_persisted_count, last_dialog_sync_at, updated_at
)
VALUES ($1, $2, $3, $4, now(), now())
ON CONFLICT (account_id)
DO UPDATE SET
  telegram_active_available_count = excluded.telegram_active_available_count,
  telegram_archived_available_count = excluded.telegram_archived_available_count,
  crm_dialog_persisted_count = excluded.crm_dialog_persisted_count,
  last_dialog_sync_at = now(),
  updated_at = now()
`,
      [
        params.run.accountId.toString(),
        params.activeAvailableCount,
        params.archivedAvailableCount,
        statePersistedCount,
      ],
    );

    const updateResult = await client.query<SyncRunRow>(
      `
UPDATE telegram_sync_runs
SET phase = $2,
    cursor_token = $3,
    fetched_count = fetched_count + $4,
    persisted_count = $5,
    active_available_count = $6,
    archived_available_count = $7,
    status = CASE WHEN $2 = 'complete' THEN 'complete' ELSE status END,
    completed_at = CASE WHEN $2 = 'complete' THEN now() ELSE completed_at END,
    updated_at = now()
WHERE run_id = $1
RETURNING
  run_id as "runId", account_id as "accountId", mode,
  include_archived as "includeArchived", status, phase,
  cursor_token as "cursorToken", fetched_count as "fetchedCount",
  persisted_count as "persistedCount", skipped_count as "skippedCount",
  failed_count as "failedCount", active_available_count as "activeAvailableCount",
  archived_available_count as "archivedAvailableCount", resume_at as "resumeAt",
  last_error_code as "lastErrorCode", created_at as "createdAt",
  updated_at as "updatedAt", completed_at as "completedAt"
`,
      [
        params.run.runId,
        params.nextPhase,
        params.nextCursorToken,
        params.dialogs.length,
        runPersistedCount,
        params.activeAvailableCount,
        params.archivedAvailableCount,
      ],
    );
    await client.query("COMMIT");
    return mapRun(updateResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markSyncRunWaiting(
  pool: DbPool,
  params: { runId: string; resumeAt: Date; errorCode: string },
): Promise<TelegramSyncRun> {
  const result = await pool.query<SyncRunRow>(
    `
UPDATE telegram_sync_runs
SET status = 'waiting_for_telegram', resume_at = $2,
    last_error_code = $3, updated_at = now()
WHERE run_id = $1
RETURNING
  run_id as "runId", account_id as "accountId", mode,
  include_archived as "includeArchived", status, phase,
  cursor_token as "cursorToken", fetched_count as "fetchedCount",
  persisted_count as "persistedCount", skipped_count as "skippedCount",
  failed_count as "failedCount", active_available_count as "activeAvailableCount",
  archived_available_count as "archivedAvailableCount", resume_at as "resumeAt",
  last_error_code as "lastErrorCode", created_at as "createdAt",
  updated_at as "updatedAt", completed_at as "completedAt"
`,
    [params.runId, params.resumeAt, params.errorCode],
  );
  return mapRun(result.rows[0]);
}

export async function markSyncRunFailed(
  pool: DbPool,
  params: { runId: string; errorCode: string },
): Promise<TelegramSyncRun> {
  const result = await pool.query<SyncRunRow>(
    `
UPDATE telegram_sync_runs
SET status = 'failed', failed_count = failed_count + 1,
    last_error_code = $2, updated_at = now(), completed_at = now()
WHERE run_id = $1
RETURNING
  run_id as "runId", account_id as "accountId", mode,
  include_archived as "includeArchived", status, phase,
  cursor_token as "cursorToken", fetched_count as "fetchedCount",
  persisted_count as "persistedCount", skipped_count as "skippedCount",
  failed_count as "failedCount", active_available_count as "activeAvailableCount",
  archived_available_count as "archivedAvailableCount", resume_at as "resumeAt",
  last_error_code as "lastErrorCode", created_at as "createdAt",
  updated_at as "updatedAt", completed_at as "completedAt"
`,
    [params.runId, params.errorCode],
  );
  return mapRun(result.rows[0]);
}

export async function commitContactSnapshot(
  pool: DbPool,
  params: { run: TelegramSyncRun; contacts: TelegramContactItem[] },
): Promise<TelegramSyncRun> {
  const generation = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const contact of params.contacts) {
      await client.query(
        `
INSERT INTO telegram_contacts (
  account_id, snapshot_generation, peer_kind, peer_id, display_name, username
)
VALUES ($1, $2, 'user', $3, $4, $5)
ON CONFLICT (account_id, snapshot_generation, peer_kind, peer_id)
DO UPDATE SET display_name = excluded.display_name, username = excluded.username
`,
        [
          params.run.accountId.toString(),
          generation,
          contact.peerId,
          contact.displayName,
          contact.username,
        ],
      );
    }

    await client.query(
      `
INSERT INTO telegram_inventory_state (
  account_id, contact_persisted_count, active_contact_generation,
  last_contact_sync_at, updated_at
)
VALUES ($1, $2, $3, now(), now())
ON CONFLICT (account_id)
DO UPDATE SET
  contact_persisted_count = excluded.contact_persisted_count,
  active_contact_generation = excluded.active_contact_generation,
  last_contact_sync_at = now(),
  updated_at = now()
`,
      [params.run.accountId.toString(), params.contacts.length, generation],
    );

    const result = await client.query<SyncRunRow>(
      `
UPDATE telegram_sync_runs
SET status = 'complete', phase = 'complete', cursor_token = NULL,
    skipped_count = GREATEST(
      skipped_count,
      GREATEST(
        0,
        active_available_count +
          CASE WHEN include_archived THEN archived_available_count ELSE 0 END -
          persisted_count
      )
    ),
    resume_at = NULL, last_error_code = NULL, updated_at = now(), completed_at = now()
WHERE run_id = $1
RETURNING
  run_id as "runId", account_id as "accountId", mode,
  include_archived as "includeArchived", status, phase,
  cursor_token as "cursorToken", fetched_count as "fetchedCount",
  persisted_count as "persistedCount", skipped_count as "skippedCount",
  failed_count as "failedCount", active_available_count as "activeAvailableCount",
  archived_available_count as "archivedAvailableCount", resume_at as "resumeAt",
  last_error_code as "lastErrorCode", created_at as "createdAt",
  updated_at as "updatedAt", completed_at as "completedAt"
`,
      [params.run.runId],
    );
    await client.query(
      `DELETE FROM telegram_contacts
       WHERE account_id = $1 AND snapshot_generation <> $2`,
      [params.run.accountId.toString(), generation],
    );
    await client.query("COMMIT");
    return mapRun(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPersistedInventorySummary(
  pool: DbPool,
  accountId: bigint,
): Promise<{ syncedTotal: number; lastSyncedAt: Date | null }> {
  const result = await pool.query<{ syncedTotal: number; lastSyncedAt: Date | null }>(
    `
SELECT
  crm_dialog_persisted_count as "syncedTotal",
  last_dialog_sync_at as "lastSyncedAt"
FROM telegram_inventory_state
WHERE account_id = $1
`,
    [accountId.toString()],
  );
  return result.rows[0] ?? { syncedTotal: 0, lastSyncedAt: null };
}

export async function listPersistedDialogs(
  pool: DbPool,
  params: { accountId: bigint; limit: number; offset: number },
): Promise<{
  total: number;
  lastSyncedAt: Date | null;
  dialogs: TelegramDialogInventoryItem[];
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const stateResult = await client.query<{
      syncedTotal: number;
      lastSyncedAt: Date | null;
    }>(
      `
SELECT
  crm_dialog_persisted_count as "syncedTotal",
  last_dialog_sync_at as "lastSyncedAt"
FROM telegram_inventory_state
WHERE account_id = $1
`,
      [params.accountId.toString()],
    );
    const state = stateResult.rows[0] ?? { syncedTotal: 0, lastSyncedAt: null };
    const rows = await client.query<{
      peerId: string;
      peerKind: "user" | "chat" | "channel" | "self";
      displayName: string;
      username: string | null;
      location: "active" | "archived";
      pinned: boolean;
      unreadCount: number;
      lastMessageId: number | null;
      lastMessageAt: Date | null;
      lastMessagePreview: string | null;
    }>(
      `
SELECT
  peer_id as "peerId", peer_kind as "peerKind", display_name as "displayName",
  username, location, pinned, unread_count as "unreadCount",
  last_message_id as "lastMessageId", last_message_at as "lastMessageAt",
  last_message_preview as "lastMessagePreview"
FROM telegram_dialog_index
WHERE account_id = $1
ORDER BY last_message_at DESC NULLS LAST, peer_kind ASC, peer_id ASC
LIMIT $2 OFFSET $3
`,
      [params.accountId.toString(), params.limit, params.offset],
    );
    await client.query("COMMIT");
    return {
      total: state.syncedTotal,
      lastSyncedAt: state.lastSyncedAt,
      dialogs: rows.rows.map((row) => ({
        peer: {
          id: row.peerId,
          kind: row.peerKind,
          displayName: row.displayName,
          username: row.username,
        },
        archived: row.location === "archived",
        pinned: row.pinned,
        unreadCount: row.unreadCount,
        lastMessage:
          row.lastMessageId !== null && row.lastMessageAt
            ? {
                id: row.lastMessageId,
                date: row.lastMessageAt.toISOString(),
                preview: row.lastMessagePreview ?? "",
              }
            : null,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
