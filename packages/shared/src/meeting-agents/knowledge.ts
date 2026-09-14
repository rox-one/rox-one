/**
 * Meeting → native Notes knowledge proposals (issue #371 / I015, R26/R28).
 * Looks up an existing allowed note, then proposes create/update/supersede
 * with a base revision, typed properties and EvidenceSpan.
 * Notes remain the canonical store; the meeting keeps links and spans.
 */

import {
  Rox2NoteRepository,
  Rox2RelationGraph,
  assertRelationKinds,
  bumpNoteRevision,
  formatRox2EntityId,
  sha256Json,
  type Rox2EntityRef,
  type Rox2NoteRecord,
  type Rox2Permission,
  type Rox2Relation,
  type Rox2RelationKind,
} from '@craft-agent/core/rox2'
import type { KnowledgeViewFilter } from '../views/types.ts'
import {
  authorizeMeetingAction,
  type MeetingActor,
  type MeetingGrant,
} from './policies.ts'

export const KNOWLEDGE_PROPERTY_TYPES = ['string', 'number', 'boolean', 'date', 'enum'] as const
export type KnowledgePropertyType = (typeof KNOWLEDGE_PROPERTY_TYPES)[number]

export type KnowledgePropertyValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'enum'; value: string }

export const KNOWLEDGE_PROPERTY_SCHEMA: Record<string, { type: KnowledgePropertyType; enumValues?: readonly string[] }> = {
  blocking: { type: 'boolean' },
  confidence: { type: 'number' },
  decisionKey: { type: 'string' },
  due: { type: 'date' },
  kind: { type: 'enum', enumValues: ['decision', 'fact', 'requirement', 'question'] },
  owner: { type: 'string' },
  severity: { type: 'enum', enumValues: ['low', 'medium', 'high'] },
  status: { type: 'enum', enumValues: ['active', 'superseded'] },
  title: { type: 'string' },
}

export type KnowledgeChangeAction = 'create' | 'update' | 'supersede'

export type MeetingKnowledgeEvidence = {
  meeting: Rox2EntityRef
  segmentId: string
  segmentRevision: number
  startMs: number
  endMs: number
  quote: string
}

export type KnowledgeFieldDiff = {
  field: string
  before: unknown
  after: unknown
  type: KnowledgePropertyType
}

export type KnowledgeRelationEdge = {
  kind: Extract<Rox2RelationKind, 'replaces' | 'derived-from' | 'mentions'>
  fromId: string
  toId: string
}

export type KnowledgeNoteRecord = {
  ref: Rox2EntityRef
  title: string
  body: string
  properties: Record<string, unknown>
  audience: 'private' | 'shared'
  permissions: readonly Rox2Permission[]
  meetingRef?: Rox2EntityRef
}

export type KnowledgeStoreSnapshot = {
  notes: KnowledgeNoteRecord[]
}

export type KnowledgeStore = {
  list(workspaceId: string): KnowledgeNoteRecord[]
  get(ref: Pick<Rox2EntityRef, 'workspaceId' | 'entityId'>): KnowledgeNoteRecord | undefined
  create(note: KnowledgeNoteRecord): KnowledgeNoteRecord
  update(
    ref: Pick<Rox2EntityRef, 'workspaceId' | 'entityId'>,
    patch: Partial<Pick<KnowledgeNoteRecord, 'title' | 'body' | 'properties' | 'audience' | 'meetingRef'>>,
    expectedRevision: string,
  ): KnowledgeNoteRecord
  rename(ref: Pick<Rox2EntityRef, 'workspaceId' | 'entityId'>, title: string, expectedRevision: string): KnowledgeNoteRecord
  snapshot(): KnowledgeStoreSnapshot
  restore(snapshot: KnowledgeStoreSnapshot): void
}

