/**
 * Dev Space analytics — local-only, opt-in diagnostics.
 *
 * Follows the product-tour precedent (`features/product-tour/analytics`):
 * a finite allowlist sanitizer, event identity bounded in memory, and no
 * remote egress. Only enums/booleans survive sanitization — never repo names,
 * paths, URLs or correlation ids (02-SPEC-foundations §12).
 *
 * Wave В1 ships the two events the ingest surface emits; later waves extend
 * the allowlist as their features land.
 */

export const DEV_SPACE_ANALYTICS_STORAGE_KEY = 'craft-devspace-analytics-enabled'
export const MAX_DEV_SPACE_DIAGNOSTICS = 500

export const DEV_SPACE_SOURCE_KINDS = ['git-url', 'local-folder'] as const
export type DevSpaceSourceKind = typeof DEV_SPACE_SOURCE_KINDS[number]

/**
 * Kinds of the local `devSpace:softSignal` nudge. The signal only ever carries
 * this finite enum — never a repo name, URL or path (02-SPEC-foundations §12).
 */
export const DEV_SPACE_SOFT_SIGNAL_KINDS = ['repo-link-pasted', 'git-detected'] as const
export type DevSpaceSoftSignalKind = typeof DEV_SPACE_SOFT_SIGNAL_KINDS[number]

export const DEV_SPACE_EVENT_NAMES = ['devspace.repo-added', 'devspace.clone-finished', 'devSpace:softSignal'] as const
export type DevSpaceEventName = typeof DEV_SPACE_EVENT_NAMES[number]

export interface DevSpaceRepoAddedEvent {
  readonly eventName: 'devspace.repo-added'
  readonly sourceKind: DevSpaceSourceKind
}
export interface DevSpaceCloneFinishedEvent {
  readonly eventName: 'devspace.clone-finished'
  readonly ok: boolean
}
export interface DevSpaceSoftSignalEvent {
  readonly eventName: 'devSpace:softSignal'
  readonly kind: DevSpaceSoftSignalKind
}
export type SafeDevSpaceEvent = DevSpaceRepoAddedEvent | DevSpaceCloneFinishedEvent | DevSpaceSoftSignalEvent
export type DevSpaceDiagnostic = SafeDevSpaceEvent & { readonly at: number }

/** Rebuild from finite enums; never spread a signal, path, URL or error into a logger. */
export function sanitizeDevSpaceEvent(input: unknown): SafeDevSpaceEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input)
    const source: Record<string, unknown> = Object.create(null)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor.enumerable && Object.hasOwn(descriptor, 'value')) source[key] = descriptor.value
    }
    if (source.eventName === 'devspace.repo-added') {
      return (DEV_SPACE_SOURCE_KINDS as readonly unknown[]).includes(source.sourceKind)
        ? { eventName: 'devspace.repo-added', sourceKind: source.sourceKind as DevSpaceSourceKind }
        : null
    }
    if (source.eventName === 'devspace.clone-finished') {
      return typeof source.ok === 'boolean'
        ? { eventName: 'devspace.clone-finished', ok: source.ok }
        : null
    }
    if (source.eventName === 'devSpace:softSignal') {
      return (DEV_SPACE_SOFT_SIGNAL_KINDS as readonly unknown[]).includes(source.kind)
        ? { eventName: 'devSpace:softSignal', kind: source.kind as DevSpaceSoftSignalKind }
        : null
    }
    return null
  } catch { return null }
}

export function isDevSpaceAnalyticsEnabled(): boolean {
  try { return globalThis.localStorage?.getItem(DEV_SPACE_ANALYTICS_STORAGE_KEY) === 'true' } catch { return false }
}

export function setDevSpaceAnalyticsEnabled(enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage?.setItem(DEV_SPACE_ANALYTICS_STORAGE_KEY, 'true')
    else globalThis.localStorage?.removeItem(DEV_SPACE_ANALYTICS_STORAGE_KEY)
  } catch { /* opt-in stays off when the local store is unavailable */ }
}

const diagnostics: DevSpaceDiagnostic[] = []

/**
 * Record a sanitized local diagnostic when the user opted in.
 * No-op otherwise; unknown fields/events are dropped by the sanitizer.
 */
export function emitDevSpaceEvent(input: unknown): void {
  const event = sanitizeDevSpaceEvent(input)
  if (!event || !isDevSpaceAnalyticsEnabled()) return
  diagnostics.push({ ...event, at: Date.now() })
  if (diagnostics.length > MAX_DEV_SPACE_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DEV_SPACE_DIAGNOSTICS)
}

export function readDevSpaceDiagnostics(): readonly DevSpaceDiagnostic[] {
  return [...diagnostics]
}

export function clearDevSpaceDiagnostics(): void {
  diagnostics.length = 0
}