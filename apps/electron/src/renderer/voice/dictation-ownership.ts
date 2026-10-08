/**
 * Single-owner arbitration for dictation.
 *
 * Native hotkeys and overlay commands are broadcast to every mounted listener,
 * so exactly one surface may hold the microphone at a time. A composer control
 * claims ownership before opening the device; a global (overlay) listener may
 * claim it when no composer owns it. The claimed owner also records the intent
 * (where the transcript should land) so downstream consumers can route it.
 */
export type DictationOwner = object

export interface DictationIntent {
  source: 'composer' | 'global'
  delivery: 'draft' | 'clipboard'
  trailingSpace?: boolean
}

let owner: DictationOwner | null = null
let intent: DictationIntent | null = null
let composerPresence = 0

/** Claim dictation for `candidate`; `false` when another owner already holds it. */
export function claimDictation(candidate: DictationOwner): boolean {
  if (owner !== null && owner !== candidate) return false
  owner = candidate
  return true
}

export function currentOwner(): DictationOwner | null {
  return owner
}

/** Record `target`'s intent. Ignored unless `target` is the active owner. */
export function setDictationIntent(target: DictationOwner, next: DictationIntent): void {
  if (owner !== target) return
  intent = next
}

/** Active intent, or the owner's intent only when `target` matches the owner. */
export function peekIntent(target?: DictationOwner): DictationIntent | null {
  if (owner === null) return null
  if (target !== undefined && owner !== target) return null
  return intent
}

/** Clear ownership and intent, but only for the matching owner. */
export function releaseDictation(target: DictationOwner): void {
  if (owner !== target) return
  owner = null
  intent = null
}

/** Register a mounted composer control; the returned function unregisters it. */
export function registerComposerPresence(): () => void {
  composerPresence += 1
  let released = false
  return () => {
    if (released) return
    released = true
    composerPresence = Math.max(0, composerPresence - 1)
  }
}

/** Whether any composer control is mounted at all. */
export function isComposerPresent(): boolean {
  return composerPresence > 0
}

/** Whether the active owner's intent targets the composer. */
export function isComposerOwned(): boolean {
  return owner !== null && intent?.source === 'composer'
}