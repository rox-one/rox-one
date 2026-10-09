/**
 * Board widget contracts (shared layer).
 *
 * A board widget is agent-authored content mounted in a ticket-scoped sandbox.
 * The stored shape is `WidgetRecord`: every write mints a new `revision` and
 * records the digest of the exact bytes that revision carries, so a mounting
 * host binds its render ticket to (widgetId, revision, sha256) instead of to a
 * mutable row. A revision's bytes are immutable — a widget edit is a new
 * revision, never an in-place rewrite.
 */

/** Authored widget source formats. */
export type WidgetKind = 'html' | 'a2ui'

/**
 * What the author asked the widget to be able to do. Both fields are grants
 * requested at write time; the mounting host intersects them with the operator
 * policy of whoever is viewing the board, so an absent field means "none".
 */
export interface WidgetDeclaration {
  /** Exact outbound origins the widget may reach. Absent = no network access. */
  netOrigins?: string[]
  /** Host tool ids the widget may invoke. Absent = no host tool access. */
  tools?: string[]
}

/** A stored widget revision. */
export interface WidgetRecord {
  /** Stable widget identity; revisions share it. */
  widgetId: string
  /** Operator-visible name. */
  name: string
  kind: WidgetKind
  /** Monotonic revision number within `widgetId`, starting at 1. */
  revision: number
  /** Lowercase sha256 hex of the exact `source` bytes stored at `revision`. */
  sha256: string
  /** Session that authored this revision, when it was authored inside one. */
  sessionId?: string
  /** Identity that authored the widget (session owner or operator). */
  createdBy: string
  /** ISO-8601 timestamp of the first write of this `widgetId`. */
  createdAt: string
}