/**
 * Mail/CRM/calendar/room shells on meetings.ts are mixed Conation leftover.
 * They persist local drafts/ledgers. They never claim live Conation.
 */
import { fixtureResult, isClaimableLive, normalizeRox2Result, queuedResult, type Rox2CanonicalResult, type Rox2Result } from './platform-contract.ts'

export const MEETING_CONATION_SHELLS = ['mail', 'crm', 'calendar', 'room'] as const
export type MeetingConationShellKind = (typeof MEETING_CONATION_SHELLS)[number]
export type MeetingConationShellSource = 'native' | 'fixture' | 'conation'

export function meetingConationShellResult(opts: {
  source: MeetingConationShellSource
  shell: MeetingConationShellKind
}): Rox2CanonicalResult {
  if (opts.source === 'fixture') {
    return fixtureResult(`meetings.${opts.shell}.fixture`, `Playground ${opts.shell} is fixture, not live`)
  }
  return queuedResult(
    `meetings.${opts.shell}.queued`,
    `${opts.shell} Conation shell is queued; DTO ok is not live`,
  )
}

export function assertMeetingConationShellNotLive(result: Rox2Result): void {
  const status = normalizeRox2Result(result)
  if (isClaimableLive(result)) {
    throw new Error('meeting Conation shell must not claim live')
  }
  if (status.lifecycle === 'queued' && status.verification !== 'unverified') {
    throw new Error('queued meeting Conation shell must not report verified')
  }
  if (status.lifecycle === 'queued' && result.ok === true) {
    throw new Error('queued meeting Conation shell must not report success')
  }
}

export function gateMeetingConationShell<T extends object>(
  shell: MeetingConationShellKind,
  payload: T,
  source: MeetingConationShellSource = 'conation',
): T & { rox2: Rox2CanonicalResult } {
  const rox2 = meetingConationShellResult({ source, shell })
  assertMeetingConationShellNotLive(rox2)
  return { ...payload, rox2 }
}