export type KnowledgeChangeProposal = {
  id: string
  status: 'proposed'
  action: KnowledgeChangeAction
  applied: false
  workspaceId: string
  meetingRef: Rox2EntityRef
  targetRef?: Rox2EntityRef
  nextRef?: Rox2EntityRef
  baseRevision: string
  properties: Record<string, KnowledgePropertyValue>
  diff: KnowledgeFieldDiff[]
  body?: string
  title: string
  evidence: MeetingKnowledgeEvidence
  supersededRef?: Rox2EntityRef
  relations: KnowledgeRelationEdge[]
  payloadHash: string
  audience: 'private' | 'shared'
}

export type KnowledgeChangeDeniedCode =
  | 'conflict'
  | 'denied-source'
  | 'unauthenticated'
  | 'grant-missing'
  | 'invalid-properties'
  | 'apply-disabled'

export type KnowledgeChangeOk = { ok: true; proposal: KnowledgeChangeProposal }
export type KnowledgeChangeDenied = { ok: false; code: KnowledgeChangeDeniedCode; message: string }
export type KnowledgeChangeResult = KnowledgeChangeOk | KnowledgeChangeDenied

export type ProposeKnowledgeChangeInput = {
  actor: MeetingActor
  grants: readonly MeetingGrant[]
  now?: number
  meetingRef: Rox2EntityRef
  title: string
  body?: string
  kind?: 'decision' | 'fact' | 'requirement' | 'question'
  decisionKey?: string
  targetRef?: Rox2EntityRef
  baseRevision?: string
  properties?: Record<string, KnowledgePropertyValue>
  evidence: MeetingKnowledgeEvidence
  supersedeRef?: Rox2EntityRef
  relatedSourceIds?: readonly string[]
  closedSourceIds?: readonly string[]
  audience?: 'private' | 'shared'
  viewerPermissions?: Readonly<Record<string, readonly Rox2Permission[]>>
}

export type ApplyKnowledgeChangeOptions = {
  applyEnabled: boolean
  graph?: Rox2RelationGraph
  now?: number
}

const TYPE_TAG = '__knowledgeType'

function isPropertyType(value: unknown): value is KnowledgePropertyType {
  return typeof value === 'string' && (KNOWLEDGE_PROPERTY_TYPES as readonly string[]).includes(value)
}

export function encodeKnowledgeProperties(
  properties: Record<string, KnowledgePropertyValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
    out[key] = { [TYPE_TAG]: field.type, value: field.value }
  }
  return out
}

export function decodeKnowledgeProperties(
  raw: Record<string, unknown> | undefined,
): Record<string, KnowledgePropertyValue> {
  const out: Record<string, KnowledgePropertyValue> = {}
  if (!raw) return out
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    if (!isPropertyType(row[TYPE_TAG])) continue
    const type = row[TYPE_TAG]
    if (type === 'number' && typeof row.value === 'number') out[key] = { type, value: row.value }
    else if (type === 'boolean' && typeof row.value === 'boolean') out[key] = { type, value: row.value }
    else if ((type === 'string' || type === 'date' || type === 'enum') && typeof row.value === 'string') {
      out[key] = { type, value: row.value }
    }
  }
  return out
}

export function matchKnowledgeFilter(
  note: { title: string; properties: Record<string, unknown> },
  filter: KnowledgeViewFilter,
): boolean {
  if (filter.query && !note.title.toLowerCase().includes(filter.query.toLowerCase())) return false
  if (!filter.attributes) return true
  const decoded = decodeKnowledgeProperties(note.properties)
  for (const [name, expected] of Object.entries(filter.attributes)) {
    const actual = decoded[name]
    const raw = note.properties[name]
    const asText = actual ? String(actual.value) : raw == null ? '' : String(raw)
    if (asText !== expected) return false
  }
  return true
}

function cloneNote(note: KnowledgeNoteRecord): KnowledgeNoteRecord {
  return {
    ...note,
    ref: { ...note.ref },
    properties: { ...note.properties },
    permissions: [...note.permissions],
    meetingRef: note.meetingRef ? { ...note.meetingRef } : undefined,
  }
}

