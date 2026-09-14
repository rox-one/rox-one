/**
 * Meeting role coordinator on the existing session runtime (issue #363).
 * One entry routes builtin roles; it does not spawn eight idle processes
 * and does not start a model on every audio chunk.
 */

import {
  buildSessionToolDefs,
  hostToolsForMeetingSkills,
  isKnownSessionToolName,
  type SessionToolDef,
} from '../agent/session-tool-defs.ts'
import {
  BUILTIN_MEETING_AGENTS,
  type BuiltinMeetingAgentId,
  type BuiltinRoleDefinition,
  type MeetingCapabilityId,
} from './catalog.ts'
import {
  emptyMeetingAgentStore,
  type MeetingAgentStore,
} from './bootstrap.ts'

export const MEETING_DISPATCH_LIMITS = {
  maxConcurrentPerMeeting: 2,
  maxConcurrentPerWorkspace: 4,
  debounceMs: 1000,
} as const

export type MeetingSourceSnapshot = {
  revision: number
  finalizedWatermark: number
  text?: string
}

export type MeetingEvent = {
  id: string
  kind: string
  meetingId: string
  workspaceId: string
  sourceSnapshot: MeetingSourceSnapshot
  interactive?: boolean
  /** When false, speech/audio is a chunk and must not start a model. */
  final?: boolean
  toolName?: string
  deviceScoped?: boolean
  deviceOnline?: boolean
  budgetRemainingMs?: number
}

export type RoleJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_device'
  | 'done'
  | 'cancelled'
  | 'rejected'

export type RoleJob = {
  id: string
  eventId: string
  roleId: BuiltinMeetingAgentId
  roleVersion: number
  promptVersion: number
  meetingId: string
  workspaceId: string
  sourceSnapshot: MeetingSourceSnapshot
  capabilityIds: readonly MeetingCapabilityId[]
  allowedToolNames: readonly string[]
  hostTools: readonly SessionToolDef[]
  budget: { timeoutMs: number }
  toolName?: string
  interactive: boolean
  status: RoleJobStatus
  rejectCode?: string
}

export type RouteMeetingEventResult = {
  jobs: RoleJob[]
}

export type MeetingBackendRun = {
  run(job: RoleJob, signal: AbortSignal): Promise<void>
}

export type MeetingBackendFactory = {
  create(job: RoleJob): MeetingBackendRun
}

export type MeetingRouterClock = {
  now(): number
  setTimeout(fn: () => void, ms: number): { clear(): void }
}

export type MeetingDispatcherOptions = {
  backend: MeetingBackendFactory
  store?: MeetingAgentStore
  roles?: readonly BuiltinRoleDefinition[]
  debounceMs?: number
  maxConcurrentPerMeeting?: number
  maxConcurrentPerWorkspace?: number
  clock?: MeetingRouterClock
}

const PARTIAL_KINDS = new Set(['speech', 'audio', 'audio-chunk'])

function systemClock(): MeetingRouterClock {
  return {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const handle = setTimeout(fn, ms)
      return { clear: () => clearTimeout(handle) }
    },
  }
}

function watermarkKey(meetingId: string, roleId: string, watermark: number): string {
  return `${meetingId}:${roleId}:${watermark}`
}

export function routeMeetingEvent(
  event: MeetingEvent,
  options: {
    roles?: readonly BuiltinRoleDefinition[]
    store?: MeetingAgentStore
  } = {},
): RouteMeetingEventResult {
  if (PARTIAL_KINDS.has(event.kind) && event.final !== true) {
    return { jobs: [] }
  }
  const roles = options.roles ?? BUILTIN_MEETING_AGENTS
  const store = options.store ?? emptyMeetingAgentStore()
  const jobs: RoleJob[] = []
  for (const role of roles) {
    if (!role.triggerKinds.includes(event.kind)) continue
    if (store.overrides[role.id]?.enabled === false) continue
    const hostTools = hostToolsForMeetingSkills(role.skillIds)
    const allowedToolNames = hostTools.map((tool) => tool.name)
    const timeoutMs = Math.min(role.timeoutMs, event.budgetRemainingMs ?? role.timeoutMs)
    const job: RoleJob = {
      id: `${event.id}:${role.id}`,
      eventId: event.id,
      roleId: role.id,
      roleVersion: role.version,
      promptVersion: role.promptVersion,
      meetingId: event.meetingId,
      workspaceId: event.workspaceId,
      sourceSnapshot: { ...event.sourceSnapshot },
      capabilityIds: role.allowedCapabilityIds,
      allowedToolNames,
      hostTools,
      budget: { timeoutMs },
      toolName: event.toolName,
      interactive: event.interactive === true,
      status: 'queued',
    }
    const rejected = rejectJob(job, event)
    if (rejected) {
      jobs.push(rejected)
      continue
    }
    if (event.deviceScoped && event.deviceOnline === false) {
      job.status = 'waiting_device'
    }
    jobs.push(job)
  }
  return { jobs }
}

