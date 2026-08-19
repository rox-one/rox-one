/**
 * Knowledge entity surface mount — KnowledgeAgentPanel must be reachable from
 * KnowledgeEntityPage / KnowledgeInspector (it existed as dead UI). Companion
 * ref decides when the inspector+CTAs column is shown. No DOM harness: source
 * wiring + the exported ref helper (KnowledgeHome / panel-host-wiring precedent).
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SIYUAN_FULL_SURFACE_ID } from '../siyuan-url'
import { knowledgeEntityCompanionRef } from '../knowledge-entity-ref'

const knowledgeDir = join(import.meta.dir, '..')
const pagesDir = join(knowledgeDir, '..', 'pages')

describe('knowledgeEntityCompanionRef', () => {
  it('returns a siyuan document ref for a real document id', () => {
    expect(knowledgeEntityCompanionRef('document', '20260807142000-x1afz9')).toEqual({
      scheme: 'siyuan',
      kind: 'document',
      id: '20260807142000-x1afz9',
    })
  })

  it('returns a block ref so block surfaces still get the CTAs', () => {
    expect(knowledgeEntityCompanionRef('block', 'b-1')).toEqual({
      scheme: 'siyuan',
      kind: 'block',
      id: 'b-1',
    })
  })

  it('hides the companion on the full-UI compat surface (not a document)', () => {
    expect(knowledgeEntityCompanionRef('notebook', SIYUAN_FULL_SURFACE_ID)).toBeNull()
  })

  it('hides the companion for notebooks and databases (not “this document”)', () => {
    expect(knowledgeEntityCompanionRef('notebook', 'nb-1')).toBeNull()
    expect(knowledgeEntityCompanionRef('database', 'db-1')).toBeNull()
    expect(knowledgeEntityCompanionRef('asset', 'a-1')).toBeNull()
  })
})

describe('knowledge entity surface mounts KnowledgeAgentPanel', () => {
  it('KnowledgeInspector imports and renders KnowledgeAgentPanel', () => {
    const src = readFileSync(join(knowledgeDir, 'KnowledgeInspector.tsx'), 'utf8')
    expect(src).toContain("from './KnowledgeAgentPanel'")
    expect(src).toContain('<KnowledgeAgentPanel')
  })

  it('KnowledgeEntityPage mounts KnowledgeInspector (which hosts the agent CTAs)', () => {
    const src = readFileSync(join(pagesDir, 'KnowledgeEntityPage.tsx'), 'utf8')
    expect(src).toContain("from '@/knowledge/KnowledgeInspector'")
    expect(src).toContain('<KnowledgeInspector')
    expect(src).toContain('knowledgeEntityCompanionRef')
  })

  it('classic aside stays on the flag-off path; unified shell hides the duplicate', () => {
    const src = readFileSync(join(pagesDir, 'KnowledgeEntityPage.tsx'), 'utf8')
    expect(src).toContain('featureUnifiedShellAtom')
    expect(src).toContain('!unifiedShellEnabled')
    expect(src).toContain('<KnowledgeInspector')
  })
})