export function createMemoryKnowledgeStore(initial: readonly KnowledgeNoteRecord[] = []): KnowledgeStore {
  const notes = new Map<string, KnowledgeNoteRecord>()
  const keyOf = (ref: Pick<Rox2EntityRef, 'workspaceId' | 'entityId'>) => `${ref.workspaceId}:${ref.entityId}`
  const put = (note: KnowledgeNoteRecord) => {
    notes.set(keyOf(note.ref), cloneNote(note))
    return cloneNote(note)
  }
  for (const note of initial) put(note)
  const require = (ref: Pick<Rox2EntityRef, 'workspaceId' | 'entityId'>, expectedRevision?: string) => {
    const current = notes.get(keyOf(ref))
    if (!current) throw new Error(`Unknown knowledge note ${keyOf(ref)}`)
    if (expectedRevision != null && current.ref.revisionId !== expectedRevision) {
      const error = new Error('conflict') as Error & { code: string }
      error.code = 'conflict'
      throw error
    }
    return current
  }
  return {
    list(workspaceId) {
      return [...notes.values()].filter((note) => note.ref.workspaceId === workspaceId).map(cloneNote)
    },
    get(ref) {
      const found = notes.get(keyOf(ref))
      return found ? cloneNote(found) : undefined
    },
    create(note) {
      const existing = notes.get(keyOf(note.ref))
      if (existing) return cloneNote(existing)
      return put({ ...note, permissions: note.permissions.length ? note.permissions : ['read'] })
    },
    update(ref, patch, expectedRevision) {
      const current = require(ref, expectedRevision)
      return put({
        ...current,
        ...patch,
        properties: patch.properties ? { ...current.properties, ...patch.properties } : current.properties,
        ref: { ...current.ref, revisionId: bumpNoteRevision(current.ref.revisionId) },
        meetingRef: patch.meetingRef ?? current.meetingRef,
      })
    },
    rename(ref, title, expectedRevision) {
      const current = require(ref, expectedRevision)
      return put({
        ...current,
        title,
        ref: { ...current.ref, revisionId: bumpNoteRevision(current.ref.revisionId) },
      })
    },
    snapshot() {
      return { notes: [...notes.values()].map(cloneNote) }
    },
    restore(snapshot) {
      notes.clear()
      for (const note of snapshot.notes) put(note)
    },
  }
}

export function createRox2KnowledgeStore(repo: Rox2NoteRepository): KnowledgeStore {
  const permissionsOf = (note: Rox2NoteRecord): Rox2Permission[] => (
    note.syncState === 'denied' || note.audience === 'private' ? [] : ['read']
  )
  const toRecord = (note: Rox2NoteRecord): KnowledgeNoteRecord => ({
    ref: { ...note.ref },
    title: note.title,
    body: note.body,
    properties: { ...(note.properties ?? {}) },
    audience: note.audience ?? 'shared',
    permissions: permissionsOf(note),
    meetingRef: meetingRefFrom(note.properties),
  })
  return {
    list(workspaceId) {
      return repo.list().filter((note) => note.ref.workspaceId === workspaceId).map(toRecord)
    },
    get(ref) {
      const found = repo.getByEntityId(ref.workspaceId, ref.entityId)
      return found ? toRecord(found) : undefined
    },
    create(note) {
      const existing = repo.getByEntityId(note.ref.workspaceId, note.ref.entityId)
      if (existing) return toRecord(existing)
      return toRecord(repo.createLocal({
        ref: note.ref,
        title: note.title,
        body: note.body,
        properties: withMeetingRef(note.properties, note.meetingRef),
        audience: note.audience,
      }))
    },
    update(ref, patch, expectedRevision) {
      const current = repo.getByEntityId(ref.workspaceId, ref.entityId)
      if (!current) throw new Error(`Unknown knowledge note ${ref.entityId}`)
      const updated = repo.update(current.ref, {
        title: patch.title,
        body: patch.body,
        properties: withMeetingRef(
          { ...current.properties, ...(patch.properties ?? {}) },
          patch.meetingRef,
        ),
        audience: patch.audience,
      }, expectedRevision)
      return toRecord(updated)
    },
    rename(ref, title, expectedRevision) {
      const current = repo.getByEntityId(ref.workspaceId, ref.entityId)
      if (!current) throw new Error(`Unknown knowledge note ${ref.entityId}`)
      return toRecord(repo.rename(current.ref, title, expectedRevision))
    },
    snapshot() {
      return { notes: repo.list().map(toRecord) }
    },
    restore(snapshot) {
      repo.restore(snapshot.notes.map((note) => ({
        ref: note.ref,
        title: note.title,
        body: note.body,
        origin: 'local' as const,
        syncState: 'local-only' as const,
        properties: withMeetingRef(note.properties, note.meetingRef),
        audience: note.audience,
        updatedAt: Date.now(),
      })))
    },
  }
}

