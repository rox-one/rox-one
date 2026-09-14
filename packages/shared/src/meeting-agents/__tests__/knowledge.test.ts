import { describe, expect, test } from 'bun:test'
import { Rox2NoteRepository, Rox2RelationGraph, Rox2RevisionConflict } from '@craft-agent/core/rox2'
import type { MeetingGrant } from '../policies.ts'
import {
  applyKnowledgeChange,
  createMemoryKnowledgeStore,
  createRox2KnowledgeStore,
  decodeKnowledgeProperties,
  encodeKnowledgeProperties,
  matchKnowledgeFilter,
  proposeKnowledgeChange,
  type KnowledgePropertyValue,
} from '../knowledge.ts'

const actor = {
  accountId: 'acct-1',
  workspaceId: 'ws',
  deviceId: 'dev-1',
  authenticated: true as const,
}

const grant: MeetingGrant = {
  id: 'g-archive',
  actorId: 'acct-1',
  workspaceId: 'ws',
  deviceId: 'dev-1',
  capabilities: ['archive.durable'],
  expiresAt: 9_000,
}

const meetingRef = { workspaceId: 'ws', entityId: 'meet-1', revisionId: '3' }

const evidence = {
  meeting: meetingRef,
  segmentId: 'seg-decision',
  segmentRevision: 2,
  startMs: 1_000,
  endMs: 4_000,
  quote: 'Срок прототипа — понедельник, не пятница.',
}

const customFields: Record<string, KnowledgePropertyValue> = {
  owner: { type: 'string', value: 'Иван Петров' },
  due: { type: 'date', value: '2026-09-18' },
  blocking: { type: 'boolean', value: false },
  confidence: { type: 'number', value: 0.8 },
  severity: { type: 'enum', value: 'high' },
}

function seedDecision(
  store = createMemoryKnowledgeStore(),
  extra?: { title?: string; audience?: 'private' | 'shared'; permissions?: readonly ['read'] | readonly [] },
) {
  const note = store.create({
    ref: { workspaceId: 'ws', entityId: 'decision-launch', revisionId: '1' },
    title: extra?.title ?? 'Launch date',
    body: 'Ship Friday',
    properties: encodeKnowledgeProperties({
      kind: { type: 'enum', value: 'decision' },
      status: { type: 'enum', value: 'active' },
      decisionKey: { type: 'string', value: 'launch-date' },
    }),
    audience: extra?.audience ?? 'shared',
    permissions: extra?.permissions ?? ['read'],
  })
  return { store, note }
}

