import type { Rox2EntityRef } from '../rox2/platform-contract.ts'

export const MEETING_COMMAND_TYPES = [
  'create-meeting',
  'append-proposal',
  'apply-operation',
] as const

export type MeetingCommandType = (typeof MEETING_COMMAND_TYPES)[number]

export type MeetingCommand = {
  commandId: string
  workspaceId: string
  expectedRevision: number
  type: MeetingCommandType
  payload: Record<string, unknown>
}

export type CreateMeetingPayload = {
  ref: Rox2EntityRef
  title: string
  callBinding?: {
    provider: string
    account: string
    remoteType: string
    remoteId: string
  }
  sourceRevisions?: Record<string, string>
  createdAt?: number
}

export function parseMeetingCommand(raw: unknown): MeetingCommand {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Meeting command is required')
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.commandId !== 'string' || !obj.commandId) {
    throw new Error('commandId is required')
  }
  if (typeof obj.workspaceId !== 'string' || !obj.workspaceId) {
    throw new Error('workspaceId is required')
  }
  if (typeof obj.expectedRevision !== 'number' || !Number.isInteger(obj.expectedRevision) || obj.expectedRevision < 0) {
    throw new Error('expectedRevision is required')
  }
  if (typeof obj.type !== 'string' || !(MEETING_COMMAND_TYPES as readonly string[]).includes(obj.type)) {
    throw new Error('Unknown meeting command type')
  }
  const payload = obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)
    ? { ...(obj.payload as Record<string, unknown>) }
    : {}
  return {
    commandId: obj.commandId,
    workspaceId: obj.workspaceId,
    expectedRevision: obj.expectedRevision,
    type: obj.type as MeetingCommandType,
    payload,
  }
}
