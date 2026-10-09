/**
 * W1-15 (#1512) acceptance — agent-panel runtime contract: the session origin,
 * `contextSnapshot` on messages, the context divider and the persisted UI
 * state shapes (`{configDir}/ui/*.json`), with the flags-off inertness.
 */
import { describe, expect, it } from 'bun:test'
import {
  AGENT_APPROVALS_EVENT_TYPE,
  AGENT_APPROVALS_TOPIC,
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_DRAFTS_FILE,
  AGENT_PANEL_LABEL,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  AGENT_PANEL_ORIGIN,
  AGENT_PANEL_STATE_FILE,
  AGENT_PANEL_STATUSES,
  CHROME_STATE_FILE,
  DEFAULT_AGENT_PANEL_DRAFTS_STATE,
  DEFAULT_AGENT_PANEL_UI_STATE,
  DEFAULT_CHROME_UI_STATE,
  LOCAL_PINS_FILE,
  agentApprovalsWireTopic,
  agentPanelCommandOrigin,
  asAgentPanelProposal,
  clampAgentPanelWidth,
  hasContextSnapshot,
  needsContextDivider,
  withContextSnapshot,
  type AgentPanelSession,
} from '../session.ts'
import { fallbackSurfaceContext, type SurfaceContext } from '../context.ts'

const ref = (kind: string, id: string) => ({ kind: kind as never, id })

const context = (over: Partial<SurfaceContext> = {}): SurfaceContext => ({
  ...fallbackSurfaceContext({ surface: 'docs', route: 'rox://docs/note:n1', title: 'Q4 план', workspaceId: 'w1' }),
  ...over,
})

describe('W1-15 §18.2 — the panel is an ordinary session', () => {
  it('uses the origin and label the spec names, with no new runtime', () => {
    expect(AGENT_PANEL_ORIGIN).toBe('agent-panel')
    expect(AGENT_PANEL_LABEL).toBe('agent-panel')
    const session: AgentPanelSession = {
      sessionId: 's1',
      workspaceId: 'w1',
      origin: AGENT_PANEL_ORIGIN,
      labels: [AGENT_PANEL_LABEL],
      title: 'План релиза',
    }
    expect(session.origin).toBe('agent-panel')
    expect(session.labels).toContain('agent-panel')
  })

  it('stamps every proposal with the agent-panel origin', () => {
    const origin = agentPanelCommandOrigin({ sessionId: 's1', messageId: 'm1', surface: 'docs' })
    expect(origin).toEqual({ kind: 'agent-panel', sessionId: 's1', messageId: 'm1', surface: 'docs' })
    expect(agentPanelCommandOrigin({ sessionId: 's1' })).toEqual({ kind: 'agent-panel', sessionId: 's1' })

    const stamped = asAgentPanelProposal(
      { commandId: 'c1', idempotencyKey: 'c1', type: 'tasks.create', payload: {}, issuedAt: '2026-10-08T00:00:00.000Z' },
      origin,
    )
    expect(stamped.origin).toEqual(origin)
    expect(stamped.payload).toEqual({})
  })

  it('addresses approval state through the agent.approvals topic on the user wire topic', () => {
    expect(AGENT_APPROVALS_TOPIC).toBe('agent.approvals')
    expect(AGENT_APPROVALS_EVENT_TYPE).toBe('approval.changed')
    expect(agentApprovalsWireTopic('p1')).toBe('user:p1')
    expect(() => agentApprovalsWireTopic('')).toThrow()
    expect(AGENT_PANEL_STATUSES).toEqual(['idle', 'thinking', 'awaiting-approval', 'error'])
  })
})

describe('W1-15 §18.2 — message envelope', () => {
  it('stores the context snapshot on the user message for audit and replay', () => {
    const message = withContextSnapshot(
      { role: 'user' as const, sessionId: 's1', messageId: 'm1', body: { text: 'Сделай задачи' }, at: '2026-10-08T10:00:00.000Z' },
      context({ focus: ref('note', 'n1') }),
    )
    expect(message.contextSnapshot.focus).toEqual({ kind: 'note', id: 'n1' })
    expect(hasContextSnapshot(message)).toBe(true)
    expect(hasContextSnapshot({})).toBe(false)
    expect(hasContextSnapshot({ contextSnapshot: 'x' })).toBe(false)
  })

  it('needs a divider when the surface, the title or the focus changed', () => {
    const base = context({ focus: ref('note', 'n1') })
    expect(needsContextDivider(undefined, base)).toBe(false)
    expect(needsContextDivider(base, base)).toBe(false)
    expect(needsContextDivider(base, { ...base, surface: 'tasks' })).toBe(true)
    expect(needsContextDivider(base, { ...base, title: 'Сегодня' })).toBe(true)
    expect(needsContextDivider(base, { ...base, focus: ref('task', 't1') })).toBe(true)
    expect(needsContextDivider(base, { ...base, focus: undefined })).toBe(true)
    // Only the selection changing is not a divider: the context bar shows it.
    expect(needsContextDivider(base, { ...base, selection: [ref('task', 't1')] })).toBe(false)
  })
})

describe('W1-15 §18.2 — persisted UI state', () => {
  it('resolves its files under the config dir, never under the home directory', () => {
    for (const file of [AGENT_PANEL_STATE_FILE, AGENT_PANEL_DRAFTS_FILE, CHROME_STATE_FILE, LOCAL_PINS_FILE]) {
      expect(file.startsWith('ui/')).toBe(true)
      expect(file).not.toContain('~')
      expect(file).not.toContain('.rox')
      expect(file).not.toContain('Documents')
    }
  })

  it('sums the defaults of §25.3, §25.5 and §26.4', () => {
    expect(AGENT_PANEL_DEFAULT_WIDTH).toBe(380)
    expect(AGENT_PANEL_MIN_WIDTH).toBe(320)
    expect(AGENT_PANEL_MAX_WIDTH).toBe(560)
    expect(DEFAULT_AGENT_PANEL_UI_STATE).toEqual({
      version: 1,
      visible: false,
      dock: 'docked',
      widthByClass: { list: 380, page: 380 },
      openAtLaunch: false,
      autoContext: true,
      showQuickActions: true,
    })
    expect(DEFAULT_AGENT_PANEL_DRAFTS_STATE).toEqual({ version: 1, topicByWorkspace: {}, draftByTopic: {} })
    expect(DEFAULT_CHROME_UI_STATE).toEqual({
      version: 1,
      surfaces: {},
      autoCollapseOnAgent: true,
      counters: 'all',
      showPinned: true,
    })
  })

  it('clamps a persisted width into the §25.3 range', () => {
    expect(clampAgentPanelWidth(380)).toBe(380)
    expect(clampAgentPanelWidth(10)).toBe(AGENT_PANEL_MIN_WIDTH)
    expect(clampAgentPanelWidth(9999)).toBe(AGENT_PANEL_MAX_WIDTH)
    expect(clampAgentPanelWidth(399.6)).toBe(400)
    expect(clampAgentPanelWidth(Number.NaN)).toBe(AGENT_PANEL_DEFAULT_WIDTH)
  })
})