import type { DbPool } from './pool.js';
import { upsertAccount } from './writes.js';
import {
  resolveStoredPeerKind,
  type StoredPeerKind,
} from './peerIdentity.js';

type PeerIdentity = {
  accountId: bigint;
  peerId: number;
  peerKind?: StoredPeerKind;
};

export async function ensureAccountId(
  pool: DbPool,
  params: { label: string; sessionPath: string },
): Promise<bigint> {
  return upsertAccount(pool, params);
}

export async function setPeerTags(
  pool: DbPool,
  params: {
    accountId: bigint;
    peerId: number;
    peerKind?: StoredPeerKind;
    tags: string[];
    source: 'manual' | 'ai' | 'rule';
  },
): Promise<void> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  for (const rawTag of params.tags) {
    const tag = rawTag.trim();
    if (!tag) continue;
    await pool.query(
      `
INSERT INTO tags (account_id, tag)
VALUES ($1, $2)
ON CONFLICT (account_id, tag) DO NOTHING
`,
      [params.accountId.toString(), tag],
    );

    await pool.query(
      `
INSERT INTO peer_tags (account_id, peer_kind, peer_id, tag, source)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (account_id, peer_kind, peer_id, tag)
DO UPDATE SET source = excluded.source
`,
      [params.accountId.toString(), peerKind, params.peerId, tag, params.source],
    );
  }
}

export async function clearPeerTags(
  pool: DbPool,
  params: PeerIdentity,
): Promise<number> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query(
    `
DELETE FROM peer_tags
WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3
`,
    [params.accountId.toString(), peerKind, params.peerId],
  );
  return result.rowCount ?? 0;
}

export async function listPeerTags(
  pool: DbPool,
  params: { accountId: bigint; peerId?: number; peerKind?: StoredPeerKind },
): Promise<Array<{ peerId: number; peerKind: StoredPeerKind; tag: string; source: string }>> {
  const peerKind = params.peerId === undefined
    ? undefined
    : await resolveStoredPeerKind(pool, {
        accountId: params.accountId,
        peerId: params.peerId,
        peerKind: params.peerKind,
      });
  const query = params.peerId !== undefined
    ? `
SELECT peer_id as "peerId", peer_kind as "peerKind", tag, source
FROM peer_tags
WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3
ORDER BY tag ASC
`
    : `
SELECT peer_id as "peerId", peer_kind as "peerKind", tag, source
FROM peer_tags
WHERE account_id = $1
ORDER BY peer_kind ASC, peer_id ASC, tag ASC
`;
  const values = params.peerId !== undefined
    ? [params.accountId.toString(), peerKind, params.peerId]
    : [params.accountId.toString()];
  const result = await pool.query<{
    peerId: number;
    peerKind: StoredPeerKind;
    tag: string;
    source: string;
  }>(query, values);
  return result.rows;
}

export async function linkPeerCompany(
  pool: DbPool,
  params: {
    accountId: bigint;
    peerId: number;
    peerKind?: StoredPeerKind;
    companyName: string;
    role?: string;
    source: 'manual' | 'ai' | 'rule';
  },
): Promise<void> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const companyResult = await pool.query<{ company_id: string }>(
    `
INSERT INTO companies (account_id, name)
VALUES ($1, $2)
ON CONFLICT (account_id, name)
DO UPDATE SET name = excluded.name
RETURNING company_id
`,
    [params.accountId.toString(), params.companyName.trim()],
  );

  const companyId = companyResult.rows[0].company_id;
  await pool.query(
    `
INSERT INTO peer_company (
  account_id, peer_kind, peer_id, company_id, role, source, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (account_id, peer_kind, peer_id)
DO UPDATE SET
  company_id = excluded.company_id,
  role = excluded.role,
  source = excluded.source,
  updated_at = now()
`,
    [
      params.accountId.toString(),
      peerKind,
      params.peerId,
      companyId,
      params.role ?? null,
      params.source,
    ],
  );
}

