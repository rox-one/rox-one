import type { AppContext } from '../app/context.js';
import { optionValue, parseCommandArgs } from '../app/cli-args.js';
import {
  listTelegramDialogInventoryPage,
  type DialogInventoryCursorState,
} from '../services/dialogInventory.js';
import type { TelegramDialogLocation } from '../services/telegram.js';
import { ensureAuthorized } from '../services/telegram.js';
import { printJson } from '../output.js';
import {
  accountCursorBinding,
  cursorCodecForContext,
  parsePageSize,
} from './inventorySupport.js';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export async function runInbox(ctx: AppContext, args: string[] = []): Promise<void> {
  await ensureAuthorized(ctx.telegram);
  const parsed = parseCommandArgs(args, [
    '--location',
    '--page-size',
    '--cursor',
    '--limit',
    '-n',
  ]);
  const rawLocation = optionValue(parsed, ['--location']);
  const location = (rawLocation ?? (ctx.config.all ? 'all' : 'active')) as TelegramDialogLocation;
  if (!['active', 'archived', 'all'].includes(location)) {
    throw new Error('--location must be active, archived, or all.');
  }
  const legacyLimit = optionValue(parsed, ['--limit', '-n']);
  const pageSize = parsePageSize(
    optionValue(parsed, ['--page-size']) ?? legacyLimit,
    ctx.config.limit,
  );
  const cursor = optionValue(parsed, ['--cursor']);
  const codec = cursorCodecForContext(ctx);
  const binding = accountCursorBinding(ctx, `dialogs:${location}`);
  const state = cursor
    ? codec.decode<DialogInventoryCursorState>(cursor, 'dialogs.list', binding)
    : null;
  const page = await listTelegramDialogInventoryPage(ctx.telegram, {
    location,
    pageSize,
    state,
  });
  const payload = {
    ok: true,
    source: 'telegram',
    location,
    inventoryTotal: page.inventoryTotal,
    hasMore: page.nextState !== null,
    nextCursor: page.nextState
      ? codec.encode('dialogs.list', binding, page.nextState)
      : null,
    dialogs: page.dialogs,
  };

  if (ctx.config.jsonOutput) {
    printJson(payload);
    return;
  }

  if (page.dialogs.length === 0) {
    console.log(`No ${location} chats found (${page.inventoryTotal} total).`);
    return;
  }
  console.log(`${location === 'all' ? 'All' : location} Telegram chats (${page.inventoryTotal} total):`);
  for (const dialog of page.dialogs) {
    const when = dialog.lastMessage
      ? formatDate(new Date(dialog.lastMessage.date))
      : 'N/A';
    console.log(`- ${dialog.peer.displayName}`);
    console.log(`  ${when} | ${dialog.lastMessage?.preview ?? '[no messages yet]'}`);
  }
}
