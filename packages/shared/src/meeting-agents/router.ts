import { BUILTIN_MEETING_AGENT_IDS, type BuiltinMeetingAgentId } from './catalog.ts'
import { authorizeMeetingAction, type MeetingGrant } from './policies.ts'

export type RoleJob = {
  id: string
  meetingId: string
  roleId: BuiltinMeetingAgentId
  sourceRevision: string
  definitionVersion: number
  promptVersion: number
  capabilityScope: readonly string[]
  budget: number
  priority: 'interactive' | 'digest'
  status: 'queued' | 'running' | 'cancelled' | 'waiting_device' | 'done'
  triggerWatermark: string
}

export type MeetingRouterState = {
  jobs: RoleJob[]
  cancelled: boolean
}

export const MEETING_CONCURRENT_JOBS = 2
export const WORKSPACE_CONCURRENT_JOBS = 4
export const EXTRACTION_DEBOUNCE_MS = 1000

export const MEETING_DISPATCH_LIMITS = {
  maxConcurrentPerMeeting: MEETING_CONCURRENT_JOBS,
  maxConcurrentPerWorkspace: WORKSPACE_CONCURRENT_JOBS,
  debounceMs: EXTRACTION_DEBOUNCE_MS,
} as const

const PARTIAL_SPEECH_KINDS: Record<string, true> = {
  speech: true,
  audio: true,
  'audio-chunk': true,
}

export type RouteMeetingEventInput = {
  state: MeetingRouterState
  meetingId: string
  roleId: string
  triggerWatermark: string
  sourceRevision: string
  grant: MeetingGrant | null
  capability: 'mic' | 'system' | 'screen' | 'cloud-processing' | 'archive' | 'send'
  actorId: string
  workspaceId: string
  deviceId: string
  interactive?: boolean
  workspaceRunning?: number
  knownTools?: readonly string[]
  tool?: string
  /** Speech/audio chunks with final!==true must not start a model. */
  kind?: string
  final?: boolean
  deviceScoped?: boolean
  deviceOnline?: boolean
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
  debounceMs?: number
  maxConcurrentPerMeeting?: number
  maxConcurrentPerWorkspace?: number
  clock?: MeetingRouterClock
}

export type MeetingDispatchInput = Omit<RouteMeetingEventInput, 'state' | 'workspaceRunning'>

type JobRecord = {
  job: RoleJob
  workspaceId: string
  seq: number
}

function systemClock(): MeetingRouterClock {
  return {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const handle = setTimeout(fn, ms)
      return { clear: () => clearTimeout(handle) }
    },
  }
}

function isPartialSpeech(kind: string | undefined, final: boolean | undefined): boolean {
  return kind != null && PARTIAL_SPEECH_KINDS[kind] === true && final !== true
}

function comparePriority(a: RoleJob, b: RoleJob): number {
  if (a.priority === b.priority) return 0
  return a.priority === 'interactive' ? -1 : 1
}

function snapshotJob(job: RoleJob): RoleJob {
  return { ...job, capabilityScope: [...job.capabilityScope] }
}

function watermarkOrder(value: string): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function buildQueuedJob(input: MeetingDispatchInput, id: string): RoleJob {
  return {
    id,
    meetingId: input.meetingId,
    roleId: input.roleId as BuiltinMeetingAgentId,
    sourceRevision: input.sourceRevision,
    definitionVersion: 1,
    promptVersion: 1,
    capabilityScope: input.grant?.capabilities ?? [],
    budget: input.grant?.budgetRemaining ?? 0,
    priority: input.interactive ? 'interactive' : 'digest',
    status: input.deviceScoped && input.deviceOnline === false ? 'waiting_device' : 'queued',
    triggerWatermark: input.triggerWatermark,
  }
}

function authorizeRoute(input: MeetingDispatchInput): 'skip' | 'ok' {
  if (!(BUILTIN_MEETING_AGENT_IDS as readonly string[]).includes(input.roleId)) return 'skip'
  if (input.tool && input.knownTools && !input.knownTools.includes(input.tool)) {
    throw new Error(`unknown meeting tool ${input.tool}`)
  }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    capability: input.capability,
    operation: 'route',
  })
  return auth.ok ? 'ok' : 'skip'
}

