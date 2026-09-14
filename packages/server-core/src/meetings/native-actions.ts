/**
 * Native Notes → Tasks from an approved meeting proposal (issue #367 / I011).
 * The canonical Personal Task and Note repositories are the writers.
 * The meeting stores a link and EvidenceSpan, not a second task copy.
 */

import {
  FileTaskRepository,
  type PersonalTask,
} from '@craft-agent/core/tasks/personal'
import { isVerifiedEffect, Rox2NoteRepository, type Rox2NoteRecord } from '@craft-agent/core/rox2'
import type { MeetingGrant } from '@craft-agent/shared/meeting-agents'
import { MeetingExecutor, type EffectAdapter, type OutboxJob } from './executor.ts'
import type { InboxProposal } from './proposals.ts'

export type MeetingNativeEvidence = {
  segmentId: string
  segmentRevision: number
  quote: string
}

export type MeetingNativeBinding = {
  meetingId: string
  taskId: string
  noteId: string
  evidence: MeetingNativeEvidence
  operationId: string
  payloadHash: string
  due?: string
}

export type NativeTaskRecord = {
  id: string
  title: string
  notes: string
  dueAt?: number
  completedAt?: number
  cancelledAt?: number
  links: PersonalTask['links']
}

export type NativeTaskPort = {
  create(input: {
    title: string
    notes: string
    dueAt?: number
    links: PersonalTask['links']
    operationId: string
    expectedRevision?: number
  }): Promise<NativeTaskRecord>
  get(id: string): Promise<NativeTaskRecord | undefined>
  list(): Promise<NativeTaskRecord[]>
}

export type NativeNotePort = {
  create(input: { workspaceId: string; title: string; body: string; id: string }): Promise<{ id: string }>
  get(id: string): Promise<{ id: string; body: string } | undefined>
}

const EVIDENCE_TAG = 'rox:meeting-evidence'

export function dueDateToMillis(due: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return undefined
  const ms = Date.parse(`${due}T12:00:00.000Z`)
  return Number.isFinite(ms) ? ms : undefined
}

export function formatDueDate(dueAt?: number): string | undefined {
  if (dueAt == null) return undefined
  return new Date(dueAt).toISOString().slice(0, 10)
}

export function encodeMeetingTaskNotes(input: {
  quote: string
  due?: string
  meetingId: string
  noteId: string
  operationId: string
  payloadHash: string
  segmentId: string
  segmentRevision: number
}): string {
  const lines = [input.quote.trim()]
  if (input.due) lines.push(`Due: ${input.due}`)
  lines.push(
    `<!-- ${EVIDENCE_TAG} meetingId="${input.meetingId}" noteId="${input.noteId}" operationId="${input.operationId}" payloadHash="${input.payloadHash}" segmentId="${input.segmentId}" segmentRevision="${input.segmentRevision}" -->`,
  )
  return lines.join('\n')
}

export function parseMeetingBindingFromTask(task: NativeTaskRecord, meetingId?: string): MeetingNativeBinding | undefined {
  const match = task.notes.match(
    new RegExp(`${EVIDENCE_TAG} meetingId="([^"]+)" noteId="([^"]+)" operationId="([^"]+)" payloadHash="([^"]+)" segmentId="([^"]+)" segmentRevision="(\\d+)"`),
  )
  if (!match) return undefined
  const boundMeeting = match[1]!
  if (meetingId && boundMeeting !== meetingId) return undefined
  const quote = task.notes.split('\n')[0] ?? ''
  return {
    meetingId: boundMeeting,
    taskId: task.id,
    noteId: match[2]!,
    evidence: {
      segmentId: match[5]!,
      segmentRevision: Number(match[6]),
      quote,
    },
    operationId: match[3]!,
    payloadHash: match[4]!,
    due: formatDueDate(task.dueAt),
  }
}

export function createFileTaskPort(repo: FileTaskRepository): NativeTaskPort {
  const toRecord = (task: PersonalTask): NativeTaskRecord => ({
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    cancelledAt: task.cancelledAt,
    links: [...task.links],
  })
  return {
    async list() {
      return (await repo.load()).store.list().map(toRecord)
    },
    async get(id) {
      const found = (await repo.load()).store.get(id)
      return found ? toRecord(found) : undefined
    },
    async create(input) {
      const loaded = await repo.load()
      const existing = loaded.store.list().find((task) => task.notes.includes(`operationId="${input.operationId}"`))
      if (existing) return toRecord(existing)
      const created = loaded.store.create({
        title: input.title,
        notes: input.notes,
        dueAt: input.dueAt,
        links: input.links,
      })
      await repo.save(loaded.store, input.expectedRevision ?? loaded.revision)
      return toRecord(created)
    },
  }
}

export function createRox2NotePort(repo: Rox2NoteRepository): NativeNotePort {
  return {
    async create(input) {
      const existing = repo.get({
        workspaceId: input.workspaceId,
        entityId: input.id,
        revisionId: '1',
      })
      if (existing) return { id: existing.ref.entityId }
      const record = repo.createLocal({
        ref: { workspaceId: input.workspaceId, entityId: input.id, revisionId: '1' },
        title: input.title,
        body: input.body,
      })
      return { id: record.ref.entityId }
    },
    async get(id) {
      const notes = repo.list()
      const found = notes.find((note) => note.ref.entityId === id)
      return found ? { id: found.ref.entityId, body: found.body } : undefined
    },
  }
}

