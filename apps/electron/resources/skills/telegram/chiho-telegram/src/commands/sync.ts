import type { AppContext } from '../app/context.js';
import { parseCommandArgs, optionValue, parsePositiveInt } from '../app/cli-args.js';
import { requireDb } from '../app/db.js';
import { requireAccountId } from '../app/account.js';
import {
  commitContactSnapshot,
  commitDialogInventoryPage,
  getLatestSyncRun,
  getOrCreateActiveSyncRun,
  markSyncRunFailed,
  markSyncRunRunning,
  markSyncRunWaiting,
  type SyncMode,
  type TelegramSyncRun,
} from '../db/inventory.js';
import { migrate } from '../db/migrate.js';
import {
  ensureAuthorized,
  fetchChatHistory,
  fetchTelegramDialogFolderPage,
  getTelegramContacts,
  getTelegramDialogTotals,
  listDialogs,
  mapDialogInventoryItem,
  mapTelegramContact,
  telegramRateLimit,
  type TelegramDialogOffset,
  withTelegramRateLimitBackoff,
  type TelegramBackoffEvent,
} from '../services/telegram.js';
import { getSyncCursor, updateSyncCursor } from '../db/crm.js';
import { insertMessage, upsertDialog, upsertPeer } from '../db/writes.js';
import { canonicalPeerKind } from '../db/peerIdentity.js';
import { printJson } from '../output.js';
import {
  accountCursorBinding,
  cursorCodecForContext,
} from './inventorySupport.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffEventPayload(event: TelegramBackoffEvent) {
  return {
    operation: event.operation,
    attempt: event.attempt,
    code: event.code,
    retryAfterMs: event.waitMs,
  };
}

async function syncOnce(ctx: AppContext, dialogLimit: number): Promise<number> {
  const db = requireDb(ctx);
  const accountId = await requireAccountId(ctx);
  const dialogs = await listDialogs(ctx.telegram, { all: false, limit: dialogLimit });

  let messagesProcessed = 0;
  for (const dialog of dialogs) {
    await upsertPeer(db, { accountId, peer: dialog.peer });
    await upsertDialog(db, { accountId, dialog });

    const cursor = await getSyncCursor(db, {
      accountId,
      peerId: dialog.peer.id,
      peerKind: canonicalPeerKind(dialog.peer),
    });
    const lastSyncedMessageId = cursor?.lastSyncedMessageId ?? null;

    if (lastSyncedMessageId) {
      const messages = await fetchChatHistory(ctx.telegram, {
        chatId: String(dialog.peer.id),
        limit: Number.POSITIVE_INFINITY,
        sinceMessageId: lastSyncedMessageId,
      });

      for (const message of messages) {
        await insertMessage(db, { accountId, peer: dialog.peer, message });
        messagesProcessed += 1;
      }

      if (messages.length > 0) {
        await updateSyncCursor(db, {
          accountId,
          peerId: dialog.peer.id,
          peerKind: canonicalPeerKind(dialog.peer),
          lastSyncedMessageId: Math.max(...messages.map((message) => message.id)),
        });
      }
      continue;
    }

    const lastMessage = dialog.lastMessage;
    if (lastMessage) {
      await insertMessage(db, { accountId, peer: dialog.peer, message: lastMessage });
      await updateSyncCursor(db, {
        accountId,
        peerId: dialog.peer.id,
        peerKind: canonicalPeerKind(dialog.peer),
        lastSyncedMessageId: lastMessage.id,
      });
      messagesProcessed += 1;
    }
  }
  return messagesProcessed;
}

interface DurableSyncCursor {
  phase: 'active' | 'archived';
  offset: TelegramDialogOffset | null;
  seenActive: number;
  seenArchived: number;
}

function syncRunPayload(run: TelegramSyncRun) {
  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    mode: run.mode,
    includeArchived: run.includeArchived,
    phase: run.phase,
    fetchedCount: run.fetchedCount,
    persistedCount: run.persistedCount,
    skippedCount: run.skippedCount,
    failedCount: run.failedCount,
    resumeAt: run.resumeAt?.toISOString() ?? null,
    lastErrorCode: run.lastErrorCode,
  };
}

