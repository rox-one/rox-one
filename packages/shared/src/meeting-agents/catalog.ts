/**
 * Eight packaged meeting-agent roles (RMA-I002 / #358).
 * IDs are stable. This is not eight always-running sessions.
 */

export const MEETING_AGENT_PACKAGE_VERSION = '1.0.0'

export const BUILTIN_MEETING_AGENT_IDS = [
  'rox.meeting.coordinator',
  'rox.meeting.assist',
  'rox.meeting.scribe',
  'rox.meeting.knowledge',
  'rox.meeting.executor',
  'rox.meeting.author',
  'rox.meeting.followup',
  'rox.meeting.analyst',
] as const

export type BuiltinMeetingAgentId = (typeof BUILTIN_MEETING_AGENT_IDS)[number]
export type MeetingModelRole = 'transcribe' | 'fast' | 'reason' | 'vision' | 'artifact'

export type BuiltinRoleDefinition = {
  id: BuiltinMeetingAgentId
  version: number
  promptVersion: number
  modelRole: MeetingModelRole
  triggerKinds: readonly string[]
  skillIds: readonly string[]
  allowedCapabilityIds: readonly string[]
  outputSchemaId: string
  concurrency: number
  timeoutMs: number
  enabledByDefault: true
}

export const BUILTIN_MEETING_AGENTS: readonly BuiltinRoleDefinition[] = [
  {
    id: 'rox.meeting.coordinator',
    version: 1,
    promptVersion: 1,
    modelRole: 'reason',
    triggerKinds: ['prepare', 'start', 'stop'],
    skillIds: ['meeting-coordinator'],
    allowedCapabilityIds: ['meeting.route', 'meeting.budget'],
    outputSchemaId: 'meeting.coordinator.v1',
    concurrency: 1,
    timeoutMs: 30_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.assist',
    version: 1,
    promptVersion: 1,
    modelRole: 'fast',
    triggerKinds: ['question', 'hotkey'],
    skillIds: ['meeting-assist'],
    allowedCapabilityIds: ['meeting.assist', 'meeting.screen'],
    outputSchemaId: 'meeting.assist.v1',
    concurrency: 1,
    timeoutMs: 20_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.scribe',
    version: 1,
    promptVersion: 1,
    modelRole: 'transcribe',
    triggerKinds: ['speech'],
    skillIds: ['meeting-scribe'],
    allowedCapabilityIds: ['meeting.transcript'],
    outputSchemaId: 'meeting.scribe.v1',
    concurrency: 1,
    timeoutMs: 60_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.knowledge',
    version: 1,
    promptVersion: 1,
    modelRole: 'reason',
    triggerKinds: ['fact', 'decision'],
    skillIds: ['meeting-knowledge'],
    allowedCapabilityIds: ['meeting.knowledge'],
    outputSchemaId: 'meeting.knowledge.v1',
    concurrency: 1,
    timeoutMs: 30_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.executor',
    version: 1,
    promptVersion: 1,
    modelRole: 'fast',
    triggerKinds: ['approved'],
    skillIds: ['meeting-executor'],
    allowedCapabilityIds: ['meeting.execute'],
    outputSchemaId: 'meeting.executor.v1',
    concurrency: 1,
    timeoutMs: 30_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.author',
    version: 1,
    promptVersion: 1,
    modelRole: 'artifact',
    triggerKinds: ['document', 'research'],
    skillIds: ['meeting-author'],
    allowedCapabilityIds: ['meeting.artifact'],
    outputSchemaId: 'meeting.author.v1',
    concurrency: 1,
    timeoutMs: 60_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.followup',
    version: 1,
    promptVersion: 1,
    modelRole: 'fast',
    triggerKinds: ['complete', 'schedule'],
    skillIds: ['meeting-followup'],
    allowedCapabilityIds: ['meeting.followup'],
    outputSchemaId: 'meeting.followup.v1',
    concurrency: 1,
    timeoutMs: 20_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.analyst',
    version: 1,
    promptVersion: 1,
    modelRole: 'reason',
    triggerKinds: ['review'],
    skillIds: ['meeting-analyst'],
    allowedCapabilityIds: ['meeting.analyze'],
    outputSchemaId: 'meeting.analyst.v1',
    concurrency: 1,
    timeoutMs: 30_000,
    enabledByDefault: true,
  },
]

export function isBuiltinMeetingAgentId(id: string): id is BuiltinMeetingAgentId {
  return (BUILTIN_MEETING_AGENT_IDS as readonly string[]).includes(id)
}
