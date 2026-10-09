/**
 * Q&A slot synthesis (requirement E, part 2).
 *
 * The package never talks to a model itself: the host injects a
 * {@link SynthesisCompletion}. When no completion is supplied (offline runs,
 * tests, a user who has not configured a model) the deterministic candidates
 * from {@link deriveSlotCandidates} are persisted unchanged and the result is
 * flagged `degraded`. When a completion runs, the response is parsed robustly
 * and merged on top of those candidates, so a partial or malformed model reply
 * can never lose the deterministic floor or throw.
 */

import { aggregateMetrics, clamp01 } from './aggregate.ts'
import type { IntelligenceStore } from '../db/repositories.ts'
import { PROFILE_SLOT_IDS } from '../types.ts'
import type {
  InsightMetrics,
  ProfileSlotRecord,
  SlotCandidate,
  SynthesisCompletion,
  SynthesisResult,
} from '../types.ts'

export interface SynthesizeSlotsInput {
  store: IntelligenceStore
  /** Model callback; absent means a deterministic, degraded run. */
  completion?: SynthesisCompletion
  /** Pre-computed metrics; recomputed from the store when omitted. */
  metrics?: InsightMetrics
  /** Lookback window used when metrics are recomputed (default 30). */
  windowDays?: number
  /** Clock override: an epoch-ms value or a `() => epochMs` provider. */
  now?: number | (() => number)
  /** Model identity stamped onto synthesized slots. */
  model?: string | null
}

const SYNTHESIS_SYSTEM = [
  'You maintain a persistent cognitive profile of a user by reasoning only over the browser-history metrics you are given.',
  'Respond with exactly one JSON object and nothing else — no prose, no markdown fences.',
  'The object MUST contain exactly these five keys: tech_stack, pain_points_acute, communication_archetype, humor_slots, steer_policy.',
  'Every value MUST be an object of shape {"value": <any>, "confidence": <number between 0 and 1>, "evidence": [<short strings>]}.',
  'Ground every claim in the supplied metrics: quote the domains, queries and counts that support it.',
  'Never invent a domain, query or number that is not present in the metrics; lower the confidence instead of guessing.',
].join('\n')

function resolveNow(now?: number | (() => number)): number {
  if (typeof now === 'function') return now()
  return typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
}

function toSlotRecord(slot: string, model: string | null, now: number, candidate: SlotCandidate): ProfileSlotRecord {
  return {
    slot,
    value: candidate.value,
    confidence: clamp01(candidate.confidence),
    evidence: candidate.evidence,
    updatedAt: now,
    version: 1,
    model,
  }
}

/**
 * Build the two-part prompt for one synthesis call.
 *
 * The digest strips the deterministic candidates out of the metrics payload and
 * passes them separately, so the model sees them as a labelled fallback hint
 * rather than as authoritative observations.
 */
export function buildSynthesisPrompt(
  metrics: InsightMetrics,
  previous?: readonly ProfileSlotRecord[],
): { system: string; prompt: string } {
  const { candidates, ...digest } = metrics
  const prompt = [
    'Synthesize the user cognitive profile from the metrics below.',
    '',
    'METRICS:',
    JSON.stringify(digest),
    '',
    `PREVIOUS SLOTS${previous && previous.length > 0 ? ' (refine these, do not restart)' : ' (none yet)'}:`,
    JSON.stringify(previous ?? []),
    '',
    'DETERMINISTIC FALLBACK CANDIDATES (use when the model is not confident):',
    JSON.stringify(candidates),
    '',
    'Return ONE JSON object with exactly the five slot keys.',
  ].join('\n')
  return { system: SYNTHESIS_SYSTEM, prompt }
}

/**
 * Run the synthesis stage.
 *
 * Never throws: completion failures are collected in `errors` and the
 * deterministic candidates are persisted in their place.
 */
