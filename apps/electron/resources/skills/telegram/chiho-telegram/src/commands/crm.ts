import type { AppContext } from "../app/context.js";
import { optionValue, parseCommandArgs } from "../app/cli-args.js";
import { requireAccountId } from "../app/account.js";
import { requireDb } from "../app/db.js";
import { listPersistedDialogs } from "../db/inventory.js";
import { migrate } from "../db/migrate.js";
import { printJson } from "../output.js";
import {
  accountCursorBinding,
  cursorCodecForContext,
  parsePageSize,
} from "./inventorySupport.js";

interface CrmDialogCursorState {
  offset: number;
  snapshotVersion: string | null;
}

export async function runCrm(ctx: AppContext, args: string[]): Promise<void> {
  if (args[0] !== "dialogs" || args[1] !== "list") {
    throw new Error("Usage: tgchats crm dialogs list [--page-size N] [--cursor value]");
  }
  const parsed = parseCommandArgs(args.slice(2), ["--page-size", "--cursor"]);
  const pageSize = parsePageSize(optionValue(parsed, ["--page-size"]));
  const cursor = optionValue(parsed, ["--cursor"]);
  const codec = cursorCodecForContext(ctx);
  const binding = accountCursorBinding(ctx, "crm-dialogs");
  const state = cursor
    ? codec.decode<CrmDialogCursorState>(cursor, "crm.dialogs.list", binding)
    : null;
  if (
    state &&
    (!Number.isSafeInteger(state.offset) ||
      state.offset < 0 ||
      (state.snapshotVersion !== null && typeof state.snapshotVersion !== "string"))
  ) {
    throw new Error("The cursor is invalid, expired, or belongs to another account.");
  }

  const db = requireDb(ctx);
  await migrate(db);
  const accountId = await requireAccountId(ctx);
  const result = await listPersistedDialogs(db, {
    accountId,
    limit: pageSize,
    offset: state?.offset ?? 0,
  });
  const snapshotVersion = result.lastSyncedAt?.toISOString() ?? null;
  if (state && state.snapshotVersion !== snapshotVersion) {
    throw new Error("The cursor is invalid, expired, or belongs to another account.");
  }
  const nextOffset = (state?.offset ?? 0) + result.dialogs.length;
  const hasMore = nextOffset < result.total;
  const payload = {
    ok: true,
    source: "chiho-crm",
    syncedTotal: result.total,
    lastSyncedAt: result.lastSyncedAt?.toISOString() ?? null,
    hasMore,
    nextCursor: hasMore
      ? codec.encode("crm.dialogs.list", binding, {
          offset: nextOffset,
          snapshotVersion,
        })
      : null,
    dialogs: result.dialogs,
  };

  if (ctx.config.jsonOutput) {
    printJson(payload);
    return;
  }
  console.log(`Synced CRM chats (${result.total} total):`);
  result.dialogs.forEach((dialog) => console.log(`- ${dialog.peer.displayName}`));
}
