/**
 * Cognitive-profile block rendering + on-disk cache (requirement E, part 3).
 *
 * The OMP spawn path must inject the user's profile without opening the
 * intelligence database (lock-free startup), so the rendered block is written to
 * `<intelligenceDir>/user_cognitive_profile.txt` by the pipeline and read back
 * by the spawn path with no DB access at all.
 *
 * Rendering is deterministic: the canonical slot order, a confidence gate and a
 * hard character budget. When the budget is exceeded the lowest-confidence slots
 * are dropped first; a line is only ever shortened with a visible ellipsis.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { IntelligenceStore } from '../db/repositories.ts'
import { resolveBrowserIntelPaths, type BrowserIntelPaths } from '../paths.ts'
import { PROFILE_SLOT_IDS } from '../types.ts'
import type { CognitiveProfileBlock, CognitiveProfileOptions, ProfileSlotId, ProfileSlotRecord } from '../types.ts'

export const COGNITIVE_PROFILE_BASENAME = 'user_cognitive_profile.txt'
export const DEFAULT_MAX_CHARS = 6000
export const DEFAULT_MIN_CONFIDENCE = 0.35

const OPEN_TAG = '<user_cognitive_profile>'
const CLOSE_TAG = '</user_cognitive_profile>'

interface ProfileLine {
  record: ProfileSlotRecord
  text: string
}

function slotOrder(slot: string): number {
  const index = PROFILE_SLOT_IDS.indexOf(slot as ProfileSlotId)
  return index === -1 ? PROFILE_SLOT_IDS.length : index
}

function evidenceStrings(evidence: unknown): string[] {
  if (Array.isArray(evidence)) return evidence.filter((item): item is string => typeof item === 'string')
  return typeof evidence === 'string' ? [evidence] : []
}

function renderSlotLine(record: ProfileSlotRecord): string {
  const value = typeof record.value === 'string' ? record.value : JSON.stringify(record.value)
  const evidence = evidenceStrings(record.evidence)
  const tail = evidence.length > 0 ? ` — evidence: ${evidence.slice(0, 3).join('; ')}` : ''
  return `- ${record.slot}: ${value}${tail}`
}

function renderBlock(lines: readonly ProfileLine[]): string {
  const body = lines.map((line) => line.text).join('\n')
  return body.length === 0 ? `${OPEN_TAG}\n${CLOSE_TAG}` : `${OPEN_TAG}\n${body}\n${CLOSE_TAG}`
}

/**
 * Render the dynamic `<user_cognitive_profile>` block from stored slots.
 *
 * Slots below `minConfidence` are omitted, the rest are ordered by the canonical
 * slot list, and the whole block is kept within `maxChars` by discarding the
 * lowest-confidence lines first.
 */
export function buildCognitiveProfileBlock(
  slots: readonly ProfileSlotRecord[],
  options: CognitiveProfileOptions = {},
): CognitiveProfileBlock {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE

  const ordered = slots
    .filter((slot) => Number.isFinite(slot.confidence) && slot.confidence >= minConfidence)
    .sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot) || a.slot.localeCompare(b.slot))
    .map((record) => ({ record, text: renderSlotLine(record) }))

  let kept = ordered
  let block = renderBlock(kept)
  while (block.length > maxChars && kept.length > 1) {
    // Drop the lowest-confidence line; on ties the last (least canonical) one.
    let dropIndex = 0
    for (let i = 1; i < kept.length; i += 1) {
      if ((kept[i]!.record.confidence ?? 0) <= (kept[dropIndex]!.record.confidence ?? 0)) dropIndex = i
    }
    kept = kept.filter((_, index) => index !== dropIndex)
    block = renderBlock(kept)
  }

  if (block.length > maxChars && kept.length === 1) {
    const only = kept[0]!
    const budget = maxChars - (OPEN_TAG.length + CLOSE_TAG.length + 2)
    kept = budget > 1 ? [{ record: only.record, text: `${only.text.slice(0, budget - 1).trimEnd()}…` }] : []
    block = renderBlock(kept)
  }

  return { block, slots: kept.map((line) => line.record), tokensEstimate: Math.ceil(block.length / 4) }
}

/** Build the block from the store and cache it atomically (temp + rename, 0600). */
export function writeCognitiveProfileCache(
  store: IntelligenceStore,
  paths: BrowserIntelPaths,
  options: CognitiveProfileOptions = {},
): CognitiveProfileBlock {
  const block = buildCognitiveProfileBlock(store.readSlots(), options)
  const target = join(paths.intelligenceDir, COGNITIVE_PROFILE_BASENAME)
  mkdirSync(paths.intelligenceDir, { recursive: true })
  const temporary = `${target}.tmp`
  writeFileSync(temporary, block.block, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
  return block
}

/** Read the cached block, or '' when it is absent or empty. No DB access. */
export function readCognitiveProfileCache(paths?: BrowserIntelPaths): string {
  const resolved = paths ?? resolveBrowserIntelPaths()
  try {
    const raw = readFileSync(join(resolved.intelligenceDir, COGNITIVE_PROFILE_BASENAME), 'utf8')
    return raw.trim().length === 0 ? '' : raw
  } catch {
    return ''
  }
}

/** Remove the cached block; safe to call when it does not exist. */
export function clearCognitiveProfileCache(paths?: BrowserIntelPaths): void {
  const resolved = paths ?? resolveBrowserIntelPaths()
  rmSync(join(resolved.intelligenceDir, COGNITIVE_PROFILE_BASENAME), { force: true })
}