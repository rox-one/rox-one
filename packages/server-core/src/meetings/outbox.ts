/**
 * Meeting outbox job statuses (issue #366).
 * Transport success is not an ack.
 */

export type MeetingOutboxStatus = 'pending' | 'leased' | 'acked' | 'failed' | 'unknown'

export function isTerminalOutboxStatus(status: MeetingOutboxStatus): boolean {
  return status === 'acked' || status === 'failed' || status === 'unknown'
}

export function isUnknownOutboxStatus(status: MeetingOutboxStatus): boolean {
  return status === 'unknown'
}
