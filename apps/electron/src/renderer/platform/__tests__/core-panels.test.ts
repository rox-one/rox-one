/**
 * Ticket 11 — Knowledge inspector PanelHost contribution.
 *
 * No DOM harness: registry.list + route→ref helpers + source wiring.
 * getAppPanelRegistry() is empty until registerCorePanels() bootstraps.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getAppPanelRegistry } from '../panel-registry-state'
import {
  KNOWLEDGE_INSPECTOR_PANEL_ID,
  knowledgeCompanionRefFromRoute,
  registerCorePanels,
} from '../core-panels'
import { panelContextKeysFromRoute } from '../surface-tab-model'

const platformDir = join(import.meta.dir, '..')

describe('getAppPanelRegistry after registerCorePanels', () => {
  const registry = registerCorePanels(getAppPanelRegistry(), () => null)

  it('lists knowledge.inspector on slot inspector when activeSurface is knowledge', () => {
    const listed = registry.list('inspector', { activeSurface: 'knowledge' })
    expect(listed.map((p) => p.id)).toContain(KNOWLEDGE_INSPECTOR_PANEL_ID)
    const panel = listed.find((p) => p.id === KNOWLEDGE_INSPECTOR_PANEL_ID)
    expect(panel?.slot).toBe('inspector')
    expect(panel?.when).toBe("activeSurface=='knowledge'")
    expect(panel?.source).toEqual({ type: 'core', id: 'knowledge' })
  })

  it('does not list knowledge.inspector when activeSurface is session', () => {
    expect(registry.list('inspector', { activeSurface: 'session' }).map((p) => p.id)).not.toContain(
      KNOWLEDGE_INSPECTOR_PANEL_ID,
    )
  })

  it('does not list knowledge.inspector when activeSurface is undefined', () => {
    expect(registry.list('inspector', {}).map((p) => p.id)).not.toContain(KNOWLEDGE_INSPECTOR_PANEL_ID)
  })

  it('leaves other PanelHost slots empty (this ticket registers inspector only)', () => {
    const ctx = { activeSurface: 'knowledge' }
    expect(registry.list('activity', ctx)).toEqual([])
    expect(registry.list('navigator-primary', ctx)).toEqual([])
    expect(registry.list('navigator-secondary', ctx)).toEqual([])
    expect(registry.list('bottom', ctx)).toEqual([])
    expect(registry.list('status', ctx)).toEqual([])
  })

  it('is idempotent — a second bootstrap does not throw', () => {
    expect(() => registerCorePanels(registry, () => null)).not.toThrow()
  })
})

describe('knowledgeCompanionRefFromRoute', () => {
  it('derives a document companion ref from a knowledge surface route', () => {
    expect(knowledgeCompanionRefFromRoute('knowledge/document/doc-1')).toEqual({
      scheme: 'siyuan',
      kind: 'document',
      id: 'doc-1',
    })
  })

  it('derives a block companion ref', () => {
    expect(knowledgeCompanionRefFromRoute('knowledge/block/b-1')).toEqual({
      scheme: 'siyuan',
      kind: 'block',
      id: 'b-1',
    })
  })

  it('returns null for notebooks, databases, sessions, and missing routes', () => {
    expect(knowledgeCompanionRefFromRoute('knowledge/notebook/nb-1')).toBeNull()
    expect(knowledgeCompanionRefFromRoute('knowledge/database/db-9')).toBeNull()
    expect(knowledgeCompanionRefFromRoute('allSessions/session/session-1')).toBeNull()
    expect(knowledgeCompanionRefFromRoute(null)).toBeNull()
  })
})

describe('KnowledgeInspectorPanel render contribution (source wiring)', () => {
  it('renders real KnowledgeInspector from the focused route companion ref', () => {
    const src = readFileSync(join(platformDir, 'KnowledgeInspectorPanel.tsx'), 'utf8')
    expect(src).toContain("from '@/knowledge/KnowledgeInspector'")
    expect(src).toContain('<KnowledgeInspector')
    expect(src).toContain('knowledgeCompanionRefFromRoute')
    expect(src).not.toMatch(/coming soon/i)
  })
})
