/**
 * Node capability model — port row e2.4, part 1 (the model half).
 *
 * A clean-room re-expression of the OpenClaw node capability model. It maps
 * honest, host-reported permission *statuses* onto a set of capabilities a node
 * may advertise, without ever claiming more than the OS actually reported:
 *
 * - `unknown` means the host could not classify a permission; it is NOT a
 *   denial, so it is dropped instead of being advertised as `denied`.
 * - `unsupported` means the platform has no such concept; it is never a grant.
 * - A `denied` reading is authoritative: a later `granted` reading for the same
 *   capability is a false upgrade and is discarded, never advertised.
 *
 * Everything here is pure data + pure functions: no `electron`, no I/O.
 */

/** Honest, OS/host-reported state of one capability. */
export type CapabilityStatus = 'granted' | 'denied' | 'unknown' | 'unsupported'

/**
 * OS-mediated permissions the IPC/permission surface can ask the user for.
 * These are the keys the onboarding prompts act on.
 */
export type IpcCapability =
  | 'notifications'
  | 'accessibility'
  | 'screenRecording'
  | 'microphone'
  | 'speechRecognition'
  | 'camera'
  | 'location'

/** Canonical declaration order for the IPC permission set. */
export const IPC_CAPABILITIES: readonly IpcCapability[] = [
  'notifications',
  'accessibility',
  'screenRecording',
  'microphone',
  'speechRecognition',
  'camera',
  'location',
] as const

/**
 * Functional capabilities a node advertises on registration (`declaredCaps`).
 * These are CLAIMS about what the node can do; the server allowlist stays
 * authoritative. The set is deliberately conservative: only capabilities the
 * node surface actually backs.
 */
export type NodeCapability =
  | 'canvas'
  | 'browser'
  | 'camera'
  | 'screen'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'clipboard'

/** Canonical declaration order for the node capability set. */
export const NODE_CAPABILITIES: readonly NodeCapability[] = [
  'canvas',
  'browser',
  'camera',
  'screen',
  'microphone',
  'location',
  'notifications',
  'clipboard',
] as const

/** Any modelled capability id (IPC permission or node capability). */
export type CapabilityKey = IpcCapability | NodeCapability

/**
 * Canonical, de-duplicated ordering used for every resolved output. A key that
 * is not modelled (e.g. an onboarding-only permission) still resolves, and is
 * appended after the modelled keys in a deterministic order.
 */
export const CAPABILITY_ORDER: readonly string[] = (() => {
  const order: string[] = []
  const seen: Record<string, true> = {}
  for (const key of [...IPC_CAPABILITIES, ...NODE_CAPABILITIES]) {
    if (seen[key]) continue
    seen[key] = true
    order.push(key)
  }
  return order
})()

/** One snapshot of raw, host-reported statuses keyed by capability id. */
export type CapabilityStatuses = Readonly<Record<string, CapabilityStatus>>

/** A single snapshot or an ordered history of snapshots (oldest → newest). */
export type CapabilityStatusInput = CapabilityStatuses | readonly CapabilityStatuses[]

/** Conservative resolution: definitive grants and definitive denials. */
export interface ResolvedCapabilities {
  /** Capabilities with a definitive grant, in canonical order. */
  readonly granted: readonly string[]
  /** Capabilities with a definitive denial, in canonical order. */
  readonly denied: readonly string[]
}

/**
 * Resolve one snapshot (or an ordered history of snapshots) into definitive
 * grants and denials.
 *
 * - `unknown` and `unsupported` readings are dropped (unknown ≠ denied);
 * - a `denied` reading latches: a later `granted` reading for the same key is
 *   a false upgrade and cannot flip it back to granted;
 * - output order is canonical and deterministic.
 */
export function resolvedCaps(statuses: CapabilityStatusInput): ResolvedCapabilities {
  const snapshots = Array.isArray(statuses) ? statuses : [statuses]
  const keys: Record<string, true> = {}
  const state: Record<string, 'granted' | 'denied'> = {}

  for (const snapshot of snapshots) {
    for (const [key, raw] of Object.entries(snapshot)) {
      keys[key] = true
      if (raw !== 'granted' && raw !== 'denied') continue // drops unknown/unsupported and narrows the type
      if (state[key] === 'denied') continue // denial is final within the resolution
      state[key] = raw
    }
  }

  const ordered = Object.keys(keys).sort((a, b) => {
    const rankA = CAPABILITY_ORDER.indexOf(a)
    const rankB = CAPABILITY_ORDER.indexOf(b)
    const rank = (rankA === -1 ? Number.MAX_SAFE_INTEGER : rankA) - (rankB === -1 ? Number.MAX_SAFE_INTEGER : rankB)
    return rank !== 0 ? rank : a < b ? -1 : a > b ? 1 : 0
  })

  const granted: string[] = []
  const denied: string[] = []
  for (const key of ordered) {
    // Unresolved keys (only unknown/unsupported readings) are dropped entirely.
    if (state[key] === 'granted') granted.push(key)
    else if (state[key] === 'denied') denied.push(key)
  }
  return { granted, denied }
}

/**
 * The capabilities safe to advertise as granted: the resolved grants, in
 * canonical order. `unknown`/`unsupported` readings are dropped and a `denied`
 * capability is never advertised, even if a later reading claimed a grant.
 */
export function advertisedPermissions(statuses: CapabilityStatusInput): readonly string[] {
  return resolvedCaps(statuses).granted
}