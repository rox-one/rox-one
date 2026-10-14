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
export function isOffscreenEligible(index: number, total: number, turn: TurnLike, isSearchMatch: boolean): boolean {
  if (isSearchMatch) return false
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
