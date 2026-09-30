/**
 * Cron Matching Utilities for Automations
 *
 * Determines whether a cron expression matches a supplied instant (or the
 * current time when omitted). Used by SchedulerTick automations.
 */

import { Cron } from 'croner';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('cron-matcher');

/**
 * Check whether a cron expression matches the minute containing an instant.
 * The containing UTC minute is evaluated in the optional IANA timezone, so
 * repeated fall-back minutes are both valid occurrences and spring-forward
 * gap minutes never match.
 *
 * @param cronExpr - Cron expression in 5-field format (minute hour day-of-month month day-of-week)
 * @param timezone - Optional IANA timezone (e.g., "Europe/Budapest", "America/New_York")
 * @param instant - Number, Date, or parseable date string; defaults to now
 * @returns true if the cron expression matches that minute
 *
 * @example
 * matchesCron('* * * * *')                                  // Matches current minute
 * matchesCron('0 9 * * *', 'Europe/Budapest')              // Matches 9:00 AM Budapest time
 * matchesCron('0 9 * * *', 'UTC', '2026-02-09T09:30:00Z')  // Matches the supplied minute
 */
export function matchesCron(cronExpr: string, timezone?: string, instant: number | Date | string = Date.now()): boolean {

  try {
    const job = new Cron(cronExpr, timezone ? { timezone } : {});
    const now = instant instanceof Date ? instant : new Date(instant);
    if (!Number.isFinite(now.getTime())) return false;
    const startOfMinute = new Date(now);
    startOfMinute.setSeconds(0, 0);
    return job.match(startOfMinute);
  } catch (error) {
    log.debug(`[matchesCron] Invalid schedule: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
