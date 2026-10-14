/**
 * Chat timeline windowing helpers (#1589).
 *
 * ChatDisplay renders the last N turns (reverse pagination) and lets the
 * browser skip layout/paint for settled turns far from the bottom with
 * `content-visibility: auto`. This is DOM-preserving virtualization: every
 * turn stays mounted, so chat markdown stays eager (product decision), and the
 * search highlighter, scrollIntoView-based jump-to-message and follow-output
 * scroll logic keep working on real nodes.
 */
import type * as React from 'react'

/** Turns this close to the bottom always render fully (streaming, cards, follow-output). */
export const LIVE_TAIL_TURNS = 6

/**
 * `auto <h>` makes the browser remember each turn's real height after it has
 * rendered once, so scroll height stays stable when turns go off screen.
 */
export const OFFSCREEN_TURN_STYLE: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 320px',
}

interface TurnLike {
  type: string
  isStreaming?: boolean
}

/**
 * Whether a rendered turn may skip rendering while off screen.
 * Search matches are excluded: paint containment would clip their focus ring.
 */
export function isOffscreenEligible(index: number, total: number, turn: TurnLike, isSearchMatch: boolean, pendingJumpIndex: number | null = null): boolean {
  if (isSearchMatch) return false
  // While a jump is pending, turns from the target down to the bottom render at
  // real size so the scroll offset is computed against real heights, not
  // 320px placeholders that resize mid-scroll.
  if (pendingJumpIndex != null && index >= pendingJumpIndex) return false
  if (index >= total - LIVE_TAIL_TURNS) return false
  if (turn.type === 'assistant' && turn.isStreaming) return false
  return true
}

export interface LaterTurnFlags {
  /** hasLaterUser[i]: some turn after i is a user turn. */
  hasLaterUser: boolean[]
  /** hasLaterAssistant[i]: some turn after i is an assistant turn. */
  hasLaterAssistant: boolean[]
}

/** One reverse pass instead of an O(n) slice+scan per row. */
export function computeLaterTurnFlags(turns: readonly TurnLike[]): LaterTurnFlags {
  const n = turns.length
  const hasLaterUser = new Array<boolean>(n)
  const hasLaterAssistant = new Array<boolean>(n)
  let user = false
  let assistant = false
  for (let i = n - 1; i >= 0; i--) {
    hasLaterUser[i] = user
    hasLaterAssistant[i] = assistant
    const t = turns[i]!.type
    if (t === 'user') user = true
    else if (t === 'assistant') assistant = true
  }
  return { hasLaterUser, hasLaterAssistant }
}

/**
 * Scroll behavior for a jump to `targetIndex` (index within the rendered window).
 * Targets outside the always-rendered live tail scroll instantly: a smooth scroll
 * passes turns whose real height differs from the placeholder and lands off target.
 */
export function jumpScrollBehavior(targetIndex: number, total: number, reducedMotion: boolean): ScrollBehavior {
  if (reducedMotion) return 'instant'
  return targetIndex >= total - LIVE_TAIL_TURNS ? 'smooth' : 'instant'
}

/**
 * Pending-jump bookkeeping. `begin` marks a target (absolute turn index);
 * `settle` is called after the corrective scroll and clears only if no newer
 * jump has started since (token check).
 */
export interface PendingJumpState { index: number | null; token: number }
export const IDLE_JUMP: PendingJumpState = { index: null, token: 0 }
export function beginJump(state: PendingJumpState, index: number): PendingJumpState {
  return { index, token: state.token + 1 }
}
export function settleJump(state: PendingJumpState, token: number): PendingJumpState {
  return state.token === token ? { index: null, token: state.token } : state
}

/**
 * Scroll `el` into view for a jump, then issue a corrective instant
 * scrollIntoView after the next frames (after newly-real-sized turns lay out).
 * `onSettled` runs after the correction.
 */
export function scrollIntoViewForJump(el: HTMLElement, behavior: ScrollBehavior, onSettled?: () => void): void {
  el.scrollIntoView({ behavior, block: 'center' })
  // Two frames: the first lets React commit the pending-jump render (real-size
  // turns), the second runs after that layout.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (behavior === 'instant' && el.isConnected) el.scrollIntoView({ behavior: 'instant', block: 'center' })
    onSettled?.()
  }))
}

/** Safety net: a jump whose target never mounted is cleared after this long. */
export const PENDING_JUMP_TIMEOUT_MS = 1500
