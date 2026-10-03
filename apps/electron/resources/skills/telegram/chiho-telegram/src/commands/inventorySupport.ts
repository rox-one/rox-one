import type { AppContext } from "../app/context.js";
import { createOpaqueCursorCodec } from "../services/opaqueCursor.js";

export function accountCursorBinding(ctx: AppContext, suffix = "") {
  return `${ctx.config.accountLabel}${suffix ? `:${suffix}` : ""}`;
}
export function cursorCodecForContext(ctx: AppContext) {
  const secretMaterial = [
    ctx.config.apiHash ?? "local-session",
    ctx.config.sessionPath,
    ctx.config.accountLabel,
  ].join("\0");
  return createOpaqueCursorCodec(secretMaterial);
}

export function parsePageSize(value: string | undefined, fallback = 100) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("--page-size must be an integer between 1 and 100.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 100) {
    throw new Error("--page-size must be an integer between 1 and 100.");
  }
  return parsed;
}
