import { describe, expect, it } from 'bun:test'
import {
  buildNewDocumentCreateArgs,
  documentRouteForConnection,
  isLocalMarkdownConnection,
  knowledgeRefRoute,
  notebookIdForNewDocument,
  pickOpenNotebook,
  selectPreferredKnowledgeConnection,
} from '../knowledge-new-note'

describe('pickOpenNotebook', () => {
  it('prefers the first not-closed notebook', () => {
    const picked = pickOpenNotebook([
      { id: 'closed-first', closed: true },
      { id: 'open-a', closed: false },
      { id: 'open-b', closed: false },
    ])
    expect(picked?.id).toBe('open-a')
  })

  it('falls back to the first notebook when all are closed', () => {
    const picked = pickOpenNotebook([
      { id: 'a', closed: true },
      { id: 'b', closed: true },
    ])
    expect(picked?.id).toBe('a')
  })

  it('treats missing closed as open', () => {
    expect(pickOpenNotebook([{ id: 'implicit-open' }])?.id).toBe('implicit-open')
  })

  it('returns undefined for an empty list', () => {
    expect(pickOpenNotebook([])).toBeUndefined()
  })
})

describe('buildNewDocumentCreateArgs', () => {
  it('builds navigator document create args', () => {
    expect(
      buildNewDocumentCreateArgs({
        connectionId: 'conn-1',
        notebookId: 'nb-9',
        title: 'Untitled',
      }),
    ).toEqual({
      connectionId: 'conn-1',
      source: 'navigator',
      op: 'document',
      notebookId: 'nb-9',
      title: 'Untitled',
      path: '/',
    })
  })
})

describe('local Markdown creation and open routing', () => {
  const localConnection = { id: 'local-markdown:workspace', provider: 'local-markdown' }

  it('uses its synthetic notebook without listing legacy SiYuan notebooks', () => {
    expect(isLocalMarkdownConnection(localConnection)).toBe(true)
    expect(notebookIdForNewDocument(localConnection, [])).toBe('local-notes')
  })

  it('prefers local Markdown even when a legacy connection is listed first', () => {
    expect(selectPreferredKnowledgeConnection([
      { id: 'siyuan-local', provider: 'siyuan' },
      localConnection,
    ])).toEqual(localConnection)
  })

  it('keeps legacy notebook selection for explicitly non-local connections', () => {
    expect(notebookIdForNewDocument({ id: 'siyuan-local', provider: 'siyuan' }, [
      { id: 'legacy-notebook', closed: false },
    ])).toBe('legacy-notebook')
  })

  it('opens local documents in the Notes page and legacy documents in the SiYuan route', () => {
    expect(documentRouteForConnection(localConnection, 'daily/Untitled')).toBe('notes-legacy/note/daily%2FUntitled')
    expect(documentRouteForConnection({ provider: 'siyuan' }, 'doc-1')).toBe('knowledge/document/doc-1')
    expect(knowledgeRefRoute({ scheme: 'local-note', kind: 'document', id: 'project/Plan' })).toBe('notes-legacy/note/project%2FPlan')
  })
})
