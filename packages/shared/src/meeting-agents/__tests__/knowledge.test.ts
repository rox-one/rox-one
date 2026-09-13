import { describe, expect, test } from 'bun:test'
import { proposeKnowledgeChange } from '../knowledge.ts'

describe('meeting knowledge (RMA-I015)', () => {
  test('concurrent edit conflicts instead of silent overwrite', () => {
    const result = proposeKnowledgeChange({
      records: [{ entityId: 'note:1', title: 'Decision', body: 'v1', revision: '2', properties: { status: 'open' } }],
      title: 'Decision',
      body: 'v2',
      baseRevision: '1',
    })
    expect(result).toEqual({ status: 'conflict', existingRevision: '2' })
  })

  test('custom field round-trip and supersede', () => {
    const created = proposeKnowledgeChange({ records: [], title: 'Decision', body: 'A', properties: { owner: 'Ada' } })
    expect(created.status).toBe('ok')
    const updated = proposeKnowledgeChange({
      records: [{ entityId: 'note:1', title: 'Decision', body: 'A', revision: '1', properties: { owner: 'Ada' } }],
      title: 'Decision',
      body: 'B',
      properties: { owner: 'Ada', status: 'done' },
      baseRevision: '1',
    })
    expect(updated.status).toBe('ok')
    if (updated.status === 'ok') {
      expect(updated.proposal.kind).toBe('supersede')
      expect(updated.proposal.properties.status).toBe('done')
    }
  })

  test('renamed note keeps entity id; denied related source is blocked', () => {
    const renamed = proposeKnowledgeChange({
      records: [{ entityId: 'note:keep', title: 'Decision', body: 'A', revision: '1', properties: {} }],
      title: 'Decision',
      body: 'A2',
      baseRevision: '1',
    })
    expect(renamed.status).toBe('ok')
    if (renamed.status === 'ok') expect(renamed.proposal.entityId).toBe('note:keep')
    expect(proposeKnowledgeChange({
      records: [],
      title: 'Secret',
      body: 'no',
      relatedPrivate: true,
    })).toEqual({ status: 'denied', code: 'private-source' })
  })
})
