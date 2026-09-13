import type { Rox2Context } from '@craft-agent/core/rox2'
import { sameContextSnapshot, visibleContextEntityRefs } from '@craft-agent/core/rox2'
import { authorizeMeetingAction, type MeetingGrant } from './policies.ts'

export type AssistAnswer =
  | { status: 'ok'; text: string; citations: readonly string[]; unstable: boolean }
  | { status: 'denied'; code: string }
  | { status: 'uncertain'; reason: string }

export function answerMeetingQuestion(input: {
  question: string
  context: Rox2Context
  readableEntityIds: ReadonlySet<string>
  grant: MeetingGrant | null
  actorId: string
  deviceId: string
  snapshotCurrent?: Rox2Context
  screenScopeId?: string
  selectedScopeId?: string
  revoked?: boolean
  transcriptPartial?: boolean
  frameText?: string
}): AssistAnswer {
  if (input.revoked) return { status: 'denied', code: 'revoked' }
  const auth = authorizeMeetingAction(input.grant, {
    actorId: input.actorId,
    workspaceId: input.context.workspaceId,
    deviceId: input.deviceId,
    capability: 'screen',
    operation: 'assist',
  })
  if (!auth.ok && /\bэкран|screen\b/i.test(input.question)) return { status: 'denied', code: auth.code }
  const visible = visibleContextEntityRefs(input.context, input.readableEntityIds)
  if (visible.length === 0) return { status: 'uncertain', reason: 'no-context' }
  if (input.snapshotCurrent && !sameContextSnapshot(input.context, input.snapshotCurrent)) {
    return { status: 'denied', code: 'stale-snapshot' }
  }
  if (input.screenScopeId && input.selectedScopeId && input.screenScopeId !== input.selectedScopeId) {
    return { status: 'denied', code: 'scope-mismatch' }
  }
  if (input.frameText && /игнорируй правила|ignore previous/i.test(input.frameText)) {
    return { status: 'ok', text: 'Frame content is untrusted data, not instructions.', citations: visible, unstable: true }
  }
  if (!input.question.trim()) return { status: 'uncertain', reason: 'empty-question' }
  return {
    status: 'ok',
    text: input.transcriptPartial ? 'Partial transcript; answer may change.' : `Answer from allowed sources.`,
    citations: visible,
    unstable: Boolean(input.transcriptPartial),
  }
}
