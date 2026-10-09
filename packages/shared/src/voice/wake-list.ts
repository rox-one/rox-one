/**
 * Voice wake list — the bounded set of on-device trigger phrases and where a
 * match is routed. Recognition itself is device-local and foreground-gated
 * (`policy.canStartWakeListening`); this module only owns the list contract.
 *
 * Limits: at most 32 triggers, each at most 64 UTF-16 code units after NFC
 * normalization, whitespace collapse and case-insensitive de-duplication.
 *
 * Provenance: OpenClaw `src/gateway/server-methods/voicewake.ts`, `src/infra/voicewake.ts`
 * (clean-room re-expression; ledger d1.6).
 */

export const MAX_WAKE_TRIGGERS = 32
export const MAX_WAKE_TRIGGER_UNITS = 64

export type VoiceWakeRouting = 'session' | 'agent' | 'none'

export interface VoiceWakeList {
  triggers: string[]
  routing: VoiceWakeRouting
  updatedAt: number
  revision: number
}

/** Payload of `voice:wakeChanged` (matches the renderer's `{ enabled, names }`). */
export interface VoiceWakeChangedPayload {
  enabled: boolean
  names: string[]
}

export interface VoiceWakeTrigger {
  trigger: string
  /** Routing target the trigger was configured with. */
  routing?: VoiceWakeRouting
  sessionId?: string
  workContentsId?: number
  at: number
}

const ROUTING: Record<VoiceWakeRouting, true> = { session: true, agent: true, none: true }

export function isVoiceWakeRouting(value: unknown): value is VoiceWakeRouting {
  return typeof value === 'string' && ROUTING[value as VoiceWakeRouting] === true
}

/** NFC, strip control characters, collapse whitespace, clamp to 64 code units. */
export function normalizeWakeTrigger(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let text = value.normalize('NFC').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length > MAX_WAKE_TRIGGER_UNITS) {
    text = text.slice(0, MAX_WAKE_TRIGGER_UNITS)
    // Never end on a lone high surrogate: the cut split a surrogate pair.
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
    text = text.trimEnd()
  }
  return text || null
}

export interface NormalizeWakeListInput {
  triggers?: unknown
  routing?: unknown
  updatedAt?: unknown
  revision?: unknown
}

export interface NormalizeWakeListResult {
  list: VoiceWakeList
  /** Triggers dropped by the cap or by de-duplication. */
  dropped: number
}

/**
 * Normalize, de-duplicate (case-insensitively, first spelling wins) and cap a
 * wake list. `updatedAt` advances only when the normalized content changes, so a
 * no-op set never bumps the revision.
 */
export function normalizeWakeList(input: NormalizeWakeListInput, previous?: VoiceWakeList, now = Date.now()): NormalizeWakeListResult {
  const raw = Array.isArray(input.triggers) ? input.triggers : previous?.triggers ?? []
  const seen = new Set<string>()
  const triggers: string[] = []
  let dropped = 0
  for (const candidate of raw) {
    const normalized = normalizeWakeTrigger(candidate)
    if (!normalized) { dropped += 1; continue }
    const key = normalized.toLowerCase()
    if (seen.has(key)) { dropped += 1; continue }
    if (triggers.length >= MAX_WAKE_TRIGGERS) { dropped += 1; continue }
    seen.add(key)
    triggers.push(normalized)
  }
  const routing = isVoiceWakeRouting(input.routing)
    ? input.routing
    : previous?.routing ?? 'session'
  const keys = triggers.map((trigger) => trigger.toLowerCase())
  const changed = !previous || previous.routing !== routing
    || previous.triggers.length !== triggers.length
    || previous.triggers.some((trigger, index) => trigger.toLowerCase() !== keys[index])
  if (!changed && previous) return { list: previous, dropped }
  return {
    list: {
      triggers,
      routing,
      updatedAt: now,
      revision: previous ? previous.revision + 1 : 1,
    },
    dropped,
  }
}

export function defaultVoiceWakeList(now = Date.now()): VoiceWakeList {
  return { triggers: [], routing: 'session', updatedAt: now, revision: 1 }
}

export function toWakeChangedPayload(list: VoiceWakeList, enabled: boolean): VoiceWakeChangedPayload {
  return { enabled, names: [...list.triggers] }
}

function isWordUnit(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_]/u.test(char)
}

function matchesAt(haystack: string, needle: string, index: number): boolean {
  if (index < 0) return false
  const before = index > 0 ? haystack[index - 1] : undefined
  const after = haystack[index + needle.length]
  if (isWordUnit(needle[0]) && isWordUnit(before)) return false
  if (isWordUnit(needle[needle.length - 1]) && isWordUnit(after)) return false
  return true
}

/** Returns the first wake trigger present in `text`, or null. Case-insensitive. */
export function matchesWakeTrigger(list: Pick<VoiceWakeList, 'triggers'>, text: string): string | null {
  if (typeof text !== 'string' || !text) return null
  const haystack = text.normalize('NFC').toLowerCase()
  for (const trigger of list.triggers) {
    const needle = trigger.toLowerCase()
    if (!needle) continue
    let index = haystack.indexOf(needle)
    while (index !== -1) {
      if (matchesAt(haystack, needle, index)) return trigger
      index = haystack.indexOf(needle, index + 1)
    }
  }
  return null
}