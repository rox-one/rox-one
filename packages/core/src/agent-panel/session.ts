/**
 * W1-15 (#1512) — Agent panel runtime contract (TECH-SPEC §18.2; UI-SPEC §25).
 *
 * One session per topic: a panel topic is an ordinary omp session created
 * through the existing session API with `origin: 'agent-panel'`, so there is
 * NO new runtime, queue or orchestrator (ADR-U14 / R-AG-09). This module holds
 * the wire contract only — the origin envelope, the message `contextSnapshot`,
 * the stored UI state and the approval topic.
 */

import type { EntityRef } from '../entities/refs.ts'
import type { CommandEnvelope, CommandOrigin } from '../commands/envelope.ts'
import type { SurfaceContext } from './context.ts'

/** `session.origin` / label value for a panel topic (TECH-SPEC §18.2). */
export const AGENT_PANEL_ORIGIN = 'agent-panel'

/** Label written on panel sessions so they are listable and resumable. */
export const AGENT_PANEL_LABEL = 'agent-panel'

/** UI-SPEC §25.3: docked width default 380, resizable 320–560. */
export const AGENT_PANEL_DEFAULT_WIDTH = 380
export const AGENT_PANEL_MIN_WIDTH = 320
export const AGENT_PANEL_MAX_WIDTH = 560

/** Docked below this window width the panel is an overlay instead (§18.4). */
export const AGENT_PANEL_SHARED_DOCK_MIN_WINDOW = 1280

/** A session that hosts a panel topic. */
export interface AgentPanelSession {
  sessionId: string
  workspaceId: string | null
  origin: typeof AGENT_PANEL_ORIGIN
  labels: readonly string[]
  /** Topic title shown in the panel header (editable). */
  title: string
}

/** Create input for the existing session API; never a new store. */
export interface CreateAgentPanelSessionInput {
  workspaceId: string | null
  title?: string
  /** Resume an existing topic instead of starting one. */
  sessionId?: string
}

/**
 * The panel's `CommandOrigin` (TECH-SPEC §18.2): every proposal the agent
 * makes is a `CommandEnvelope` with this origin, so approvals, risk classes,
 * rate limits, audit and readback are unchanged (§13.2–§13.8).
 */
export type AgentPanelCommandOrigin = Extract<CommandOrigin, { kind: 'agent-panel' }>

export function agentPanelCommandOrigin(input: {
  sessionId: string
  messageId?: string
  surface?: string
}): AgentPanelCommandOrigin {
  return {
    kind: 'agent-panel',
    sessionId: input.sessionId,
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.surface ? { surface: input.surface } : {}),
  }
}

/** Stamp a proposal from the panel with its origin (mutates nothing). */
export function asAgentPanelProposal<P>(envelope: CommandEnvelope<P>, origin: AgentPanelCommandOrigin): CommandEnvelope<P> {
  return { ...envelope, origin }
}

// ---------------------------------------------------------------------------
// Message envelope
// ---------------------------------------------------------------------------

/**
 * The panel message as stored by the session. `contextSnapshot` is stored ON
 * the user message so the audit shows exactly what the agent saw and a replay
 * is exact (§18.2, §18.3 rule 3).
 */
export interface AgentPanelUserMessage<P = unknown> {
  role: 'user'
  sessionId: string
  messageId: string
  body: P
  contextSnapshot: SurfaceContext
  /** ISO-8601. */
  at: string
}

/** Attach the snapshot to an outgoing user message. */
export function withContextSnapshot<P>(
  message: Omit<AgentPanelUserMessage<P>, 'contextSnapshot'>,
  contextSnapshot: SurfaceContext,
): AgentPanelUserMessage<P> {
  return { ...message, contextSnapshot }
}

/** True when the message carries a snapshot (older messages may not). */
export function hasContextSnapshot(message: { contextSnapshot?: unknown }): boolean {
  return !!message.contextSnapshot && typeof message.contextSnapshot === 'object'
}

/**
 * A context divider is inserted between two messages when the surface or the
 * focus changed (UI-SPEC §25.3: «── Перешли в Задачи · Сегодня ──»).
 */
export function needsContextDivider(previous: SurfaceContext | undefined, next: SurfaceContext): boolean {
  if (!previous) return false
  if (previous.surface !== next.surface) return true
  if (previous.title !== next.title) return true
  const key = (ref: EntityRef | undefined) => (ref ? `${ref.kind}:${ref.id}` : '')
  return key(previous.focus) !== key(next.focus)
}

// ---------------------------------------------------------------------------
// Approvals + realtime
// ---------------------------------------------------------------------------

