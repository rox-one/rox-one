import type { RuntimeState } from '../contracts'

/** Idle snapshot. Kept in its own module so the boot host can seed state without the engine. */
export const initialRuntimeState: RuntimeState = Object.freeze({
  definition: null, phase: 'idle', attempt: null, progress: null,
  attemptEvidence: Object.freeze({}), seenEventTokens: Object.freeze([]),
})
