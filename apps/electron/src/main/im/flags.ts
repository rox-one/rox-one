/**
 * Effective main-process state of `workbench.mode.messenger.v1` (deliverable 4).
 *
 * The renderer owns the persisted toggle; main must nonetheless gate the native
 * chat-core relay without importing the renderer atom graph. Resolution order:
 *
 * 1. explicit `CRAFT_FEATURE_MODE_MESSENGER=1|0` env override (tests/dev),
 * 2. an enabled workbench-flag set published via `setImEnabledWorkbenchFlags`
 *    (the host mirrors the renderer toggle here when it has one),
 * 3. the flag's declared default — ON (mirrors
 *    `WORKBENCH_FEATURE_FLAGS` for `WORKBENCH_FLAG.modeMessengerV1`).
 *
 * The id is read from `WORKBENCH_FLAG` (zero-dep pure-TS platform layer), the
 * same source of truth the renderer and the Rust evaluator use.
 */

import { WORKBENCH_FLAG } from '@rox/core/platform'

export const MODE_MESSENGER_WORKBENCH_FLAG: string = WORKBENCH_FLAG.modeMessengerV1

/** Explicit env override key (mirrors the `CRAFT_FEATURE_*` family). */
export const MODE_MESSENGER_ENV_KEY = 'CRAFT_FEATURE_MODE_MESSENGER'

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

let published: ReadonlySet<string> | null = null

/** Publish the host's enabled workbench-flag set (null = fall back to default). */
export function setImEnabledWorkbenchFlags(flags: Iterable<string> | null): void {
  published = flags ? new Set(flags) : null
}

/** Test seam: clear any published flag set. */
export function resetImEnabledWorkbenchFlagsForTests(): void {
  published = null
}

/**
 * Whether the native messenger relay is enabled. Env override wins; otherwise
 * the published flag set (when present) decides; with neither, the flag's
 * declared default (ON) applies.
 */
export function isModeMessengerEnabled(
  enabledFlags: ReadonlySet<string> | undefined = published ?? undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const override = parseBooleanEnv(env[MODE_MESSENGER_ENV_KEY])
  if (override !== undefined) return override
  if (enabledFlags) return enabledFlags.has(MODE_MESSENGER_WORKBENCH_FLAG)
  return true
}