export type NativeMeetingActionsOptions = {
  tasks: NativeTaskPort
  notes: NativeNotePort
  workspaceId: string
  actorId: string
  deviceId: string
  grants: readonly MeetingGrant[]
  now?: () => number
}

export class NativeMeetingActions {
  private readonly executor: MeetingExecutor
  private lastBinding: MeetingNativeBinding | undefined
  private pending: InboxProposal | undefined
  private pendingExpectedRevision: number | undefined

  constructor(private readonly options: NativeMeetingActionsOptions) {
    this.executor = new MeetingExecutor(this.adapter())
  }

  restoreJobs(jobs: readonly OutboxJob[]): void {
    this.executor.restore(jobs)
  }

  jobs(): OutboxJob[] {
    return this.executor.list()
  }

  async applyApprovedTaskProposal(proposal: InboxProposal, extra?: { expectedTaskRevision?: number }): Promise<{
    job: OutboxJob
    binding?: MeetingNativeBinding
    task?: NativeTaskRecord
  }> {
    this.pending = proposal
    this.pendingExpectedRevision = extra?.expectedTaskRevision
    const job = await this.executor.executeApprovedProposal({
      proposal,
      actorId: this.options.actorId,
      workspaceId: this.options.workspaceId,
      deviceId: this.options.deviceId,
      now: this.options.now?.() ?? Date.now(),
      grants: this.options.grants,
      expectedFields: {
        title: String(proposal.payload.title ?? ''),
        ...(typeof proposal.payload.due === 'string' ? { due: proposal.payload.due } : {}),
      },
    })
    if (job.status !== 'acked' || !job.result || !isVerifiedEffect(job.result)) {
      return { job }
    }
    const task = job.result.entityId ? await this.options.tasks.get(job.result.entityId) : undefined
    const binding = task ? parseMeetingBindingFromTask(task, proposal.meetingId) : this.lastBinding
    return { job, binding, task }
  }

  async bindings(meetingId?: string): Promise<MeetingNativeBinding[]> {
    const tasks = await this.options.tasks.list()
    return tasks.flatMap((task) => {
      const binding = parseMeetingBindingFromTask(task, meetingId)
      return binding ? [binding] : []
    })
  }

  private adapter(): EffectAdapter {
    return {
      idempotent: true,
      execute: async ({ operationId, payload }) => {
        const proposal = this.pending
        if (!proposal) throw new Error('No approved proposal in flight')
        const parsed = parseTaskPayload(payload, proposal)
        const noteId = `note-${operationId}`
        await this.options.notes.create({
          workspaceId: this.options.workspaceId,
          id: noteId,
          title: parsed.title,
          body: parsed.evidence.quote,
        })
        const notes = encodeMeetingTaskNotes({
          quote: parsed.evidence.quote,
          due: parsed.due,
          meetingId: parsed.meetingId,
          noteId,
          operationId,
          payloadHash: parsed.payloadHash,
          segmentId: parsed.evidence.segmentId,
          segmentRevision: parsed.evidence.segmentRevision,
        })
        const task = await this.options.tasks.create({
          title: parsed.title,
          notes,
          dueAt: parsed.due ? dueDateToMillis(parsed.due) : undefined,
          links: [{ kind: 'note', id: noteId }],
          operationId,
          expectedRevision: this.pendingExpectedRevision,
        })
        this.lastBinding = parseMeetingBindingFromTask(task, parsed.meetingId)
        return {
          remoteId: task.id,
          requestId: operationId,
          fields: { title: task.title, due: formatDueDate(task.dueAt) ?? parsed.due, id: task.id },
        }
      },
      readback: async (remoteId) => {
        const task = await this.options.tasks.get(remoteId)
        if (!task) return {}
        return { title: task.title, due: formatDueDate(task.dueAt), id: task.id }
      },
    }
  }
}

function parseTaskPayload(payload: Record<string, unknown>, proposal: InboxProposal): {
  title: string
  due?: string
  meetingId: string
  payloadHash: string
  evidence: MeetingNativeEvidence
} {
  const title = String(payload.title ?? '').trim()
  if (!title) throw new Error('Task title is required')
  const evidenceRaw = payload.evidence
  if (!evidenceRaw || typeof evidenceRaw !== 'object') {
    throw new Error('Evidence span is required')
  }
  const evidence = evidenceRaw as Record<string, unknown>
  const quote = String(evidence.quote ?? '').trim()
  const segmentId = String(evidence.segmentId ?? '')
  const segmentRevision = Number(evidence.segmentRevision ?? 0)
  if (!quote || !segmentId || !Number.isFinite(segmentRevision)) {
    throw new Error('Evidence span is incomplete')
  }
  return {
    title,
    due: typeof payload.due === 'string' ? payload.due : undefined,
    meetingId: proposal.meetingId,
    payloadHash: proposal.payloadHash,
    evidence: { segmentId, segmentRevision, quote },
  }
}

export function memoryTaskFs(initial?: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    files,
    quota: false,
    async readFile(path: string) {
      const value = files.get(path)
      if (value == null) {
        const error = new Error('ENOENT') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      return value
    },
    async writeFile(path: string, data: string) {
      if (this.quota) {
        const error = new Error('ENOSPC') as Error & { code: string }
        error.code = 'ENOSPC'
        throw error
      }
      files.set(path, data)
    },
    async mkdir() {},
    async rename(from: string, to: string) {
      const value = files.get(from)
      if (value == null) throw new Error('ENOENT')
      files.set(to, value)
      files.delete(from)
    },
  }
}

export type { Rox2NoteRecord }