function meetingRefFrom(properties: Record<string, unknown> | undefined): Rox2EntityRef | undefined {
  const raw = properties?.meetingRef
  if (!raw || typeof raw !== 'object') return undefined
  const ref = raw as Record<string, unknown>
  if (typeof ref.workspaceId !== 'string' || typeof ref.entityId !== 'string' || typeof ref.revisionId !== 'string') {
    return undefined
  }
  return { workspaceId: ref.workspaceId, entityId: ref.entityId, revisionId: ref.revisionId }
}

function withMeetingRef(
  properties: Record<string, unknown>,
  meetingRef: Rox2EntityRef | undefined,
): Record<string, unknown> {
  if (!meetingRef) return { ...properties }
  return { ...properties, meetingRef: { ...meetingRef } }
}

function mergeProperties(
  base: Record<string, KnowledgePropertyValue>,
  extra?: Record<string, KnowledgePropertyValue>,
): Record<string, KnowledgePropertyValue> {
  return { ...base, ...(extra ?? {}) }
}

function validateProperties(properties: Record<string, KnowledgePropertyValue>): KnowledgeChangeDenied | undefined {
  for (const [name, field] of Object.entries(properties)) {
    const spec = KNOWLEDGE_PROPERTY_SCHEMA[name]
    if (spec && spec.type !== field.type) {
      return { ok: false, code: 'invalid-properties', message: `Property ${name} must be ${spec.type}` }
    }
    if (spec?.enumValues && field.type === 'enum' && !spec.enumValues.includes(field.value)) {
      return { ok: false, code: 'invalid-properties', message: `Property ${name} has an unknown enum value` }
    }
    if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(field.value)) {
      return { ok: false, code: 'invalid-properties', message: `Property ${name} must be a date-only value` }
    }
  }
  return undefined
}

function diffProperties(
  before: Record<string, KnowledgePropertyValue>,
  after: Record<string, KnowledgePropertyValue>,
): KnowledgeFieldDiff[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const diff: KnowledgeFieldDiff[] = []
  for (const field of [...keys].sort()) {
    const prev = before[field]
    const next = after[field]
    if (JSON.stringify(prev) === JSON.stringify(next)) continue
    diff.push({
      field,
      before: prev?.value,
      after: next?.value,
      type: next?.type ?? prev?.type ?? 'string',
    })
  }
  return diff
}

function findExisting(
  store: KnowledgeStore,
  input: ProposeKnowledgeChangeInput,
): KnowledgeNoteRecord | undefined {
  const workspaceId = input.actor.workspaceId
  if (input.targetRef) {
    const byRef = store.get(input.targetRef)
    if (byRef) return byRef
  }
  const listed = store.list(workspaceId).filter((note) => note.permissions.includes('read'))
  if (input.decisionKey) {
    const byKey = listed.find((note) => propertyText(note, 'decisionKey') === input.decisionKey)
    if (byKey) return byKey
  }
  return listed.find((note) => note.title === input.title)
}

