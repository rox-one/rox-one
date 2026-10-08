/**
 * W1-15 (#1512) — Agent panel context contract (TECH-SPEC §18.1, §18.3;
 * UI-SPEC §25).
 *
 * The panel is an ordinary omp session (`origin: 'agent-panel'`, see
 * `session.ts`); this module is the *context* half: what the agent may see of
 * the surface the user is on, and the pure privacy rules that decide what is
 * attached automatically.
 *
 * The panel shows a context bar, and the context travels **only with the next
 * user message** as `contextSnapshot` — never streamed to the model in the
 * background. Recomputing is debounced (`AGENT_CONTEXT_DEBOUNCE_MS`).
 *
 * Dependency-free: the per-surface providers register in W1-07's slot
 * `agent.context.<surface>` (see `agentContextSlotId` in `../platform/chrome.ts`).
 */

import type { EntityRef } from '../entities/refs.ts'
import type { EntityKind } from '../entities/kinds.ts'
import type { SurfaceId } from '../platform/chrome.ts'

/**
 * The surface a context was captured on: a rail mode (`home`, `docs`, `tasks`,
 * …) or one of the three non-rail surfaces. Typed as `SurfaceId` because the
 * rail vocabulary is the renderer's mode registry (`ModeContribution.id`).
 */
export type AgentPanelSurface = SurfaceId | 'settings' | 'search' | 'agent-center'

/** Surfaces with no rail entry but with chrome / an agent context. */
export const NON_RAIL_AGENT_SURFACES = ['settings', 'search', 'agent-center'] as const

/** Context is recomputed on route or selection change, debounced (TECH-SPEC §18.1). */
export const AGENT_CONTEXT_DEBOUNCE_MS = 300

/** Selections and visible sets are capped at 50 refs (TECH-SPEC §18.1). */
export const AGENT_CONTEXT_MAX_REFS = 50

/** Text excerpts are cut at 2,000 characters at a block boundary (§18.3 rule 2). */
export const AGENT_EXCERPT_MAX_CHARS = 2000

/** Expanded context block budget (TECH-SPEC §18.2). */
export const AGENT_CONTEXT_MAX_TOKENS = 24_000

/**
 * Token estimator for the expanded block: 4 characters per token, the same
 * order of magnitude the session store uses. Kept here so the budget test and
 * the server expansion agree on one number.
 */
export const AGENT_CONTEXT_CHARS_PER_TOKEN = 4

export interface TextSelectionSnapshot {
  ref: EntityRef
  /** ≤ `AGENT_EXCERPT_MAX_CHARS`, cut at a block boundary. */
  excerpt: string
  /** TipTap / ProseMirror anchor, opaque to the contract. */
  anchor?: unknown
}

export interface SurfaceContext {
  /** Contract version; a bump is a breaking change for stored snapshots. */
  v: 1
  /** `null` = local-only (no workspace). */
  workspaceId: string | null
  surface: AgentPanelSurface
  /** `rox://` route of MAIN. */
  route: string
  /** Human title shown in the context divider. */
  title: string
  /** The open entity (doc, chat, task, goal, event, person, file…). */
  focus?: EntityRef
  /** ≤ `AGENT_CONTEXT_MAX_REFS` selected rows / chips. */
  selection?: EntityRef[]
  textSelection?: TextSelectionSnapshot
  /** ≤ `AGENT_CONTEXT_MAX_REFS` refs on screen, provider-ranked. */
  visible?: EntityRef[]
  view?: { kind: string; filters?: Record<string, unknown> }
  locale: string
  timeZone: string
  /** Private notes / DMs the user explicitly attached (chips or «+ Добавить»). */
  consent: { privateRefs: EntityRef[] }
  /** Chips pinned across navigation. */
  locked: EntityRef[]
}

/** One panel quick action; the first four render (TECH-SPEC §18.1, UI-SPEC §25.3). */
export interface QuickAction {
  id: string
  /** i18n key of the chip label. */
  titleKey: string
  /** Templated instruction sent with the current context. */
  instruction: string
  icon?: string
  /** Explicit chips this action attaches besides the current context. */
  attach?: EntityRef[]
}

