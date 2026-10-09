/**
 * W1-15 (#1512) — ACL rule `pin-private` (TECH-SPEC §20 X-26, DATA-MODEL §5.18).
 *
 * A pin is an `entity_link(person → any, relation 'relates-to', role 'pin',
 * anchor {position})` whose `created_by` is the only principal who may see it.
 * Pin links are additionally **excluded from backlinks, search and activity**
 * for everyone — the owner sees them in the surface's «Закреплённое» section,
 * never as an ordinary link row.
 *
 * Local-only users (no workspace) keep pins in `{configDir}/ui/pins.json`,
 * where there is no other principal to protect them from; the same shape is
 * used so a later share migrates without translation.
 *
 * Registration: the rule is declared in `LINK_VISIBILITY_RULES`, this
 * package's own registry. #1501's ACL engine has no rule set yet (its rule
 * table is `PERMISSION_RULES`, keyed by action, in
 * `entities/permissions.ts`), so wiring this into the engine is UNDONE —
 * W1-11 (#1508) owns `packages/core/src/acl/rules/**`.
 *
 * Pure: no I/O, no config-dir dependency.
 */

import type { EntityRef } from '../../entities/refs.ts'
import type { EntityRelation } from '../../entities/links.ts'
import { entityRefKey } from '../../entities/refs.ts'

/** Relation a pin uses (DATA-MODEL §5.18: `relates-to`, role `pin`). */
export const PIN_RELATION: EntityRelation = 'relates-to'

/** `entity_link.role` of a pin. */
export const PIN_ROLE = 'pin'

/** Rule id, as referenced by the ACL rule registry. */
export const PIN_PRIVATE_RULE_ID = 'pin-private'

/**
 * Read surfaces a pin link never appears on, for anyone. The «Закреплённое»
 * sidebar section is not one of them: it reads pins directly through
 * `pinLinkVisibleTo`.
 */
export const PIN_EXCLUDED_SURFACES = ['backlinks', 'search', 'activity'] as const
export type PinExcludedSurface = (typeof PIN_EXCLUDED_SURFACES)[number]

/** The minimal shape a link needs for visibility evaluation (store rows carry more). */
export interface LinkVisibilityInput {
  relation: EntityRelation | string
  role?: string | null
  createdBy?: string | null
}

export function isPinLink(link: LinkVisibilityInput): boolean {
  return link.relation === PIN_RELATION && link.role === PIN_ROLE
}

/** A pin is visible only to the principal who created it. */
export function pinLinkVisibleTo(link: LinkVisibilityInput, viewerPrincipalId: string | null | undefined): boolean {
  if (!isPinLink(link)) return true
  return !!viewerPrincipalId && link.createdBy === viewerPrincipalId
}

/**
 * The rule, evaluated for one link on one read surface.
 * - a pin is excluded from `backlinks` / `search` / `activity` even for its creator;
 * - everywhere else a pin is visible only to its creator;
 * - every other link is unaffected by this rule.
 */
export function pinPrivateAllows(
  link: LinkVisibilityInput,
  viewerPrincipalId: string | null | undefined,
  surface: string,
): boolean {
  if (!isPinLink(link)) return true
  if ((PIN_EXCLUDED_SURFACES as readonly string[]).includes(surface)) return false
  return pinLinkVisibleTo(link, viewerPrincipalId)
}

/** Keep only the links of `links` this viewer may see on `surface`. */
export function filterLinksForViewer<T extends LinkVisibilityInput>(
  links: readonly T[],
  viewerPrincipalId: string | null | undefined,
  surface: string,
): T[] {
  return links.filter((link) => pinPrivateAllows(link, viewerPrincipalId, surface))
}

/** The rule descriptor an ACL rule registry stores. */
export interface LinkVisibilityRule {
  id: string
  /** One-line rule, kept verbatim for the contract doc and reports. */
  rule: string
  /** Surfaces the rule filters; `'*'` = every read surface. */
  surfaces: readonly string[] | '*'
  allows(link: LinkVisibilityInput, viewerPrincipalId: string | null | undefined, surface: string): boolean
}

export const PIN_PRIVATE_RULE: LinkVisibilityRule = {
  id: PIN_PRIVATE_RULE_ID,
  rule: 'Pins (relates-to role pin) are private to created_by and excluded from backlinks, search and activity',
  surfaces: '*',
  allows: pinPrivateAllows,
}

/**
 * This package's rule set. Append-only: a later package adds its own
 * `LinkVisibilityRule` block at the end. `registerLinkVisibilityRule` is the
 * single entry point so a swap to #1508's registry is a one-line change.
 */
