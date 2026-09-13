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

export function routeMeetingEvent(input: {
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
}): MeetingRouterState {
  if (input.state.cancelled) return input.state
  if (!(BUILTIN_MEETING_AGENT_IDS as readonly string[]).includes(input.roleId)) return input.state
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
  if (!auth.ok) return input.state
  if (input.state.jobs.some((job) => job.triggerWatermark === input.triggerWatermark && job.roleId === input.roleId)) {
    return input.state
  }
  const meetingRunning = input.state.jobs.filter((job) =>
    job.meetingId === input.meetingId && (job.status === 'running' || job.status === 'queued'),
  ).length
  if (meetingRunning >= MEETING_CONCURRENT_JOBS) return input.state
  if ((input.workspaceRunning ?? 0) >= WORKSPACE_CONCURRENT_JOBS) return input.state
  const job: RoleJob = {
    id: `job-${input.state.jobs.length + 1}`,
    meetingId: input.meetingId,
    roleId: input.roleId as BuiltinMeetingAgentId,
    sourceRevision: input.sourceRevision,
    definitionVersion: 1,
    promptVersion: 1,
    capabilityScope: input.grant?.capabilities ?? [],
    budget: input.grant?.budgetRemaining ?? 0,
    priority: input.interactive ? 'interactive' : 'digest',
    status: 'queued',
    triggerWatermark: input.triggerWatermark,
  }
  const jobs = [...input.state.jobs, job].sort((a, b) => {
    if (a.priority === b.priority) return 0
    return a.priority === 'interactive' ? -1 : 1
  })
  return { ...input.state, jobs }
}

export function cancelMeetingJobs(state: MeetingRouterState): MeetingRouterState {
  return {
    cancelled: true,
    jobs: state.jobs.map((job) => (job.status === 'queued' ? { ...job, status: 'cancelled' as const } : job)),
  }
}