function propertyText(note: KnowledgeNoteRecord, key: string): string | undefined {
  const decoded = decodeKnowledgeProperties(note.properties)[key]
  if (decoded) return String(decoded.value)
  const raw = note.properties[key]
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return undefined
}

function sourceDenied(input: ProposeKnowledgeChangeInput, store: KnowledgeStore): boolean {
  for (const sourceId of input.relatedSourceIds ?? []) {
    if ((input.closedSourceIds ?? []).includes(sourceId)) return true
    const entityId = sourceId.split(':')[2]?.split('@')[0]
    if (!entityId) continue
    const related = store.get({ workspaceId: input.actor.workspaceId, entityId })
    if (!related) continue
    if (related.audience === 'private' && input.audience !== 'private') return true
    if (!related.permissions.includes('read')) return true
    const viewer = input.viewerPermissions?.[sourceId] ?? input.viewerPermissions?.[related.ref.entityId]
    if (viewer && !viewer.includes('read')) return true
  }
  return false
}

function relation(
  kind: KnowledgeRelationEdge['kind'],
  fromKind: 'note' | 'meeting',
  fromId: string,
  toKind: 'note' | 'meeting',
  toId: string,
): KnowledgeRelationEdge {
  const edge: Rox2Relation = { kind, fromId, toId }
  assertRelationKinds(edge, fromKind, toKind)
  return { kind, fromId, toId }
}

export function proposeKnowledgeChange(
  input: ProposeKnowledgeChangeInput,
  store: KnowledgeStore,
  _graph?: Rox2RelationGraph,
): KnowledgeChangeResult {
  const authz = authorizeMeetingAction({
    actor: input.actor,
    capability: 'archive.durable',
    operation: 'knowledge_propose',
    source: 'archive',
    payloadHash: 'knowledge',
    now: input.now ?? Date.now(),
    permissionMode: 'ask',
    grants: input.grants,
  })
  if (!authz.ok) {
    const code = authz.code === 'unauthenticated' ? 'unauthenticated' : 'grant-missing'
    return { ok: false, code, message: authz.message }
  }
  if (sourceDenied(input, store)) {
    return { ok: false, code: 'denied-source', message: 'Related private or denied notes cannot enter shared memory' }
  }

  const kind = input.kind ?? 'decision'
  const baseProperties = mergeProperties({
    kind: { type: 'enum', value: kind },
    status: { type: 'enum', value: 'active' },
    ...(input.decisionKey ? { decisionKey: { type: 'string', value: input.decisionKey } } : {}),
  }, input.properties)
  const invalid = validateProperties(baseProperties)
  if (invalid) return invalid

  const existing = findExisting(store, input)
  const supersede = input.supersedeRef ? store.get(input.supersedeRef) : undefined
  const action: KnowledgeChangeAction = supersede ? 'supersede' : existing ? 'update' : 'create'
  const target = action === 'update' ? existing : supersede
  const currentRevision = target?.ref.revisionId
  const expected = input.baseRevision ?? currentRevision
  if (target && expected != null && target.ref.revisionId !== expected) {
    return { ok: false, code: 'conflict', message: 'Note changed since the proposal base revision' }
  }

  const previousProperties = target ? decodeKnowledgeProperties(target.properties) : {}
  const nextProperties = action === 'supersede'
    ? baseProperties
    : mergeProperties(previousProperties, baseProperties)
  const body = input.body ?? target?.body ?? ''
  const title = input.title
  const nextEntityId = action === 'supersede'
    ? `${input.decisionKey ?? titleSlug(title)}-${input.meetingRef.revisionId}`
    : target?.ref.entityId ?? `${input.decisionKey ?? titleSlug(title)}`
  const nextRevision = action === 'update' ? bumpNoteRevision(target!.ref.revisionId) : '1'
  const nextRef: Rox2EntityRef = {
    workspaceId: input.actor.workspaceId,
    entityId: nextEntityId,
    revisionId: nextRevision,
  }

  const relations: KnowledgeRelationEdge[] = [
    relation(
      'derived-from',
      'note',
      formatRox2EntityId('note', nextEntityId),
      'meeting',
      formatRox2EntityId('meeting', input.meetingRef.entityId),
    ),
  ]
  if (action === 'supersede' && supersede) {
    relations.push(relation(
      'replaces',
      'note',
      formatRox2EntityId('note', nextEntityId),
      'note',
      formatRox2EntityId('note', supersede.ref.entityId),
    ))
  }
  const proposal: KnowledgeChangeProposal = {
    id: `knowledge-${input.meetingRef.entityId}-${nextEntityId}`,
    status: 'proposed',
    action,
    applied: false,
    workspaceId: input.actor.workspaceId,
    meetingRef: { ...input.meetingRef },
    targetRef: target ? { ...target.ref } : undefined,
    nextRef,
    baseRevision: expected ?? '0',
    properties: nextProperties,
    diff: diffProperties(previousProperties, nextProperties),
    body,
    title,
    evidence: { ...input.evidence, meeting: { ...input.evidence.meeting } },
    supersededRef: supersede ? { ...supersede.ref } : undefined,
    relations,
    payloadHash: sha256Json({
      action,
      nextRef,
      title,
      body,
      properties: nextProperties,
      evidence: input.evidence,
    }),
    audience: input.audience ?? 'shared',
  }
  return { ok: true, proposal }
}

