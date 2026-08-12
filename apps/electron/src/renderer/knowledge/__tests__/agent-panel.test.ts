/**
 * KnowledgeAgentPanel logic tests — the CTA text builders that carry the
 * selected document into a freshly created agent session (via the existing
 * action/new-session route: input prefill or send). The knowledge mention
 * token must survive verbatim so the new session's composer renders the
 * knowledge badge and the agent can resolve the ref with knowledge_read.
 *
 * Strings are user-facing → the builders take the i18next `t` (tests inject a
 * minimal interpolating stub over the same key names).
 */
import { describe, expect, it } from 'bun:test'
import type { KnowledgeRef } from '../../../shared/types'
import {
  buildAskAboutPrefill,
  buildOpenSessionBrief,
  knowledgeMentionToken,
} from '../KnowledgeAgentPanel'

const DOC_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: '20260807142000-x1afz9' }

const TEST_TEMPLATES: Record<string, string> = {
  'knowledge.agent.askPrefill': '{{mention}} — question about {{title}}: ',
  'knowledge.agent.openSessionBrief':
    'Context: the user is viewing {{mention}} ({{title}}). Read it with knowledge_read (contextMode: "snapshot") and orient me.',
}

/** Minimal i18next-shaped stub: key lookup + {{var}} interpolation. */
function t(key: string, params?: Record<string, unknown>): string {
  const template = TEST_TEMPLATES[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(params?.[name] ?? ''))
}

describe('knowledgeMentionToken', () => {
  it('builds the full-form mention token for the default provider', () => {
    expect(knowledgeMentionToken(DOC_REF)).toBe('[knowledge:siyuan/document/20260807142000-x1afz9]')
  })

  it('keeps a non-default provider in the token', () => {
    const ref: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'b-1', provider: 'obsidian' }
    expect(knowledgeMentionToken(ref)).toBe('[knowledge:obsidian/block/b-1]')
  })
})

describe('buildAskAboutPrefill', () => {
  it('starts with the mention token and includes the document title when known', () => {
    const prefill = buildAskAboutPrefill(DOC_REF, 'Kernel Guide', t)
    expect(prefill.startsWith('[knowledge:siyuan/document/20260807142000-x1afz9]')).toBe(true)
    expect(prefill).toContain('Kernel Guide')
  })

  it('stays meaningful when the node title has not loaded (falls back to the ref display)', () => {
    const prefill = buildAskAboutPrefill(DOC_REF, null, t)
    expect(prefill).toContain('[knowledge:siyuan/document/20260807142000-x1afz9]')
    expect(prefill).toContain('@siyuan/document/20260807142000-x1afz9')
  })
})

describe('buildOpenSessionBrief', () => {
  it('carries the mention token, title, and a knowledge_read instruction', () => {
    const brief = buildOpenSessionBrief(DOC_REF, 'Kernel Guide', t)
    expect(brief).toContain('[knowledge:siyuan/document/20260807142000-x1afz9]')
    expect(brief).toContain('Kernel Guide')
    expect(brief).toContain('knowledge_read')
  })

  it('works without a title', () => {
    const brief = buildOpenSessionBrief(DOC_REF, null, t)
    expect(brief).toContain('[knowledge:siyuan/document/20260807142000-x1afz9]')
    expect(brief).toContain('knowledge_read')
  })
})
