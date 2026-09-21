/**
 * One-shot upgrade migrate: sticky craft-feature-workbench-conation-*=true
 * (and sibling craft-feature-skills-conation-surfaces) must not keep Fund/Board
 * LIVE ON after atom defaults flipped to false.
 *
 * Runs before jotai atomWithStorage getOnInit reads localStorage (see bootstrap.ts).
 * Marker craft-migrate-conation-flags-default-off-v1 makes this idempotent so a
 * user who later opts in keeps ON.
 *
 * Prefer-FAIL: stamp the v1 marker ONLY after a re-scan shows zero sticky-truthy
 * conation keys remain. If setItem/clear failed and leftovers remain, omit the
 * marker so a later boot retries.
 */

import { KEYS, getKeyString } from './local-storage'

/** Persisted once the upgrade wipe has run cleanly. */
export const CONATION_FLAGS_DEFAULT_OFF_MIGRATE_KEY =
  'craft-migrate-conation-flags-default-off-v1'

/** Prefix for workbench conation feature keys (craft- + KEYS suffix). */
export const CONATION_WORKBENCH_KEY_PREFIX = 'craft-feature-workbench-conation-'

/** Canonical KEYS-derived storage strings (defaults must stay false). */
export const CONATION_FEATURE_STORAGE_KEYS: readonly string[] = [
  getKeyString(KEYS.featureWorkbenchConationShell),
  getKeyString(KEYS.featureWorkbenchConationInspector),
  getKeyString(KEYS.featureSkillsConationSurfaces),
  getKeyString(KEYS.featureWorkbenchConationSoupClient),
  getKeyString(KEYS.featureWorkbenchConationNotesBridge),
  getKeyString(KEYS.featureWorkbenchConationDriveRead),
  getKeyString(KEYS.featureWorkbenchConationCanvas),
  getKeyString(KEYS.featureWorkbenchConationBoard),
  getKeyString(KEYS.featureWorkbenchConationMail),
  getKeyString(KEYS.featureWorkbenchConationCal),
  getKeyString(KEYS.featureWorkbenchConationDssClient),
  getKeyString(KEYS.featureWorkbenchConationSessionApply),
] as const

function isStickyTruthy(raw: string | null): boolean {
  if (raw === null) return false
  const trimmed = raw.trim()
  if (trimmed === '') return false
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed === true || parsed === 1 || parsed === 'true'
  } catch {
    return trimmed === 'true' || trimmed === '1'
  }
}

function collectConationKeys(storage: Storage): string[] {
  const found = new Set<string>(CONATION_FEATURE_STORAGE_KEYS)
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (!key) continue
    if (
      key.startsWith(CONATION_WORKBENCH_KEY_PREFIX) ||
      key === getKeyString(KEYS.featureSkillsConationSurfaces)
    ) {
      found.add(key)
    }
  }
  return [...found]
}

function hasStickyTruthyConationKeys(storage: Storage): boolean {
  for (const key of collectConationKeys(storage)) {
    if (isStickyTruthy(storage.getItem(key))) return true
  }
  return false
}

export type MigrateConationFlagsResult = {
  ran: boolean
  cleared: string[]
}

/**
 * Clear/rewrite sticky true → false for conation workbench (+ skills sibling) keys.
 * No-ops after the v1 marker is set. Marker is stamped only when a post-loop
 * re-scan finds zero sticky-truthy conation keys (failed writes omit marker).
 */
export function migrateConationFlagsDefaultOff(
  storage: Storage | null | undefined = typeof globalThis !== 'undefined'
    ? globalThis.localStorage
    : undefined,
): MigrateConationFlagsResult {
  if (!storage || typeof storage.getItem !== 'function') {
    return { ran: false, cleared: [] }
  }

  if (storage.getItem(CONATION_FLAGS_DEFAULT_OFF_MIGRATE_KEY) === '1') {
    return { ran: false, cleared: [] }
  }

  const cleared: string[] = []
  for (const key of collectConationKeys(storage)) {
    if (!isStickyTruthy(storage.getItem(key))) continue
    try {
      storage.setItem(key, JSON.stringify(false))
      cleared.push(key)
    } catch {
      // Quota / private mode — leave sticky key; omit marker so later boot retries.
    }
  }

  // Prefer-FAIL: only stamp v1 after a clean re-scan (no sticky-truthy leftovers).
  if (!hasStickyTruthyConationKeys(storage)) {
    try {
      storage.setItem(CONATION_FLAGS_DEFAULT_OFF_MIGRATE_KEY, '1')
    } catch {
      // ignore — without marker a later boot will retry
    }
  }

  return { ran: true, cleared }
}