/**
 * Approval state changes arrive on the `agent.approvals` topic (TECH-SPEC
 * §18.2). The wire topic is W1-03's `user:<principalId>` (ACL target `self`);
 * `agent.approvals` is the logical topic name.
 */
export const AGENT_APPROVALS_TOPIC = 'agent.approvals'
export const AGENT_APPROVALS_EVENT_TYPE = 'approval.changed'

export function agentApprovalsWireTopic(principalId: string): string {
  if (typeof principalId !== 'string' || principalId.length === 0) throw new Error('agentApprovalsWireTopic needs a principal id')
  return `user:${principalId}`
}

/** Status dot on the top-bar @rox button and the rail pill (UI-SPEC §25.2). */
export const AGENT_PANEL_STATUSES = ['idle', 'thinking', 'awaiting-approval', 'error'] as const
export type AgentPanelStatus = (typeof AGENT_PANEL_STATUSES)[number]

// ---------------------------------------------------------------------------
// Persisted UI state ({configDir}/ui/*.json, ADR-U13)
// ---------------------------------------------------------------------------

/**
 * File names under `{configDir}` only: `@rox/core` has no config-dir
 * dependency, so the caller resolves `~/rox` through
 * `resolveConfigDir()` / `getConfigPaths()` in `@rox/shared/config` and joins
 * these relative names. Never a path under the home directory.
 */
export const AGENT_PANEL_STATE_FILE = 'ui/agent-panel.json'
export const AGENT_PANEL_DRAFTS_FILE = 'ui/agent-panel-drafts.json'
export const CHROME_STATE_FILE = 'ui/chrome.json'
export const LOCAL_PINS_FILE = 'ui/pins.json'

/** Dock state persisted per window and per surface class (UI-SPEC §25.5). */
export const AGENT_PANEL_DOCK_MODES = ['docked', 'shared', 'overlay', 'minimised', 'hidden'] as const
export type AgentPanelDockMode = (typeof AGENT_PANEL_DOCK_MODES)[number]

/** UI-SPEC §25.5: list surfaces and page surfaces remember their own width. */
export const AGENT_PANEL_SURFACE_CLASSES = ['list', 'page'] as const
export type AgentPanelSurfaceClass = (typeof AGENT_PANEL_SURFACE_CLASSES)[number]

export interface AgentPanelUiState {
  /** Schema version of the JSON file; a bump needs a migration. */
  version: 1
  visible: boolean
  /** `minimised` renders the rail pill; `hidden` renders nothing. */
  dock: AgentPanelDockMode
  /** Per surface class, so a list stays wide while a page stays narrow. */
  widthByClass: Record<AgentPanelSurfaceClass, number>
  /** Open at launch (Settings → Панели, §26.4; default off). */
  openAtLaunch: boolean
  /** «Прикреплять контекст автоматически» (§26.4; default on). */
  autoContext: boolean
  /** «Показывать быстрые действия» (§26.4; default on). */
  showQuickActions: boolean
}

export const DEFAULT_AGENT_PANEL_UI_STATE: AgentPanelUiState = {
  version: 1,
  visible: false,
  dock: 'docked',
  widthByClass: { list: AGENT_PANEL_DEFAULT_WIDTH, page: AGENT_PANEL_DEFAULT_WIDTH },
  openAtLaunch: false,
  autoContext: true,
  showQuickActions: true,
}

/** Clamp a persisted width to the allowed range (a hand-edited file must not break the shell). */
export function clampAgentPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_PANEL_DEFAULT_WIDTH
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)))
}

export interface AgentPanelDraftsState {
  version: 1
  /** Current topic per workspace (`null` key = local-only). */
  topicByWorkspace: Record<string, string>
  /** Unsent composer text per topic id. */
  draftByTopic: Record<string, string>
}

export const DEFAULT_AGENT_PANEL_DRAFTS_STATE: AgentPanelDraftsState = {
  version: 1,
  topicByWorkspace: {},
  draftByTopic: {},
}

export interface ChromeUiState {
  version: 1
  /** Per surface: remembered sidebar width and collapsed state (§26.1). */
  surfaces: Record<string, { width: number; collapsed: boolean }>
  /** Whether the sidebar may auto-collapse before the agent shrinks MAIN (§25.5 rule 4). */
  autoCollapseOnAgent: boolean
  /** Settings → Панели: `red` (action only) | `all` | `none` (§26.4). */
  counters: 'red' | 'all' | 'none'
  /** Settings → Панели: show the «Закреплённое» section (§26.4). */
  showPinned: boolean
}

export const DEFAULT_CHROME_UI_STATE: ChromeUiState = {
  version: 1,
  surfaces: {},
  autoCollapseOnAgent: true,
  counters: 'all',
  showPinned: true,
}