export const LINK_VISIBILITY_RULES: LinkVisibilityRule[] = [PIN_PRIVATE_RULE]

/** STUB(#1501): #1508 owns `acl/rules/**`; until then the rule set lives here. */
export function registerLinkVisibilityRule(rule: LinkVisibilityRule): void {
  if (LINK_VISIBILITY_RULES.some((existing) => existing.id === rule.id)) return
  LINK_VISIBILITY_RULES.push(rule)
}

/** Evaluate every registered rule; the first denial wins (rules are restrictive-only). */
export function linkAllowedOnSurface(
  link: LinkVisibilityInput,
  viewerPrincipalId: string | null | undefined,
  surface: string,
): boolean {
  for (const rule of LINK_VISIBILITY_RULES) {
    if (rule.surfaces !== '*' && !rule.surfaces.includes(surface)) continue
    if (!rule.allows(link, viewerPrincipalId, surface)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Pin ordering + the local pin store shape
// ---------------------------------------------------------------------------

/** `entity_link.anchor` of a pin: the drag order inside «Закреплённое». */
export interface PinAnchor {
  position: number
}

/**
 * A pin link row as the resolver exposes it. `EntityLink` carries `anchor` as
 * free JSON in the store, so the pin anchor is declared here (DATA-MODEL
 * §5.18) rather than widening the shared `EntityLinkAnchor`.
 */
export interface PinLink extends LinkVisibilityInput {
  ref: EntityRef
  role: typeof PIN_ROLE
  createdBy: string
  anchor?: PinAnchor | null
}

/** Pins sorted by anchor position; a missing anchor sorts last, ties keep input order. */
export function sortPins<T extends { anchor?: PinAnchor | null }>(pins: readonly T[]): T[] {
  return [...pins]
    .map((pin, index) => ({ pin, index }))
    .sort((a, b) => {
      const left = a.pin.anchor?.position ?? Number.MAX_SAFE_INTEGER
      const right = b.pin.anchor?.position ?? Number.MAX_SAFE_INTEGER
      return left === right ? a.index - b.index : left - right
    })
    .map((entry) => entry.pin)
}

/**
 * X-26 `entities.reorder_pins`: the anchors to write for the given order.
 * Positions are 0-based and dense, so re-reading the list is stable.
 */
export function pinAnchorsForOrder(refs: readonly EntityRef[]): Array<{ ref: EntityRef; anchor: PinAnchor }> {
  const seen = new Set<string>()
  const out: Array<{ ref: EntityRef; anchor: PinAnchor }> = []
  for (const ref of refs) {
    const key = entityRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ref, anchor: { position: out.length } })
  }
  return out
}

/** `{configDir}/ui/pins.json` — local-only pins (DATA-MODEL §5.18). */
export const LOCAL_PINS_VERSION = 1

export interface LocalPinRecord {
  ref: EntityRef
  position: number
  /** ISO-8601. */
  pinnedAt: string
}

export interface LocalPinsState {
  version: typeof LOCAL_PINS_VERSION
  pins: LocalPinRecord[]
}

export const EMPTY_LOCAL_PINS_STATE: LocalPinsState = { version: LOCAL_PINS_VERSION, pins: [] }

/** Pin or re-pin a local ref (idempotent; a re-pin keeps the original `pinnedAt`). */
export function withLocalPin(state: LocalPinsState, ref: EntityRef, pinnedAt: string): LocalPinsState {
  const key = entityRefKey(ref)
  if (state.pins.some((pin) => entityRefKey(pin.ref) === key)) return state
  return { version: LOCAL_PINS_VERSION, pins: [...state.pins, { ref, position: state.pins.length, pinnedAt }] }
}

export function withoutLocalPin(state: LocalPinsState, ref: EntityRef): LocalPinsState {
  const key = entityRefKey(ref)
  const pins = state.pins.filter((pin) => entityRefKey(pin.ref) !== key)
  if (pins.length === state.pins.length) return state
  return { version: LOCAL_PINS_VERSION, pins: pins.map((pin, position) => ({ ...pin, position })) }
}

export function recordLocalPins(state: LocalPinsState, refs: readonly EntityRef[], pinnedAt: string): LocalPinsState {
  const byKey = new Map(state.pins.map((pin) => [entityRefKey(pin.ref), pin]))
  const pins: LocalPinRecord[] = []
  for (const entry of pinAnchorsForOrder(refs)) {
    const existing = byKey.get(entityRefKey(entry.ref))
    pins.push({ ref: entry.ref, position: entry.anchor.position, pinnedAt: existing?.pinnedAt ?? pinnedAt })
  }
  return { version: LOCAL_PINS_VERSION, pins }
}