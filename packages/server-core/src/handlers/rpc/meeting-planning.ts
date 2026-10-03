import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { planMeetingActions, type MeetingPlanInput } from '@rox/shared/meeting-agents'
import type { RpcServer, RequestContext } from '../../transport/index.ts'
import type { HandlerDeps } from '../handler-deps.ts'
import { MeetingJournal } from '../../meetings/journal.ts'

/** Captures verified identity/fence; never accepts a payload grant as authority. */
export function nativeMeetingPlanner(deps: HandlerDeps, ctx: Pick<RequestContext, 'principal' | 'workspaceId'>,
  workspaceId: string, root: string | null) {
  const authority = deps.nativeData?.authority
  const principal = ctx.principal
  if (!authority || !principal || !workspaceId || workspaceId !== ctx.workspaceId || !root) {
    throw new CodedError('AUTH_FAILED', 'Authenticated canonical Meeting workspace is required')
  }
  const fence = authority.permissionFence(principal, workspaceId, 'read')
  const assertRead = () => {
    if (!fence || !authority.authorize(principal, workspaceId, 'read') ||
      authority.permissionFence(principal, workspaceId, 'read') !== fence) {
      throw new CodedError('AUTH_FAILED', 'Meeting read permission changed')
    }
  }
  assertRead()
  return {
    async plan(input: MeetingPlanInput) {
      assertRead()
      if (!input || typeof input.meetingId !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/.test(input.meetingId) ||
        input.meetingId === '.' || input.meetingId === '..' ||
        (input.slash !== undefined && (typeof input.slash !== 'string' || input.slash.length > 4096))) {
        throw new CodedError('INVALID_REF', 'Invalid meeting planning input')
      }
      const meeting = new MeetingJournal(root, { readOnly: true }).read(input.meetingId).meeting
      assertRead()
      if (meeting.workspaceId !== workspaceId || meeting.meetingId !== input.meetingId || !Number.isSafeInteger(meeting.revision)) {
        throw new CodedError('AUTH_FAILED', 'Meeting belongs to another workspace')
      }
      const plan = planMeetingActions(input, meeting.revision)
      // Revalidate after asynchronous handoff before exposing the source projection.
      await Promise.resolve()
      assertRead()
      return plan
    },
  }
}
export function registerMeetingPlanningHandlers(server: RpcServer, deps: HandlerDeps, rootFor: (id: string) => string | null) {
  server.handle(RPC_CHANNELS.meetings.PLAN_ACTIONS, (ctx, workspaceId: string, input: MeetingPlanInput) =>
    nativeMeetingPlanner(deps, ctx, workspaceId, rootFor(workspaceId)).plan(input), { nativeAction: 'read' })
}