/** At most four quick actions are shown; the rest go behind ⋯. */
export const MAX_VISIBLE_QUICK_ACTIONS = 4
export const MAX_QUICK_ACTIONS = 8

/**
 * A surface's agent-context provider. `getContext` is pure and synchronous —
 * it reads renderer state, never the network — so the panel can recompute it
 * on every debounce tick.
 */
export interface AgentContextProvider {
  surface: AgentPanelSurface
  getContext(): SurfaceContext
  /** ≤ `MAX_QUICK_ACTIONS`, ordered; the first four are shown. */
  quickActions(ctx: SurfaceContext): QuickAction[]
}

/**
 * The generic provider quick actions (UI-SPEC §25.7: a surface without a
 * provider still gets route + title context and these four).
 */
export const FALLBACK_QUICK_ACTION_KEYS = [
  'agentPanel.fallbackQuick.summary',
  'agentPanel.fallbackQuick.find',
  'agentPanel.fallbackQuick.createTask',
  'agentPanel.fallbackQuick.explain',
] as const

export function fallbackQuickActions(): QuickAction[] {
  return FALLBACK_QUICK_ACTION_KEYS.map((titleKey) => ({
    id: titleKey,
    titleKey,
    instruction: titleKey,
  }))
}

/** A surface without a registered provider falls back to `{surface, route, title}` (§18.1). */
export function fallbackSurfaceContext(input: {
  surface: AgentPanelSurface
  route: string
  title: string
  workspaceId?: string | null
  locale?: string
  timeZone?: string
}): SurfaceContext {
  return {
    v: 1,
    workspaceId: input.workspaceId ?? null,
    surface: input.surface,
    route: input.route,
    title: input.title,
    locale: input.locale ?? 'ru',
    timeZone: input.timeZone ?? 'Europe/Moscow',
    consent: { privateRefs: [] },
    locked: [],
  }
}

// ---------------------------------------------------------------------------
// §18.3 Privacy rules (pure)
// ---------------------------------------------------------------------------

/**
 * What the privacy rules need to know about one candidate ref. The caller
 * resolves these facts (ACL + kind); the rules themselves stay pure.
 */
export interface AutoAttachFacts {
  /** The ref is the context's focus (the open entity). */
  isFocus: boolean
  /** `note` with `authority='local'` — a private note. */
  isPrivateLocalNote: boolean
  /** A DM (1:1 `channel`), and whether it is the open one. */
  isDirectMessage: boolean
  isOpenDirectMessage: boolean
  /** `acl.can(owner, 'read', ref)`. */
  canRead: boolean
  /** The user attached this ref explicitly (chip, «+ Добавить», private chip click). */
  explicitlyAttached: boolean
  /** `created_by` of a pin link (only set for pin links). */
  pinCreatedBy?: string
  /** Viewing principal (only set when pins are involved). */
  viewerPrincipalId?: string
}

/**
 * §18.3 rule 1, one ref at a time: auto-attach never includes
 * (a) a `note` with `authority='local'` that is not the focus,
 * (b) a DM other than the open one,
 * (c) any ref the user cannot read.
 *
 * Private refs are never silently dropped from the world either: they surface
 * as the dashed «Личная заметка — добавить?» chip and need a click, so the
 * caller asks for `autoAttached: false` and renders the consent chip.
 */
export function mayAutoAttachRef(facts: AutoAttachFacts): boolean {
  if (facts.explicitlyAttached) return facts.canRead
  if (!facts.canRead) return false
  if (facts.isPrivateLocalNote && !facts.isFocus) return false
  if (facts.isDirectMessage && !facts.isOpenDirectMessage) return false
  return true
}

/**
 * Auto-attach filter over a ref list, preserving order and de-duplicating.
 * `focus` is always kept (it is the surface the user is looking at), subject
 * to `canRead`.
 */