export async function synthesizeSlots(input: SynthesizeSlotsInput): Promise<SynthesisResult> {
  const now = resolveNow(input.now)
  const metrics = input.metrics ?? aggregateMetrics(input.store, { windowDays: input.windowDays, now })
  const previous = input.store.readSlots()
  const errors: string[] = []

  const deterministic = metrics.candidates.map((candidate) => toSlotRecord(candidate.slot, null, now, candidate))

  if (!input.completion) {
    input.store.upsertSlots(deterministic, now)
    return { slots: deterministic, model: null, degraded: true, prompt: '', raw: null, errors }
  }

  const modelName = input.model ?? 'completion'
  const { system, prompt } = buildSynthesisPrompt(metrics, previous)
  let raw: string | null = null
  let slots = deterministic
  let modelSlotCount = 0

  try {
    raw = await input.completion({ prompt, system })
    const parsed = parseSynthesisJson(raw)
    if (parsed.error) errors.push(parsed.error)
    const merged = mergeSlots(deterministic, parsed.slots, now, modelName)
    slots = merged.slots
    modelSlotCount = merged.modelSlotCount
    if (modelSlotCount === 0) errors.push('synthesis: completion produced no valid slots; deterministic candidates kept')
  } catch (error) {
    errors.push(`synthesis: ${error instanceof Error ? error.message : String(error)}`)
    slots = deterministic
    modelSlotCount = 0
  }

  input.store.upsertSlots(slots, now)
  return { slots, model: modelName, degraded: modelSlotCount === 0, prompt, raw, errors }
}

/** Parsed slot payload plus a human-readable failure reason, when any. */
interface ParsedSynthesis {
  slots: Record<string, unknown>
  error: string | null
}

/**
 * Parse a model response that may be wrapped in prose or ```json fences.
 *
 * Takes the outermost `{…}` span so trailing commentary is ignored; a `slots`
 * wrapper object is unwrapped when the canonical keys are not at the top level.
 */
function parseSynthesisJson(raw: string): ParsedSynthesis {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return { slots: {}, error: 'synthesis: response contained no JSON object' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as unknown
  } catch (error) {
    return { slots: {}, error: `synthesis: invalid JSON (${error instanceof Error ? error.message : String(error)})` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { slots: {}, error: 'synthesis: JSON root was not an object' }
  }
  let record = parsed as Record<string, unknown>
  const hasSlotKey = PROFILE_SLOT_IDS.some((slot) => slot in record)
  const wrapped = record.slots
  if (!hasSlotKey && wrapped !== null && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    record = wrapped as Record<string, unknown>
  }
  return { slots: record, error: null }
}

/** One validated slot value taken from a model response, or null when malformed. */
function toModelSlotRecord(slot: string, entry: unknown, now: number, model: string | null): ProfileSlotRecord | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
  const record = entry as Record<string, unknown>
  if (!('value' in record)) return null
  const confidence =
    typeof record.confidence === 'number' && Number.isFinite(record.confidence) ? clamp01(record.confidence) : 0.5
  const rawEvidence = record.evidence
  const evidence = Array.isArray(rawEvidence)
    ? rawEvidence.filter((item): item is string => typeof item === 'string').slice(0, 5)
    : typeof rawEvidence === 'string'
      ? [rawEvidence]
      : []
  return { slot, value: record.value, confidence, evidence, updatedAt: now, version: 1, model }
}

/**
 * Overlay the model's slots on the deterministic base, keeping a candidate
 * wherever the model omitted or malformed the key. Returns the canonical-ordered
 * records plus how many came from the model.
 */
function mergeSlots(
  base: readonly ProfileSlotRecord[],
  parsed: Record<string, unknown>,
  now: number,
  model: string | null,
): { slots: ProfileSlotRecord[]; modelSlotCount: number } {
  const bySlot: Partial<Record<string, ProfileSlotRecord>> = {}
  for (const record of base) bySlot[record.slot] = record
  let modelSlotCount = 0
  for (const slot of PROFILE_SLOT_IDS) {
    const entry = parsed[slot]
    if (entry === undefined) continue
    const record = toModelSlotRecord(slot, entry, now, model)
    if (!record) continue
    bySlot[slot] = record
    modelSlotCount += 1
  }
  const slots: ProfileSlotRecord[] = []
  for (const slot of PROFILE_SLOT_IDS) {
    const record = bySlot[slot]
    if (record) slots.push(record)
  }
  for (const record of base) {
    if (!(PROFILE_SLOT_IDS as readonly string[]).includes(record.slot)) slots.push(record)
  }
  return { slots, modelSlotCount }
}