function rejectJob(job: RoleJob, event: MeetingEvent): RoleJob | undefined {
  if (event.budgetRemainingMs === 0) {
    return { ...job, status: 'rejected', rejectCode: 'budget-exhausted' }
  }
  if (event.toolName) {
    if (!isKnownSessionToolName(event.toolName)) {
      return { ...job, status: 'rejected', rejectCode: 'unknown-tool' }
    }
    if (!job.allowedToolNames.includes(event.toolName)) {
      return { ...job, status: 'rejected', rejectCode: 'tool-not-allowed' }
    }
  }
  return undefined
}

export function hostToolsForRoutedJob(job: RoleJob): SessionToolDef[] {
  const catalog = buildSessionToolDefs({ includeMeetingAgentTools: true })
  const allow = new Set(job.allowedToolNames)
  return catalog.filter((def) => allow.has(def.name))
}

export class MeetingJobDispatcher {
  private jobs = new Map<string, RoleJob>()
  private watermarks = new Set<string>()
  private controllers = new Map<string, AbortController>()
  private debounce = new Map<string, { clear(): void }>()
  private seq = 0
  private readonly backend: MeetingBackendFactory
  private readonly store: MeetingAgentStore
  private readonly roles: readonly BuiltinRoleDefinition[]
  private readonly debounceMs: number
  private readonly maxPerMeeting: number
  private readonly maxPerWorkspace: number
  private readonly clock: MeetingRouterClock

  constructor(options: MeetingDispatcherOptions) {
    this.backend = options.backend
    this.store = options.store ?? emptyMeetingAgentStore()
    this.roles = options.roles ?? BUILTIN_MEETING_AGENTS
    this.debounceMs = options.debounceMs ?? MEETING_DISPATCH_LIMITS.debounceMs
    this.maxPerMeeting = options.maxConcurrentPerMeeting ?? MEETING_DISPATCH_LIMITS.maxConcurrentPerMeeting
    this.maxPerWorkspace = options.maxConcurrentPerWorkspace ?? MEETING_DISPATCH_LIMITS.maxConcurrentPerWorkspace
    this.clock = options.clock ?? systemClock()
  }

  submit(event: MeetingEvent): RoleJob[] {
    const routed = routeMeetingEvent(event, { roles: this.roles, store: this.store }).jobs
    const accepted: RoleJob[] = []
    for (const job of routed) {
      if (job.status === 'rejected') {
        this.jobs.set(job.id, job)
        accepted.push(this.snapshotJob(job))
        continue
      }
      const key = watermarkKey(job.meetingId, job.roleId, job.sourceSnapshot.finalizedWatermark)
      if (this.watermarks.has(key)) continue
      this.watermarks.add(key)
      this.jobs.set(job.id, job)
      this.coalesceScribe(job)
      accepted.push(this.snapshotJob(this.jobs.get(job.id)!))
      if (job.status === 'waiting_device' || job.status === 'cancelled') continue
      if (this.shouldDebounce(job)) this.scheduleDebounced(job)
      else this.pump()
    }
    return accepted
  }

  cancel(meetingId: string): RoleJob[] {
    for (const [key, handle] of this.debounce) {
      if (key.startsWith(`${meetingId}:`)) {
        handle.clear()
        this.debounce.delete(key)
      }
    }
    for (const job of this.jobs.values()) {
      if (job.meetingId !== meetingId) continue
      if (job.status === 'queued' || job.status === 'waiting_device' || job.status === 'running') {
        job.status = 'cancelled'
        this.controllers.get(job.id)?.abort()
      }
    }
    return this.list().filter((job) => job.meetingId === meetingId)
  }

  list(): RoleJob[] {
    return [...this.jobs.values()].map((job) => this.snapshotJob(job))
  }

  runningCount(scope?: { meetingId?: string; workspaceId?: string }): number {
    return this.active('running', scope)
  }

  modelStarts(): number {
    return [...this.jobs.values()].filter((job) => job.status === 'running' || job.status === 'done').length
  }