export function filterAutoAttach(
  refs: readonly EntityRef[],
  factsFor: (ref: EntityRef) => AutoAttachFacts,
): EntityRef[] {
  const out: EntityRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (mayAutoAttachRef(factsFor(ref))) out.push(ref)
  }
  return out
}

/**
 * §18.3 rule 1 for the *consent* side: refs the user cannot read are dropped
 * outright (they are not even offered as a chip), refs that are merely
 * sensitive are offered as a dashed chip the user must click.
 */
export interface ConsentCandidate {
  ref: EntityRef
  kind: 'private-local-note' | 'direct-message'
}

export function consentCandidates(
  refs: readonly EntityRef[],
  factsFor: (ref: EntityRef) => AutoAttachFacts,
): { attachable: EntityRef[]; needsConsent: ConsentCandidate[] } {
  const attachable: EntityRef[] = []
  const needsConsent: ConsentCandidate[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const facts = factsFor(ref)
    if (!facts.canRead) continue
    if (facts.isPrivateLocalNote && !facts.isFocus) { needsConsent.push({ ref, kind: 'private-local-note' }); continue }
    if (facts.isDirectMessage && !facts.isOpenDirectMessage) { needsConsent.push({ ref, kind: 'direct-message' }); continue }
    attachable.push(ref)
  }
  return { attachable, needsConsent }
}

/**
 * §18.3 rule 2: excerpts are cut at 2,000 characters at a **block boundary**.
 * A block boundary is a blank line (Markdown) or a paragraph/list/heading
 * break (ProseMirror text with `\n`). When no boundary exists inside the
 * budget the cut falls back to the last whitespace, and only then mid-word —
 * never past the cap.
 */
export function cutExcerpt(excerpt: string, maxChars: number = AGENT_EXCERPT_MAX_CHARS): string {
  if (maxChars <= 0) return ''
  if (excerpt.length <= maxChars) return excerpt
  const window = excerpt.slice(0, maxChars)
  const blockBreak = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'))
  if (blockBreak > 0) return window.slice(0, blockBreak)
  const whitespace = window.search(/\s\S*$/)
  if (whitespace > 0) return window.slice(0, whitespace)
  return window
}

/**
 * §18.3 rule 3 helper: the snapshot stored with the message is exactly what
 * the agent saw, so the audit can replay it. Freezes the shape (the caller
 * persists the JSON) and applies the excerpt cut.
 */
export function normalizeContextSnapshot(context: SurfaceContext): SurfaceContext {
  const cap = (refs: readonly EntityRef[] | undefined): EntityRef[] | undefined => {
    if (!refs) return undefined
    const seen = new Set<string>()
    const out: EntityRef[] = []
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(ref)
      if (out.length === AGENT_CONTEXT_MAX_REFS) break
    }
    return out
  }
  const selection = cap(context.selection)
  const visible = cap(context.visible)
  return {
    ...context,
    ...(selection ? { selection } : {}),
    ...(visible ? { visible } : {}),
    locked: cap(context.locked) ?? [],
    consent: { privateRefs: cap(context.consent?.privateRefs ?? []) ?? [] },
    ...(context.textSelection
      ? { textSelection: { ...context.textSelection, excerpt: cutExcerpt(context.textSelection.excerpt) } }
      : {}),
  }
}

/**
 * §18.3 rule 4: a workspace admin can turn the automatic context off
 * (`agent_panel.auto_context=false` in `approval_policy` defaults). Then only
 * explicit chips are sent — the focus, the selection, the visible set and
 * provider quick actions are all dropped, while consent chips and locked
 * chips survive because the user put them there.
 */
export const AGENT_PANEL_AUTO_CONTEXT_POLICY_KEY = 'agent_panel.auto_context'