function parseSyncMode(value: string | undefined): SyncMode {
  if (value === undefined) return 'recent';
  if (value === 'recent' || value === 'full') return value;
  throw new Error('--mode must be recent or full.');
}

async function runDurableSyncOnce(
  ctx: AppContext,
  params: { mode: SyncMode; includeArchived: boolean },
): Promise<TelegramSyncRun> {
  const db = requireDb(ctx);
  await migrate(db);
  const accountId = await requireAccountId(ctx);
  let run = await getOrCreateActiveSyncRun(db, { accountId, ...params });

  if (
    run.status === 'waiting_for_telegram' &&
    run.resumeAt &&
    run.resumeAt.getTime() > Date.now()
  ) {
    return run;
  }

  const lockClient = await db.connect();
  const lockKey = `telegram-for-ai-agents:sync:${accountId.toString()}`;
  let lockHeld = false;

  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) as locked`,
      [lockKey],
    );
    if (!lockResult.rows[0]?.locked) return run;
    lockHeld = true;

    const refreshedRun = await getLatestSyncRun(db, {
      accountId,
      runId: run.runId,
    });
    if (!refreshedRun) {
      throw new Error(`Sync run not found: ${run.runId}`);
    }
    run = refreshedRun;
    if (run.status === 'complete' || run.status === 'failed') return run;
    if (
      run.status === 'waiting_for_telegram' &&
      run.resumeAt &&
      run.resumeAt.getTime() > Date.now()
    ) {
      return run;
    }
    const runMode = run.mode;
    const runIncludesArchived = run.includeArchived;

    await ensureAuthorized(ctx.telegram);
    run = await markSyncRunRunning(db, run.runId);
    const codec = cursorCodecForContext(ctx);
    const binding = accountCursorBinding(ctx, `sync:${run.runId}`);

    try {
      const totals = await getTelegramDialogTotals(ctx.telegram);

      while (run.phase === 'active' || run.phase === 'archived') {
        const phase = run.phase;
        const defaultCursor: DurableSyncCursor = {
          phase,
          offset: null,
          seenActive: 0,
          seenArchived: 0,
        };
        const cursor = run.cursorToken
          ? codec.decode<DurableSyncCursor>(run.cursorToken, 'sync.once', binding)
          : defaultCursor;
        if (cursor.phase !== phase) {
          throw new Error('Stored sync cursor phase does not match the durable run.');
        }

        let page;
        try {
          page = await fetchTelegramDialogFolderPage(ctx.telegram, {
            location: phase,
            limit: 100,
            offset: cursor.offset,
          });
        } catch (error) {
          const rateLimit = telegramRateLimit(error);
          if (!rateLimit) throw error;
          return markSyncRunWaiting(db, {
            runId: run.runId,
            resumeAt: new Date(Date.now() + rateLimit.waitMs),
            errorCode: rateLimit.code,
          });
        }

        const seenActive =
          cursor.seenActive + (phase === 'active' ? page.dialogs.length : 0);
        const seenArchived =
          cursor.seenArchived + (phase === 'archived' ? page.dialogs.length : 0);
        const available = phase === 'active' ? totals.activeTotal : totals.archivedTotal;
        const exhausted =
          runMode === 'recent' ||
          page.dialogs.length === 0 ||
          !page.nextOffset ||
          (phase === 'active' ? seenActive : seenArchived) >= available;
        const nextPhase = exhausted
          ? phase === 'active' && runIncludesArchived
            ? 'archived'
            : runMode === 'full'
              ? 'contacts'
              : 'complete'
          : phase;
        const nextCursorToken = exhausted
          ? null
          : codec.encode<DurableSyncCursor>('sync.once', binding, {
              phase,
              offset: page.nextOffset,
              seenActive,
              seenArchived,
            });

        run = await commitDialogInventoryPage(db, {
          run,
          phase,
          dialogs: page.dialogs.map(mapDialogInventoryItem),
          nextPhase,
          nextCursorToken,
          activeAvailableCount: totals.activeTotal,
          archivedAvailableCount: totals.archivedTotal,
        });
      }

      if (run.phase === 'contacts') {
        let contacts;
        try {
          contacts = (await getTelegramContacts(ctx.telegram)).map(mapTelegramContact);
        } catch (error) {
          const rateLimit = telegramRateLimit(error);
          if (!rateLimit) throw error;
          return markSyncRunWaiting(db, {
            runId: run.runId,
            resumeAt: new Date(Date.now() + rateLimit.waitMs),
            errorCode: rateLimit.code,
          });
        }
        run = await commitContactSnapshot(db, { run, contacts });
      }

      return run;
    } catch (error) {
      const rateLimit = telegramRateLimit(error);
      if (rateLimit) {
        return markSyncRunWaiting(db, {
          runId: run.runId,
          resumeAt: new Date(Date.now() + rateLimit.waitMs),
          errorCode: rateLimit.code,
        });
      }
      return markSyncRunFailed(db, {
        runId: run.runId,
        errorCode:
          error instanceof Error && error.message.includes('AUTH')
            ? 'TELEGRAM_AUTH_FAILED'
            : 'SYNC_FAILED',
      });
    }
  } finally {
    if (!lockHeld) {
      lockClient.release();
    } else {
      try {
        await lockClient.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
          [lockKey],
        );
        lockClient.release();
      } catch (error) {
        lockClient.release(error as Error);
      }
    }
  }
}

export async function runSync(ctx: AppContext, args: string[]): Promise<void> {
  requireDb(ctx);
  const sub = args[0];
  if (!sub) {
    throw new Error('Usage: tgchats sync <backfill|once|tail> ...');
  }

  if (sub === 'backfill') {
    await ensureAuthorized(ctx.telegram);
    const parsed = parseCommandArgs(args.slice(1), ['--per-chat-limit', '--dialogs']);
    const perChatLimit = optionValue(parsed, ['--per-chat-limit'])
      ? parsePositiveInt(optionValue(parsed, ['--per-chat-limit'])!, '--per-chat-limit')
      : 100;
    const dialogsLimit = optionValue(parsed, ['--dialogs'])
      ? parsePositiveInt(optionValue(parsed, ['--dialogs'])!, '--dialogs')
      : 200;

    const db = requireDb(ctx);
    const accountId = await requireAccountId(ctx);
    const backoffs: TelegramBackoffEvent[] = [];
    const selectedResult = await withTelegramRateLimitBackoff(
      'sync.backfill.dialogs',
      () => listDialogs(ctx.telegram, {
        all: false,
        includeArchived: true,
        limit: dialogsLimit,
      }),
      {
        onBackoff: (event) => {
          if (!ctx.config.jsonOutput) {
            console.error(
              `Telegram rate limit while listing dialogs; retrying in ${Math.ceil(event.waitMs / 1000)}s (${event.code}).`,
            );
          }
        },
      },
    );

    if (!selectedResult.ok) {
      if (ctx.config.jsonOutput) {
        printJson({
          ok: false,
          mode: 'backfill',
          code: 'TELEGRAM_RATE_LIMIT',
          error: 'Telegram rate limit while listing dialogs.',
          retryAfterMs: selectedResult.retryAfterMs,
          telegramCode: selectedResult.code,
          rateLimitBackoffs: selectedResult.backoffs.map(backoffEventPayload),
        });
        return;
      }
      console.error(
        `Telegram rate limit while listing dialogs; retry after ${Math.ceil(selectedResult.retryAfterMs / 1000)}s (${selectedResult.code}).`,
      );
      return;
    }

    const selected = selectedResult.value;
    backoffs.push(...selectedResult.backoffs);
    const skippedDialogs: Array<{
      peerId: number;
      displayName: string;
      code: string;
      retryAfterMs: number;
    }> = [];

    let insertedMessages = 0;
    for (const dialog of selected) {
      await upsertPeer(db, { accountId, peer: dialog.peer });
      await upsertDialog(db, { accountId, dialog });

      const historyResult = await withTelegramRateLimitBackoff(
        `sync.backfill.history:${dialog.peer.id}`,
        () => fetchChatHistory(ctx.telegram, {
          chatId: String(dialog.peer.id),
          limit: perChatLimit,
        }),
        {
          onBackoff: (event) => {
            if (!ctx.config.jsonOutput) {
              console.error(
                `Telegram rate limit while backfilling ${dialog.peer.displayName}; retrying in ${Math.ceil(event.waitMs / 1000)}s (${event.code}).`,
              );
            }
          },
        },
      );

      backoffs.push(...historyResult.backoffs);
      if (!historyResult.ok) {
        skippedDialogs.push({
          peerId: dialog.peer.id,
          displayName: dialog.peer.displayName,
          code: historyResult.code,
          retryAfterMs: historyResult.retryAfterMs,
        });
        if (!ctx.config.jsonOutput) {
          console.error(
            `Skipped ${dialog.peer.displayName} after Telegram rate limit; retry after ${Math.ceil(historyResult.retryAfterMs / 1000)}s (${historyResult.code}).`,
          );
        }
        continue;
      }

      const messages = historyResult.value;
      for (const message of messages) {
        await insertMessage(db, { accountId, peer: dialog.peer, message });
        insertedMessages += 1;
      }

      await updateSyncCursor(db, {
        accountId,
        peerId: dialog.peer.id,
        peerKind: canonicalPeerKind(dialog.peer),
        lastSyncedMessageId: messages[0]?.id,
      });
      if (!ctx.config.jsonOutput) {
        console.log(`Backfilled ${dialog.peer.displayName}: ${messages.length} messages`);
      }
    }

    if (ctx.config.jsonOutput) {
      printJson({
        ok: true,
        mode: 'backfill',
        partial: skippedDialogs.length > 0,
        dialogs: selected.length,
        skippedDialogs,
        messagesProcessed: insertedMessages,
        rateLimitBackoffs: backoffs.map(backoffEventPayload),
      });
      return;
    }
    console.log(
      `Backfill complete. Dialogs=${selected.length}, messages processed=${insertedMessages}.`,
    );
    return;
  }

  if (sub === 'once') {
    const parsed = parseCommandArgs(args.slice(1), ['--mode']);
    const mode = parseSyncMode(optionValue(parsed, ['--mode']));
    const includeArchived = parsed.flags.has('--exclude-archived')
      ? false
      : true;
    if (
      parsed.flags.has('--include-archived') &&
      parsed.flags.has('--exclude-archived')
    ) {
      throw new Error('Use only one of --include-archived or --exclude-archived.');
    }
    const run = await runDurableSyncOnce(ctx, { mode, includeArchived });
    if (ctx.config.jsonOutput) {
      printJson(syncRunPayload(run));
      return;
    }
    console.log(
      `Sync ${run.runId}: ${run.status}; persisted=${run.persistedCount}, fetched=${run.fetchedCount}.`,
    );
    return;
  }

  if (sub === 'status') {
    const parsed = parseCommandArgs(args.slice(1), ['--run-id']);
    const db = requireDb(ctx);
    await migrate(db);
    const accountId = await requireAccountId(ctx);
    const run = await getLatestSyncRun(db, {
      accountId,
      runId: optionValue(parsed, ['--run-id']),
    });
    if (!run) {
      throw new Error('No Telegram sync run was found for this account.');
    }
    if (ctx.config.jsonOutput) {
      printJson(syncRunPayload(run));
      return;
    }
    console.log(
      `Sync ${run.runId}: ${run.status}; persisted=${run.persistedCount}, fetched=${run.fetchedCount}.`,
    );
    return;
  }

  if (sub === 'tail') {
    await ensureAuthorized(ctx.telegram);
    const parsed = parseCommandArgs(args.slice(1), ['--interval-seconds', '--dialogs']);
    const intervalSeconds = optionValue(parsed, ['--interval-seconds'])
      ? parsePositiveInt(optionValue(parsed, ['--interval-seconds'])!, '--interval-seconds')
      : 60;
    const dialogsLimit = optionValue(parsed, ['--dialogs'])
      ? parsePositiveInt(optionValue(parsed, ['--dialogs'])!, '--dialogs')
      : 200;

    console.log(
      `Starting sync tail loop (interval=${intervalSeconds}s, dialogs=${dialogsLimit}). Press Ctrl+C to stop.`,
    );

    while (true) {
      const writes = await syncOnce(ctx, dialogsLimit);
      console.log(`${new Date().toISOString()} | tail sync wrote ${writes} messages`);
      await sleep(intervalSeconds * 1000);
    }
  }

  throw new Error(`Unknown sync subcommand: ${sub}`);
}
