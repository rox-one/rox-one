import type { AppContext } from "../app/context.js";
import { requireAccountId } from "../app/account.js";
import { getLatestSyncRun, getPersistedInventorySummary } from "../db/inventory.js";
import { migrate } from "../db/migrate.js";
import { printJson } from "../output.js";
import { ensureAuthorized, getTelegramDialogTotals } from "../services/telegram.js";

export async function runInventory(ctx: AppContext, args: string[]): Promise<void> {
  if (args[0] !== "summary" || args.length > 1) {
    throw new Error("Usage: tgchats inventory summary");
  }

  await ensureAuthorized(ctx.telegram);
  const totals = await getTelegramDialogTotals(ctx.telegram);
  const measuredAt = new Date().toISOString();

  let syncedTotal: number | null = null;
  let lastSyncedAt: Date | null = null;
  let latestRun: Awaited<ReturnType<typeof getLatestSyncRun>> = null;
  if (ctx.db) {
    await migrate(ctx.db);
    const accountId = await requireAccountId(ctx);
    const [persisted, run] = await Promise.all([
      getPersistedInventorySummary(ctx.db, accountId),
      getLatestSyncRun(ctx.db, { accountId }),
    ]);
    syncedTotal = persisted.syncedTotal;
    lastSyncedAt = persisted.lastSyncedAt;
    latestRun = run;
  }

  const payload = {
    ok: true,
    telegramDialogs: {
      ...totals,
      measuredAt,
    },
    chihoDialogs: {
      syncedTotal,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    },
    sync: {
      status: latestRun?.status ?? null,
      runId: latestRun?.runId ?? null,
    },
  };

  if (ctx.config.jsonOutput) {
    printJson(payload);
    return;
  }

  console.log(
    `Telegram chats: ${totals.allTotal} total (${totals.activeTotal} active, ${totals.archivedTotal} archived).`,
  );
  console.log(
    syncedTotal === null
      ? "CRM total unavailable because DATABASE_URL is not configured."
      : `Synced in CRM: ${syncedTotal}.`,
  );
}