export async function getPeerCompany(
  pool: DbPool,
  params: PeerIdentity,
): Promise<{ companyName: string; role: string | null } | null> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query<{ companyName: string; role: string | null }>(
    `
SELECT c.name as "companyName", pc.role
FROM peer_company pc
JOIN companies c ON c.company_id = pc.company_id
WHERE pc.account_id = $1 AND pc.peer_kind = $2 AND pc.peer_id = $3
LIMIT 1
`,
    [params.accountId.toString(), peerKind, params.peerId],
  );
  return result.rows[0] ?? null;
}

export async function unlinkPeerCompany(
  pool: DbPool,
  params: PeerIdentity,
): Promise<boolean> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query(
    `
DELETE FROM peer_company
WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3
`,
    [params.accountId.toString(), peerKind, params.peerId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addTask(
  pool: DbPool,
  params: {
    accountId: bigint;
    peerId: number;
    peerKind?: StoredPeerKind;
    dueAt: Date;
    why: string;
    priority: 'low' | 'med' | 'high';
  },
): Promise<number> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query<{ task_id: number }>(
    `
INSERT INTO tasks (account_id, peer_kind, peer_id, due_at, why, priority)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING task_id
`,
    [
      params.accountId.toString(),
      peerKind,
      params.peerId,
      params.dueAt,
      params.why,
      params.priority,
    ],
  );
  return result.rows[0].task_id;
}

export async function markTaskDone(
  pool: DbPool,
  params: { accountId: bigint; taskId: number },
): Promise<boolean> {
  const result = await pool.query(
    `
UPDATE tasks
SET status = 'done', updated_at = now()
WHERE account_id = $1 AND task_id = $2
`,
    [params.accountId.toString(), params.taskId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listTasksToday(
  pool: DbPool,
  params: { accountId: bigint },
): Promise<Array<{
  taskId: number;
  peerId: number;
  peerKind: StoredPeerKind;
  dueAt: Date;
  status: string;
  why: string;
  priority: string;
  displayName: string | null;
}>> {
  const result = await pool.query<{
    taskId: number;
    peerId: number;
    peerKind: StoredPeerKind;
    dueAt: Date;
    status: string;
    why: string;
    priority: string;
    displayName: string | null;
  }>(
    `
SELECT
  t.task_id as "taskId",
  t.peer_id as "peerId",
  t.peer_kind as "peerKind",
  t.due_at as "dueAt",
  t.status,
  t.why,
  t.priority,
  p.display_name as "displayName"
FROM tasks t
LEFT JOIN peers p
 ON p.account_id = t.account_id
 AND p.peer_kind = t.peer_kind
 AND p.peer_id = t.peer_id
WHERE t.account_id = $1
  AND t.status = 'open'
  AND t.due_at::date <= now()::date
ORDER BY t.due_at ASC
`,
    [params.accountId.toString()],
  );
  return result.rows;
}

export async function listTasksForPeer(
  pool: DbPool,
  params: PeerIdentity,
): Promise<Array<{ taskId: number; dueAt: Date; why: string; priority: string; status: string }>> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query<{
    taskId: number;
    dueAt: Date;
    why: string;
    priority: string;
    status: string;
  }>(
    `
SELECT
  task_id as "taskId",
  due_at as "dueAt",
  why,
  priority,
  status
FROM tasks
WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3
ORDER BY due_at ASC
`,
    [params.accountId.toString(), peerKind, params.peerId],
  );
  return result.rows;
}

export async function upsertSummary(
  pool: DbPool,
  params: {
    accountId: bigint;
    peerId: number;
    peerKind?: StoredPeerKind;
    kind: 'rolling' | 'since_last_seen';
    content: string;
    sourceModel?: string;
  },
): Promise<void> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  await pool.query(
    `
INSERT INTO summaries (
  account_id, peer_kind, peer_id, kind, content, source_model, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (account_id, peer_kind, peer_id, kind)
DO UPDATE SET
  content = excluded.content,
  source_model = excluded.source_model,
  updated_at = now()
`,
    [
      params.accountId.toString(),
      peerKind,
      params.peerId,
      params.kind,
      params.content,
      params.sourceModel ?? null,
    ],
  );
}

export async function getSummary(
  pool: DbPool,
  params: PeerIdentity & { kind: 'rolling' | 'since_last_seen' },
): Promise<{ content: string; updatedAt: Date } | null> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query<{ content: string; updatedAt: Date }>(
    `
SELECT content, updated_at as "updatedAt"
FROM summaries
WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3 AND kind = $4
LIMIT 1
`,
    [params.accountId.toString(), peerKind, params.peerId, params.kind],
  );
  return result.rows[0] ?? null;
}

export async function addAutomationRule(
  pool: DbPool,
  params: {
    accountId: bigint;
    name: string;
    containsText: string;
    setTag?: string;
    followupDays?: number;
  },
): Promise<number> {
  const result = await pool.query<{ rule_id: number }>(
    `
INSERT INTO automation_rules (account_id, name, contains_text, set_tag, followup_days)
VALUES ($1, $2, $3, $4, $5)
RETURNING rule_id
`,
    [
      params.accountId.toString(),
      params.name,
      params.containsText,
      params.setTag ?? null,
      params.followupDays ?? null,
    ],
  );
  return result.rows[0].rule_id;
}

export async function listAutomationRules(
  pool: DbPool,
  params: { accountId: bigint },
): Promise<Array<{
  ruleId: number;
  name: string;
  containsText: string;
  setTag: string | null;
  followupDays: number | null;
  enabled: boolean;
}>> {
  const result = await pool.query<{
    ruleId: number;
    name: string;
    containsText: string;
    setTag: string | null;
    followupDays: number | null;
    enabled: boolean;
  }>(
    `
SELECT
  rule_id as "ruleId",
  name,
  contains_text as "containsText",
  set_tag as "setTag",
  followup_days as "followupDays",
  enabled
FROM automation_rules
WHERE account_id = $1
ORDER BY rule_id ASC
`,
    [params.accountId.toString()],
  );
  return result.rows;
}

export async function setAutomationRuleEnabled(
  pool: DbPool,
  params: { accountId: bigint; ruleId: number; enabled: boolean },
): Promise<boolean> {
  const result = await pool.query(
    `
UPDATE automation_rules
SET enabled = $3
WHERE account_id = $1 AND rule_id = $2
`,
    [params.accountId.toString(), params.ruleId, params.enabled],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAutomationRule(
  pool: DbPool,
  params: { accountId: bigint; ruleId: number },
): Promise<boolean> {
  const result = await pool.query(
    `
DELETE FROM automation_rules
WHERE account_id = $1 AND rule_id = $2
`,
    [params.accountId.toString(), params.ruleId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addRuleEvent(
  pool: DbPool,
  params: {
    accountId: bigint;
    ruleId: number;
    peerId: number;
    peerKind?: StoredPeerKind;
    note: string;
    matchMessageId?: number;
  },
): Promise<void> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  await pool.query(
    `
INSERT INTO rule_events (
  account_id, rule_id, peer_kind, peer_id, note, match_message_id
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (account_id, rule_id, peer_kind, peer_id, match_message_id)
WHERE match_message_id IS NOT NULL
DO NOTHING
`,
    [
      params.accountId.toString(),
      params.ruleId,
      peerKind,
      params.peerId,
      params.note,
      params.matchMessageId ?? null,
    ],
  );
}

export async function hasRuleEventForMatch(
  pool: DbPool,
  params: PeerIdentity & { ruleId: number; matchMessageId: number },
): Promise<boolean> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query(
    `
SELECT 1
FROM rule_events
WHERE account_id = $1
  AND rule_id = $2
  AND peer_kind = $3
  AND peer_id = $4
  AND match_message_id = $5
LIMIT 1
`,
    [
      params.accountId.toString(),
      params.ruleId,
      peerKind,
      params.peerId,
      params.matchMessageId,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listRuleEvents(
  pool: DbPool,
  params: { accountId: bigint; limit: number },
): Promise<Array<{
  eventId: number;
  ruleId: number;
  peerId: number;
  peerKind: StoredPeerKind;
  note: string;
  createdAt: Date;
}>> {
  const result = await pool.query<{
    eventId: number;
    ruleId: number;
    peerId: number;
    peerKind: StoredPeerKind;
    note: string;
    createdAt: Date;
  }>(
    `
SELECT
  event_id as "eventId",
  rule_id as "ruleId",
  peer_id as "peerId",
  peer_kind as "peerKind",
  note,
  created_at as "createdAt"
FROM rule_events
WHERE account_id = $1
ORDER BY created_at DESC
LIMIT $2
`,
    [params.accountId.toString(), params.limit],
  );
  return result.rows;
}

export async function searchLocalMessages(
  pool: DbPool,
  params: {
    accountId: bigint;
    query: string;
    limit: number;
    peerId?: number;
    peerKind?: StoredPeerKind;
    tag?: string;
    company?: string;
  },
): Promise<Array<{
  peerId: number;
  peerKind: StoredPeerKind;
  messageId: number;
  sentAt: Date;
  text: string;
  displayName: string | null;
}>> {
  const clauses = ['m.account_id = $1', 'm.text ILIKE $2'];
  const values: Array<string | number> = [params.accountId.toString(), `%${params.query}%`];
  let index = values.length + 1;

  if (params.peerId !== undefined) {
    const peerKind = await resolveStoredPeerKind(pool, {
      accountId: params.accountId,
      peerId: params.peerId,
      peerKind: params.peerKind,
    });
    clauses.push(`m.peer_kind = $${index}`);
    values.push(peerKind);
    index += 1;
    clauses.push(`m.peer_id = $${index}`);
    values.push(params.peerId);
    index += 1;
  }

  if (params.tag) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM peer_tags pt
        WHERE pt.account_id = m.account_id
          AND pt.peer_kind = m.peer_kind
          AND pt.peer_id = m.peer_id
          AND pt.tag = $${index}
      )`,
    );
    values.push(params.tag);
    index += 1;
  }

  if (params.company) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM peer_company pc
        JOIN companies c ON c.company_id = pc.company_id
        WHERE pc.account_id = m.account_id
          AND pc.peer_kind = m.peer_kind
          AND pc.peer_id = m.peer_id
          AND c.name = $${index}
      )`,
    );
    values.push(params.company);
    index += 1;
  }

  values.push(params.limit);

  const result = await pool.query<{
    peerId: number;
    peerKind: StoredPeerKind;
    messageId: number;
    sentAt: Date;
    text: string;
    displayName: string | null;
  }>(
    `
SELECT
  m.peer_id as "peerId",
  m.peer_kind as "peerKind",
  m.message_id as "messageId",
  m.sent_at as "sentAt",
  m.text,
  p.display_name as "displayName"
FROM messages m
LEFT JOIN peers p
 ON p.account_id = m.account_id
 AND p.peer_kind = m.peer_kind
 AND p.peer_id = m.peer_id
WHERE ${clauses.join(' AND ')}
ORDER BY m.sent_at DESC
LIMIT $${index}
`,
    values,
  );

  return result.rows;
}

export async function updateSyncCursor(
  pool: DbPool,
  params: {
    accountId: bigint;
    peerId: number;
    peerKind?: StoredPeerKind;
    lastSyncedMessageId?: number;
    error?: string;
  },
): Promise<void> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  await pool.query(
    `
INSERT INTO sync_cursors (
  account_id,
  peer_kind,
  peer_id,
  last_synced_message_id,
  last_synced_at,
  last_run_at,
  error
)
VALUES ($1, $2, $3, $4, now(), now(), $5)
ON CONFLICT (account_id, peer_kind, peer_id)
DO UPDATE SET
  last_synced_message_id = COALESCE(excluded.last_synced_message_id, sync_cursors.last_synced_message_id),
  last_synced_at = now(),
  last_run_at = now(),
  error = excluded.error
`,
    [
      params.accountId.toString(),
      peerKind,
      params.peerId,
      params.lastSyncedMessageId ?? null,
      params.error ?? null,
    ],
  );
}

export async function getSyncCursor(
  pool: DbPool,
  params: PeerIdentity,
): Promise<{ lastSyncedMessageId: number | null } | null> {
  const peerKind = await resolveStoredPeerKind(pool, params);
  const result = await pool.query<{ lastSyncedMessageId: number | null }>(
    `
SELECT last_synced_message_id as "lastSyncedMessageId"
FROM sync_cursors
WHERE account_id = $1 AND peer_kind = $2 AND peer_id = $3
LIMIT 1
`,
    [params.accountId.toString(), peerKind, params.peerId],
  );
  return result.rows[0] ?? null;
}
