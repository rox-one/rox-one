import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppContext } from '../app/context.js';
import { parseCommandArgs, optionValue } from '../app/cli-args.js';
import { requireDb } from '../app/db.js';
import { requireAccountId } from '../app/account.js';
import { CliError } from '../app/errors.js';

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function peerKey(kind: unknown, value: unknown): string {
  return `${String(kind)}:${String(value)}`;
}

export async function runExport(ctx: AppContext, args: string[]): Promise<void> {
  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);
  const parsed = parseCommandArgs(args, ['--format', '--out']);
  const format = (optionValue(parsed, ['--format']) ?? 'json').toLowerCase();
  const outPath = optionValue(parsed, ['--out']) ?? `./exports/export-${Date.now()}.${format}`;

  try {
    await mkdir(dirname(outPath), { recursive: true });
  } catch {
    throw new CliError(
      'Export output directory could not be created. Check --out and local filesystem permissions.',
      'EXPORT_PATH_INVALID',
    );
  }

  const peers = await db.query('SELECT * FROM peers WHERE account_id = $1 ORDER BY peer_id', [
    accountId.toString(),
  ]);
  const dialogs = await db.query(
    'SELECT * FROM dialogs WHERE account_id = $1 ORDER BY last_message_at DESC NULLS LAST',
    [accountId.toString()],
  );
  const messages = await db.query(
    'SELECT * FROM messages WHERE account_id = $1 ORDER BY sent_at DESC LIMIT 50000',
    [accountId.toString()],
  );
  const tags = await db.query('SELECT * FROM peer_tags WHERE account_id = $1 ORDER BY peer_id', [
    accountId.toString(),
  ]);
  const tasks = await db.query('SELECT * FROM tasks WHERE account_id = $1 ORDER BY due_at ASC', [
    accountId.toString(),
  ]);
  const summaries = await db.query(
    'SELECT * FROM summaries WHERE account_id = $1 ORDER BY peer_id, kind',
    [accountId.toString()],
  );
  const rules = await db.query(
    'SELECT * FROM automation_rules WHERE account_id = $1 ORDER BY rule_id',
    [accountId.toString()],
  );

  if (format === 'json') {
    const payload = {
      exportedAt: new Date().toISOString(),
      accountId: accountId.toString(),
      peers: peers.rows,
      dialogs: dialogs.rows,
      messages: messages.rows,
      tags: tags.rows,
      tasks: tasks.rows,
      summaries: summaries.rows,
      rules: rules.rows,
    };
    await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Exported JSON to ${outPath}`);
    return;
  }

  if (format === 'jsonl') {
    const peersById = new Map(
      peers.rows.map((peer) => [peerKey(peer.peer_kind, peer.peer_id), peer]),
    );
    const lines = messages.rows
      .map((row) => {
        const peer = peersById.get(peerKey(row.peer_kind, row.peer_id));
        return JSON.stringify({
          ...row,
          peer_kind: peer?.peer_kind ?? null,
          username: peer?.username ?? null,
          display_name: peer?.display_name ?? null,
        });
      })
      .join('\n');
    await writeFile(outPath, lines, 'utf8');
    console.log(`Exported JSONL (messages) to ${outPath}`);
    return;
  }

  if (format === 'csv') {
    const header = [
      'peer_id',
      'peer_kind',
      'message_id',
      'sent_at',
      'sender_peer_id',
      'sender_peer_kind',
      'text',
      'is_service',
      'media_type',
    ];
    const lines = [header.join(',')];
    for (const row of messages.rows) {
      lines.push(
        [
          row.peer_id,
          row.peer_kind,
          row.message_id,
          row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at),
          row.sender_peer_id ?? '',
          row.sender_peer_kind ?? '',
          csvEscape(String(row.text ?? '')),
          row.is_service ? 'true' : 'false',
          row.media_type ?? '',
        ].join(','),
      );
    }
    await writeFile(outPath, lines.join('\n'), 'utf8');
    console.log(`Exported CSV (messages) to ${outPath}`);
    return;
  }

  if (format === 'md') {
    const lines: string[] = [];
    lines.push(`# Telegram Export (${new Date().toISOString()})`);
    lines.push('');
    lines.push(`Dialogs: ${dialogs.rows.length}`);
    lines.push(`Messages (sampled): ${messages.rows.length}`);
    lines.push('');
    for (const dialog of dialogs.rows.slice(0, 200)) {
      const peer = peers.rows.find(
        (item) =>
          item.peer_id === dialog.peer_id && item.peer_kind === dialog.peer_kind,
      );
      const title = peer?.display_name ?? String(dialog.peer_id);
      lines.push(`## ${title}`);
      lines.push(`- Peer ID: ${dialog.peer_id}`);
      lines.push(`- Peer kind: ${dialog.peer_kind}`);
      lines.push(`- Last message id: ${dialog.last_message_id ?? '-'}`);
      lines.push(`- Unread: ${dialog.unread_count}`);
      lines.push('');
    }
    await writeFile(outPath, lines.join('\n'), 'utf8');
    console.log(`Exported Markdown to ${outPath}`);
    return;
  }

  throw new Error('Unsupported format. Use json|jsonl|csv|md.');
}