  snapshot(): RoleJob[] {
    return this.list()
  }

  reload(jobs: readonly RoleJob[]): void {
    this.jobs.clear()
    this.watermarks.clear()
    this.controllers.clear()
    for (const handle of this.debounce.values()) handle.clear()
    this.debounce.clear()
    for (const job of jobs) {
      const copy: RoleJob = {
        ...job,
        sourceSnapshot: { ...job.sourceSnapshot },
        capabilityIds: [...job.capabilityIds],
        allowedToolNames: [...job.allowedToolNames],
        hostTools: job.hostTools.map((tool) => ({ ...tool })),
        budget: { ...job.budget },
        status: job.status === 'running' ? 'queued' : job.status,
      }
      this.jobs.set(copy.id, copy)
      this.watermarks.add(watermarkKey(copy.meetingId, copy.roleId, copy.sourceSnapshot.finalizedWatermark))
    }
    this.pump()
  }

  complete(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== 'running') return
    job.status = 'done'
    this.controllers.get(jobId)?.abort()
    this.controllers.delete(jobId)
    this.pump()
  }

  private coalesceScribe(job: RoleJob): void {
    if (job.roleId !== 'rox.meeting.scribe' || job.interactive) return
    for (const other of this.jobs.values()) {
      if (other.id === job.id) continue
      if (other.meetingId !== job.meetingId || other.roleId !== job.roleId) continue
      if (other.status !== 'queued') continue
      if (other.sourceSnapshot.finalizedWatermark < job.sourceSnapshot.finalizedWatermark) {
        other.status = 'cancelled'
        other.rejectCode = 'coalesced'
      } else if (other.sourceSnapshot.finalizedWatermark > job.sourceSnapshot.finalizedWatermark) {
        job.status = 'cancelled'
        job.rejectCode = 'coalesced'
      }
    }
  }

  private shouldDebounce(job: RoleJob): boolean {
    return !job.interactive && job.roleId === 'rox.meeting.scribe' && this.debounceMs > 0
  }

  private scheduleDebounced(job: RoleJob): void {
    const key = `${job.meetingId}:${job.roleId}`
    this.debounce.get(key)?.clear()
    const handle = this.clock.setTimeout(() => {
      this.debounce.delete(key)
      this.pump()
    }, this.debounceMs)
    this.debounce.set(key, handle)
  }

  private debouncedBlocked(job: RoleJob): boolean {
    return this.debounce.has(`${job.meetingId}:${job.roleId}`)
  }

  private pump(): void {
    const queued = [...this.jobs.values()]
      .filter((job) => job.status === 'queued' && !this.debouncedBlocked(job))
      .sort((a, b) => {
        if (a.interactive !== b.interactive) return a.interactive ? -1 : 1
        return this.seqOf(a) - this.seqOf(b)
      })
    for (const job of queued) {
      if (this.runningCount({ meetingId: job.meetingId }) >= this.maxPerMeeting) continue
      if (this.runningCount({ workspaceId: job.workspaceId }) >= this.maxPerWorkspace) continue
      this.start(job)
    }
  }

  private start(job: RoleJob): void {
    job.status = 'running'
    const controller = new AbortController()
    this.controllers.set(job.id, controller)
    const run = this.backend.create(job)
    void run.run(job, controller.signal).then(
      () => {
        if (job.status === 'running') job.status = 'done'
        this.controllers.delete(job.id)
        this.pump()
      },
      () => {
        if (job.status === 'running') job.status = 'cancelled'
        this.controllers.delete(job.id)
        this.pump()
      },
    )
  }

  private active(status: RoleJobStatus, scope?: { meetingId?: string; workspaceId?: string }): number {
    let count = 0
    for (const job of this.jobs.values()) {
      if (job.status !== status) continue
      if (scope?.meetingId && job.meetingId !== scope.meetingId) continue
      if (scope?.workspaceId && job.workspaceId !== scope.workspaceId) continue
      count += 1
    }
    return count
  }

  private seqOf(job: RoleJob): number {
    const match = job.eventId.match(/(\d+)$/)
    return match ? Number(match[1]) : this.seq++
  }

  private snapshotJob(job: RoleJob): RoleJob {
    return {
      ...job,
      sourceSnapshot: { ...job.sourceSnapshot },
      capabilityIds: [...job.capabilityIds],
      allowedToolNames: [...job.allowedToolNames],
      hostTools: job.hostTools.map((tool) => ({ ...tool })),
      budget: { ...job.budget },
    }
  }
}