export function routeMeetingEvent(input: RouteMeetingEventInput): MeetingRouterState {
  if (input.state.cancelled) return input.state
  if (isPartialSpeech(input.kind, input.final)) return input.state
  if (authorizeRoute(input) !== 'ok') return input.state
  if (input.state.jobs.some((job) => job.triggerWatermark === input.triggerWatermark && job.roleId === input.roleId)) {
    return input.state
  }
  const meetingRunning = input.state.jobs.filter((job) =>
    job.meetingId === input.meetingId && (job.status === 'running' || job.status === 'queued'),
  ).length
  if (meetingRunning >= MEETING_CONCURRENT_JOBS) return input.state
  if ((input.workspaceRunning ?? 0) >= WORKSPACE_CONCURRENT_JOBS) return input.state
  const job = buildQueuedJob(input, `job-${input.state.jobs.length + 1}`)
  return { ...input.state, jobs: [...input.state.jobs, job].sort(comparePriority) }
}

export function cancelMeetingJobs(state: MeetingRouterState): MeetingRouterState {
  return {
    cancelled: true,
    jobs: state.jobs.map((job) => (job.status === 'queued' ? { ...job, status: 'cancelled' as const } : job)),
  }
}

/**
 * Abortable leftover job pump from closed PR #551.
 * Grant-based `routeMeetingEvent` / `cancelMeetingJobs` stay the public enqueue API.
 * The pump starts at most 2 jobs per meeting and 4 per workspace, debounces
 * scribe extraction 1000ms, and never starts a model on partial speech.
 */
export class MeetingJobDispatcher {
  private readonly jobs = new Map<string, JobRecord>()
  private readonly watermarks = new Set<string>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly debounce = new Map<string, { clear(): void }>()
  private readonly cancelledMeetings = new Set<string>()
  private seq = 0
  private readonly backend: MeetingBackendFactory
  private readonly debounceMs: number
  private readonly maxPerMeeting: number
  private readonly maxPerWorkspace: number
  private readonly clock: MeetingRouterClock

  constructor(options: MeetingDispatcherOptions) {
    this.backend = options.backend
    this.debounceMs = options.debounceMs ?? MEETING_DISPATCH_LIMITS.debounceMs
    this.maxPerMeeting = options.maxConcurrentPerMeeting ?? MEETING_DISPATCH_LIMITS.maxConcurrentPerMeeting
    this.maxPerWorkspace = options.maxConcurrentPerWorkspace ?? MEETING_DISPATCH_LIMITS.maxConcurrentPerWorkspace
    this.clock = options.clock ?? systemClock()
  }

  submit(input: MeetingDispatchInput): RoleJob[] {
    if (this.cancelledMeetings.has(input.meetingId)) return []
    if (isPartialSpeech(input.kind, input.final)) return []
    if (authorizeRoute(input) !== 'ok') return []
    const key = `${input.meetingId}:${input.roleId}:${input.triggerWatermark}`
    if (this.watermarks.has(key)) return []
    this.seq += 1
    const job = buildQueuedJob(input, `job-${this.seq}`)
    this.watermarks.add(key)
    const record: JobRecord = { job, workspaceId: input.workspaceId, seq: this.seq }
    this.jobs.set(job.id, record)
    this.coalesceScribe(record)
    const accepted = snapshotJob(record.job)
    if (record.job.status === 'waiting_device' || record.job.status === 'cancelled') {
      return [accepted]
    }
    if (this.shouldDebounce(record.job)) this.scheduleDebounced(record.job)
    else this.pump()
    return [snapshotJob(record.job)]
  }

  cancel(meetingId: string): RoleJob[] {
    this.cancelledMeetings.add(meetingId)
    for (const [key, handle] of this.debounce) {
      if (key.startsWith(`${meetingId}:`)) {
        handle.clear()
        this.debounce.delete(key)
      }
    }
    for (const record of this.jobs.values()) {
      if (record.job.meetingId !== meetingId) continue
      if (record.job.status === 'queued' || record.job.status === 'waiting_device' || record.job.status === 'running') {
        record.job = { ...record.job, status: 'cancelled' }
        this.controllers.get(record.job.id)?.abort()
      }
    }
    return this.list().filter((job) => job.meetingId === meetingId)
  }

