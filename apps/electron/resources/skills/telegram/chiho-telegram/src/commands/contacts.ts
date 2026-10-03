import { createHash } from "node:crypto";
import type { AppContext } from "../app/context.js";
import { optionValue, parseCommandArgs } from "../app/cli-args.js";
import { printJson } from "../output.js";
import { ensureAuthorized, getTelegramContacts, mapTelegramContact } from "../services/telegram.js";
import {
  accountCursorBinding,
  cursorCodecForContext,
  parsePageSize,
} from "./inventorySupport.js";

interface ContactCursorState {
  offset: number;
  fingerprint: string;
}

function contactFingerprint(
  contacts: Array<{ peerId: string; displayName: string; username: string | null }>,
): string {
  return createHash("sha256").update(JSON.stringify(contacts)).digest("base64url");
}

export async function runContacts(ctx: AppContext, args: string[]): Promise<void> {
  const sub = args[0];
  if (sub !== "count" && sub !== "list") {
    throw new Error("Usage: tgchats contacts <count|list> [--page-size N] [--cursor value]");
  }

  await ensureAuthorized(ctx.telegram);
  const contacts = (await getTelegramContacts(ctx.telegram))
    .map(mapTelegramContact)
    .sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName) ||
        left.peerId.localeCompare(right.peerId),
    );

  if (sub === "count") {
    const payload = {
      ok: true,
      source: "telegram-contacts",
      contactTotal: contacts.length,
      fetchedAt: new Date().toISOString(),
    };
    if (ctx.config.jsonOutput) {
      printJson(payload);
      return;
    }
    console.log(`Telegram contacts: ${contacts.length}.`);
    return;
  }

  const parsed = parseCommandArgs(args.slice(1), ["--page-size", "--cursor"]);
  const pageSize = parsePageSize(optionValue(parsed, ["--page-size"]));
  const cursor = optionValue(parsed, ["--cursor"]);
  const codec = cursorCodecForContext(ctx);
  const binding = accountCursorBinding(ctx, "contacts");
  const fingerprint = contactFingerprint(contacts);
  const state = cursor
    ? codec.decode<ContactCursorState>(cursor, "contacts.list", binding)
    : { offset: 0, fingerprint };
  if (
    !Number.isSafeInteger(state.offset) ||
    state.offset < 0 ||
    typeof state.fingerprint !== "string" ||
    state.fingerprint !== fingerprint
  ) {
    throw new Error("The cursor is invalid, expired, or belongs to another account.");
  }

  const page = contacts.slice(state.offset, state.offset + pageSize);
  const nextOffset = state.offset + page.length;
  const hasMore = nextOffset < contacts.length;
  const payload = {
    ok: true,
    source: "telegram-contacts",
    contactTotal: contacts.length,
    hasMore,
    nextCursor: hasMore
      ? codec.encode("contacts.list", binding, {
          offset: nextOffset,
          fingerprint,
        })
      : null,
    contacts: page,
  };

  if (ctx.config.jsonOutput) {
    printJson(payload);
    return;
  }
  console.log(`Telegram contacts (${contacts.length} total):`);
  page.forEach((contact) => console.log(`- ${contact.displayName}`));
}