describe('meeting knowledge (issue 371 / I015)', () => {
  test('concurrent edit conflicts instead of overwriting the user note', () => {
    const { store, note } = seedDecision()
    store.update(note.ref, { body: 'Ship Friday — edited by user' }, note.ref.revisionId)

    const result = proposeKnowledgeChange({
      actor,
      grants: [grant],
      now: 1,
      meetingRef,
      title: 'Launch date',
      body: 'Ship Monday',
      decisionKey: 'launch-date',
      targetRef: note.ref,
      baseRevision: note.ref.revisionId,
      properties: customFields,
      evidence,
    }, store)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('conflict')
    expect(store.get(note.ref)?.body).toBe('Ship Friday — edited by user')
    expect(store.get(note.ref)?.ref.entityId).toBe('decision-launch')
  })

  test('custom field round-trip uses the shared property schema', () => {
    const encoded = encodeKnowledgeProperties(customFields)
    const decoded = decodeKnowledgeProperties(encoded)
    expect(decoded).toEqual(customFields)
    expect(decoded.due).toEqual({ type: 'date', value: '2026-09-18' })
    expect(JSON.stringify(decoded.due)).not.toContain('T00:00:00')

    const { store, note } = seedDecision()
    const proposed = proposeKnowledgeChange({
      actor,
      grants: [grant],
      now: 1,
      meetingRef,
      title: 'Launch date',
      body: 'Ship Monday',
      decisionKey: 'launch-date',
      targetRef: { ...note.ref, revisionId: store.get(note.ref)!.ref.revisionId },
      baseRevision: store.get(note.ref)!.ref.revisionId,
      properties: customFields,
      evidence,
    }, store)
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(proposed.proposal.status).toBe('proposed')
    expect(proposed.proposal.applied).toBe(false)
    expect(proposed.proposal.action).toBe('update')
    expect(proposed.proposal.properties).toEqual(expect.objectContaining(customFields))
    expect(proposed.proposal.diff.some((field) => field.field === 'due')).toBe(true)
    expect(matchKnowledgeFilter(
      { title: 'Launch date', properties: encodeKnowledgeProperties(proposed.proposal.properties) },
      { attributes: { severity: 'high' } },
    )).toBe(true)
  })

  test('renamed note keeps EntityId and is reused instead of duplicated', () => {
    const { store, note } = seedDecision()
    const renamed = store.rename(note.ref, 'Launch date (Q3)', note.ref.revisionId)
    expect(renamed.ref.entityId).toBe('decision-launch')
    expect(renamed.title).toBe('Launch date (Q3)')

    const proposed = proposeKnowledgeChange({
      actor,
      grants: [grant],
      now: 1,
      meetingRef,
      title: 'Launch date (Q3)',
      body: 'Ship Monday',
      decisionKey: 'launch-date',
      baseRevision: renamed.ref.revisionId,
      properties: customFields,
      evidence,
    }, store)
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(proposed.proposal.action).toBe('update')
    expect(proposed.proposal.targetRef?.entityId).toBe('decision-launch')
    expect(store.list('ws')).toHaveLength(1)
  })

  test('old decision is superseded and history remains readable', () => {
    const { store, note } = seedDecision()
    const graph = new Rox2RelationGraph()
    const proposed = proposeKnowledgeChange({
      actor,
      grants: [grant],
      now: 1,
      meetingRef,
      title: 'Launch date',
      body: 'Ship Monday',
      decisionKey: 'launch-date',
      supersedeRef: note.ref,
      baseRevision: note.ref.revisionId,
      properties: customFields,
      evidence,
    }, store, graph)
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    expect(proposed.proposal.action).toBe('supersede')
    expect(proposed.proposal.applied).toBe(false)
    expect(proposed.proposal.relations.some((edge) => edge.kind === 'replaces')).toBe(true)

    const applied = applyKnowledgeChange(proposed.proposal, store, { applyEnabled: true, graph })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.note.ref.entityId).not.toBe('decision-launch')
    const previous = store.get(note.ref)
    expect(previous).toBeTruthy()
    expect(decodeKnowledgeProperties(previous!.properties).status).toEqual({ type: 'enum', value: 'superseded' })
    expect(applied.note.ref.entityId).not.toBe(previous!.ref.entityId)
    expect(graph.query().some((edge) => edge.kind === 'replaces' && edge.toId.includes('decision-launch'))).toBe(true)

    const restarted = createMemoryKnowledgeStore()
    restarted.restore(store.snapshot())
    expect(restarted.get(previous!.ref)?.body).toBe('Ship Friday')
    expect(restarted.get(applied.note.ref)?.body).toBe('Ship Monday')
    expect(restarted.get(applied.note.ref)?.meetingRef?.entityId).toBe('meet-1')
  })

  test('denied related source is excluded from shared memory', () => {
    const { store } = seedDecision()
    store.create({
      ref: { workspaceId: 'ws', entityId: 'private-salary', revisionId: '1' },
      title: 'Private salary',
      body: 'SECRET_PAYROLL 9000',
      properties: {},
      audience: 'private',
      permissions: [],
    })

    const result = proposeKnowledgeChange({
      actor,
      grants: [grant],
      now: 1,
      meetingRef,
      title: 'Budget note',
      body: 'Use the salary figure',
      relatedSourceIds: ['note:ws:private-salary@1'],
      closedSourceIds: ['note:ws:private-salary@1'],
      audience: 'shared',
      properties: customFields,
      evidence,
    }, store)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('denied-source')
    expect(JSON.stringify(result)).not.toContain('SECRET_PAYROLL')
    expect(store.list('ws').filter((note) => note.audience === 'shared').every((note) => !note.body.includes('SECRET_PAYROLL'))).toBe(true)
  })

  test('apply can be disabled while keeping the proposal and note versions', () => {
    const { store, note } = seedDecision()
    const proposed = proposeKnowledgeChange({
      actor,
      grants: [grant],
      now: 1,
      meetingRef,
      title: 'Launch date',
      body: 'Ship Monday',
      decisionKey: 'launch-date',
      targetRef: note.ref,
      baseRevision: note.ref.revisionId,
      properties: customFields,
      evidence,
    }, store)
    expect(proposed.ok).toBe(true)
    if (!proposed.ok) return
    const disabled = applyKnowledgeChange(proposed.proposal, store, { applyEnabled: false })
    expect(disabled.ok).toBe(false)
    if (!disabled.ok) expect(disabled.code).toBe('apply-disabled')
    expect(store.get(note.ref)?.body).toBe('Ship Friday')
    expect(proposed.proposal.status).toBe('proposed')
  })

  test('Rox2 notes seam preserves entity id on rename and CAS-conflicts a stale write', () => {
    const repo = new Rox2NoteRepository()
    const created = repo.createLocal({
      ref: { workspaceId: 'ws', entityId: 'n-stable', revisionId: '1' },
      title: 'Old title',
      body: 'v1',
      properties: { decisionKey: 'launch-date' },
    })
    const renamed = repo.rename(created.ref, 'New title', created.ref.revisionId)
    expect(renamed.ref.entityId).toBe('n-stable')
    expect(repo.getByEntityId('ws', 'n-stable')?.title).toBe('New title')
    expect(() => repo.update(created.ref, { body: 'stale' }, created.ref.revisionId)).toThrow(Rox2RevisionConflict)
    expect(repo.getByEntityId('ws', 'n-stable')?.body).toBe('v1')

    const store = createRox2KnowledgeStore(repo)
    const found = proposeKnowledgeChange({
      actor,
      grants: [grant],
      now: 1,
      meetingRef,
      title: 'New title',
      decisionKey: 'launch-date',
      baseRevision: renamed.ref.revisionId,
      body: 'v2',
      properties: customFields,
      evidence,
    }, store)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.proposal.targetRef?.entityId).toBe('n-stable')
  })
})