export function contextForDispatch(context: SurfaceContext, autoContext: boolean): SurfaceContext {
  if (autoContext) return normalizeContextSnapshot(context)
  // `agent_panel.auto_context=false`: only what the user put there travels —
  // the consent chips, the locked chips and the route/title header.
  return normalizeContextSnapshot({
    v: 1,
    workspaceId: context.workspaceId,
    surface: context.surface,
    route: context.route,
    title: context.title,
    locale: context.locale,
    timeZone: context.timeZone,
    consent: { privateRefs: context.consent?.privateRefs ?? [] },
    locked: context.locked ?? [],
  })
}

// ---------------------------------------------------------------------------
// Expansion order + redaction (TECH-SPEC §18.2)
// ---------------------------------------------------------------------------

/**
 * Priority order of the expanded context block: focus → textSelection →
 * selection → locked → visible. Later groups are dropped first when the
 * 24 k-token budget is exceeded.
 */
export const CONTEXT_EXPANSION_ORDER = ['focus', 'textSelection', 'selection', 'locked', 'visible'] as const
export type ContextExpansionGroup = (typeof CONTEXT_EXPANSION_ORDER)[number]

/** The refs of one group, in priority order (focus is a single ref). */
export function contextGroupRefs(context: SurfaceContext, group: ContextExpansionGroup): EntityRef[] {
  switch (group) {
    case 'focus': return context.focus ? [context.focus] : []
    case 'textSelection': return context.textSelection ? [context.textSelection.ref] : []
    case 'selection': return [...(context.selection ?? [])]
    case 'locked': return [...(context.locked ?? [])]
    case 'visible': return [...(context.visible ?? [])]
  }
}

export interface ExpandedContextRef {
  ref: EntityRef
  group: ContextExpansionGroup
  /** Text the server-core resolved for this ref (already ACL-checked). */
  text?: string
  /** Unreadable ref: the agent is told the item exists but sees no content. */
  restricted?: true
}

/**
 * A ref the reader cannot read becomes `{ref, restricted: true}` (TECH-SPEC
 * §18.2) — an existence hint without content. A *secret* ref (W1-04
 * `AclDecision.secret`) is never sent at all: it must not leak through the
 * panel either (the listing rule already hides it).
 */
export function redactExpandedRefs(
  refs: readonly { ref: EntityRef; group: ContextExpansionGroup; text?: string }[],
  access: (ref: EntityRef) => { canRead: boolean; secret: boolean },
): ExpandedContextRef[] {
  const out: ExpandedContextRef[] = []
  for (const entry of refs) {
    const { canRead, secret } = access(entry.ref)
    if (secret) continue
    if (!canRead) { out.push({ ref: entry.ref, group: entry.group, restricted: true }); continue }
    out.push({ ...entry })
  }
  return out
}

/** Rough token count of the assembled block (`AGENT_CONTEXT_CHARS_PER_TOKEN`). */
export function estimateContextTokens(text: string): number {
  return Math.ceil(text.length / AGENT_CONTEXT_CHARS_PER_TOKEN)
}

/**
 * Drop the lowest-priority groups until the block fits the budget. `ordered`
 * must already be in `CONTEXT_EXPANSION_ORDER`; a group is dropped whole, and
 * `focus` is never dropped.
 */
export function fitContextBudget(
  ordered: readonly ExpandedContextRef[],
  sizeOf: (entry: ExpandedContextRef) => number,
  maxTokens: number = AGENT_CONTEXT_MAX_TOKENS,
): ExpandedContextRef[] {
  let kept = [...ordered]
  for (let index = CONTEXT_EXPANSION_ORDER.length - 1; index > 0; index -= 1) {
    const total = kept.reduce((sum, entry) => sum + sizeOf(entry), 0)
    if (total <= maxTokens) return kept
    const drop = CONTEXT_EXPANSION_ORDER[index]!
    kept = kept.filter((entry) => entry.group !== drop)
  }
  return kept
}

/** Entity kinds that never auto-attach: private local notes (§18.3 rule 1a). */
export const NEVER_AUTO_ATTACH_PRIVATE_KINDS: readonly EntityKind[] = ['note']