/**
 * Eight builtin meeting-agent role definitions (issue #358 / R01).
 * IDs are stable PRD identifiers. These are not eight always-running sessions.
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

export type MeetingCapabilityId =
  | 'capture.microphone'
  | 'capture.system'
  | 'capture.screen'
  | 'processing.cloud'
  | 'archive.durable'
  | 'action.external'

export type BuiltinRoleDefinition = {
  id: BuiltinMeetingAgentId
  version: number
  promptVersion: number
  modelRole: MeetingModelRole
  triggerKinds: readonly string[]
  skillIds: readonly string[]
  allowedCapabilityIds: readonly MeetingCapabilityId[]
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
    triggerKinds: ['prepare', 'start', 'end'],
    skillIds: ['meeting.brief', 'meeting.coverage'],
    allowedCapabilityIds: ['archive.durable'],
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
    triggerKinds: ['hotkey', 'question'],
    skillIds: ['meeting.assist', 'meeting.screen-explain'],
    allowedCapabilityIds: ['capture.screen'],
    outputSchemaId: 'meeting.assist.v1',
    concurrency: 1,
    timeoutMs: 15_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.scribe',
    version: 1,
    promptVersion: 1,
    modelRole: 'transcribe',
    triggerKinds: ['speech'],
    skillIds: ['meeting.transcript', 'meeting.notes'],
    allowedCapabilityIds: ['capture.microphone', 'capture.system', 'processing.cloud', 'archive.durable'],
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
    skillIds: ['meeting.knowledge-diff'],
    allowedCapabilityIds: ['archive.durable'],
    outputSchemaId: 'meeting.knowledge.v1',
    concurrency: 1,
    timeoutMs: 20_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.executor',
    version: 1,
    promptVersion: 1,
    modelRole: 'fast',
    triggerKinds: ['approved-command'],
    skillIds: ['meeting.execute'],
    allowedCapabilityIds: ['action.external'],
    outputSchemaId: 'meeting.executor.v1',
    concurrency: 1,
    timeoutMs: 45_000,
    enabledByDefault: true,
  },
  {
    id: 'rox.meeting.author',
    version: 1,
    promptVersion: 1,
    modelRole: 'artifact',
    triggerKinds: ['document', 'research'],
    skillIds: [
      'meeting.author',
      'meeting.author.code',
      'meeting.author.csv',
      'meeting.author.docx',
      'meeting.author.markdown',
      'meeting.author.pdf',
      'meeting.author.pptx',
      'meeting.author.research',
      'meeting.author.xlsx',
    ],
    allowedCapabilityIds: ['archive.durable'],
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
    triggerKinds: ['end', 'schedule'],
    skillIds: ['meeting.followup'],
    allowedCapabilityIds: ['action.external'],
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
    triggerKinds: ['profile', 'review'],
    skillIds: ['meeting.risks', 'meeting.crm'],
    allowedCapabilityIds: ['archive.durable'],
    outputSchemaId: 'meeting.analyst.v1',
    concurrency: 1,
    timeoutMs: 30_000,
    enabledByDefault: true,
  },
]

export function builtinMeetingAgent(id: string): BuiltinRoleDefinition | undefined {
  return BUILTIN_MEETING_AGENTS.find((role) => role.id === id)
}