  list(): RoleJob[] {
    return [...this.jobs.values()].map((record) => snapshotJob(record.job))
  }

  runningCount(scope?: { meetingId?: string; workspaceId?: string }): number {
    return this.active('running', scope)
  }

  modelStarts(): number {
    return [...this.jobs.values()].filter((record) =>
      record.job.status === 'running' || record.job.status === 'done',
    ).length
  }

  snapshot(): RoleJob[] {
    return this.list()
  }

  reload(jobs: readonly RoleJob[], workspaceId = ''): void {
    this.jobs.clear()
    this.watermarks.clear()
    this.controllers.clear()
    this.cancelledMeetings.clear()
    for (const handle of this.debounce.values()) handle.clear()
    this.debounce.clear()
    for (const job of jobs) {
      this.seq += 1
      const copy = snapshotJob({
        ...job,
        status: job.status === 'running' ? 'queued' : job.status,
      })
      this.jobs.set(copy.id, { job: copy, workspaceId, seq: this.seq })
      this.watermarks.add(`${copy.meetingId}:${copy.roleId}:${copy.triggerWatermark}`)
    }
    this.pump()
  }

  complete(jobId: string): void {
    const record = this.jobs.get(jobId)
    if (!record || record.job.status !== 'running') return
    record.job = { ...record.job, status: 'done' }
    this.controllers.get(jobId)?.abort()
    this.controllers.delete(jobId)
    this.pump()
  }

  private coalesceScribe(incoming: JobRecord): void {
    if (incoming.job.roleId !== 'rox.meeting.scribe' || incoming.job.priority === 'interactive') return
    const incomingOrder = watermarkOrder(incoming.job.triggerWatermark)
    for (const other of this.jobs.values()) {
      if (other.job.id === incoming.job.id) continue
      if (other.job.meetingId !== incoming.job.meetingId || other.job.roleId !== incoming.job.roleId) continue
      if (other.job.status !== 'queued') continue
      const otherOrder = watermarkOrder(other.job.triggerWatermark)
      if (otherOrder < incomingOrder) {
        other.job = { ...other.job, status: 'cancelled' }
      } else if (otherOrder > incomingOrder) {
        incoming.job = { ...incoming.job, status: 'cancelled' }
      }
    }
  }

  private shouldDebounce(job: RoleJob): boolean {
    return job.priority !== 'interactive' && job.roleId === 'rox.meeting.scribe' && this.debounceMs > 0
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
      .filter((record) => record.job.status === 'queued' && !this.debouncedBlocked(record.job))
    const ranked = queued.slice().sort((a, b) => {
      const priority = comparePriority(a.job, b.job)
      if (priority !== 0) return priority
      return a.seq - b.seq
    })
    for (const record of ranked) {
      if (this.runningCount({ meetingId: record.job.meetingId }) >= this.maxPerMeeting) continue
      if (this.runningCount({ workspaceId: record.workspaceId }) >= this.maxPerWorkspace) continue
      this.start(record)
    }
  }

  private start(record: JobRecord): void {
    record.job = { ...record.job, status: 'running' }
    const controller = new AbortController()
    this.controllers.set(record.job.id, controller)
    const run = this.backend.create(record.job)
    void run.run(snapshotJob(record.job), controller.signal).then(
      () => {
        if (record.job.status === 'running') record.job = { ...record.job, status: 'done' }
        this.controllers.delete(record.job.id)
        this.pump()
      },
      () => {
        if (record.job.status === 'running') record.job = { ...record.job, status: 'cancelled' }
        this.controllers.delete(record.job.id)
        this.pump()
      },
    )
  }

  private active(status: RoleJob['status'], scope?: { meetingId?: string; workspaceId?: string }): number {
    let count = 0
    for (const record of this.jobs.values()) {
      if (record.job.status !== status) continue
      if (scope?.meetingId && record.job.meetingId !== scope.meetingId) continue
      if (scope?.workspaceId && record.workspaceId !== scope.workspaceId) continue
      count += 1
    }
    return count
  }
}
