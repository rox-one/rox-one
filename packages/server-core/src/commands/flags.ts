/**
 * W1-03 (#1500) — Live flag source for the local command bus.
 *
 * Read on every call (never a registration-time snapshot). Hosts that track
 * the renderer's workbench flags install a source; otherwise only the
 * `CRAFT_FEATURE_COMMAND_BUS` env override applies (default OFF).
 */

import { isCommandBusEnabled } from '@rox/shared/feature-flags'

let source: (() => ReadonlySet<string> | undefined) | null = null

export function setCommandBusFlagSource(next: (() => ReadonlySet<string> | undefined) | null): void {
  source = next
}

export function getCommandBusFlags(): ReadonlySet<string> {
  try { return source?.() ?? new Set() } catch { return new Set() }
}

/** Bus switch: `commands.bus.v1` (or the env override). */
export function isLocalCommandBusEnabled(): boolean {
  return isCommandBusEnabled(getCommandBusFlags())
}

/** Owner-module flag lookup for capability discovery. */
export function isCommandModuleFlagEnabled(flag: string): boolean {
  return getCommandBusFlags().has(flag)
}
