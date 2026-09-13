/**
 * Readback verification for meeting operations (issue #366).
 * Only production/live + applied + verified is a done effect.
 */

import { isVerifiedEffect, type Rox2V2Result } from '@craft-agent/core/rox2'

export function fieldsMatch(expected: Record<string, unknown>, observed: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => observed[key] === value)
}

export function isVerifiedMeetingEffect(result: Rox2V2Result): boolean {
  return isVerifiedEffect(result)
}