export function applyKnowledgeChange(
  proposal: KnowledgeChangeProposal,
  store: KnowledgeStore,
  options: ApplyKnowledgeChangeOptions,
): { ok: true; note: KnowledgeNoteRecord } | KnowledgeChangeDenied {
  if (!options.applyEnabled) {
    return { ok: false, code: 'apply-disabled', message: 'Knowledge apply is disabled; proposals and versions are kept' }
  }
  if (proposal.action === 'update' && proposal.targetRef) {
    const current = store.get(proposal.targetRef)
    if (!current) return { ok: false, code: 'conflict', message: 'Target note is missing' }
    if (current.ref.revisionId !== proposal.baseRevision) {
      return { ok: false, code: 'conflict', message: 'Note changed since the proposal base revision' }
    }
    const note = store.update(current.ref, {
      title: proposal.title,
      body: proposal.body,
      properties: encodeKnowledgeProperties(proposal.properties),
      meetingRef: proposal.meetingRef,
      audience: proposal.audience,
    }, proposal.baseRevision)
    addProposalRelations(options.graph, proposal)
    return { ok: true, note }
  }

  const created = store.create({
    ref: proposal.nextRef ?? {
      workspaceId: proposal.workspaceId,
      entityId: proposal.id,
      revisionId: '1',
    },
    title: proposal.title,
    body: proposal.body ?? '',
    properties: encodeKnowledgeProperties(proposal.properties),
    audience: proposal.audience,
    permissions: ['read'],
    meetingRef: proposal.meetingRef,
  })
  if (proposal.action === 'supersede' && proposal.supersededRef) {
    const previous = store.get(proposal.supersededRef)
    if (previous) {
      store.update(previous.ref, {
        properties: encodeKnowledgeProperties({
          ...decodeKnowledgeProperties(previous.properties),
          status: { type: 'enum', value: 'superseded' },
        }),
      }, previous.ref.revisionId)
    }
  }
  addProposalRelations(options.graph, proposal)
  return { ok: true, note: store.get(created.ref) ?? created }
}

function addProposalRelations(graph: Rox2RelationGraph | undefined, proposal: KnowledgeChangeProposal): void {
  if (!graph) return
  for (const edge of proposal.relations) {
    const fromKind = edge.fromId.startsWith('meeting:') ? 'meeting' : 'note'
    const toKind = edge.toId.startsWith('meeting:') ? 'meeting' : 'note'
    try {
      graph.add({ kind: edge.kind, fromId: edge.fromId, toId: edge.toId }, fromKind, toKind)
    } catch {
      /* already present */
    }
  }
}

function titleSlug(title: string): string {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '')
  return slug || 'knowledge'
}
