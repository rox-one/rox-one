import type { XpEventType } from './levels.ts'

export const QUEST_IDS = [
  'first_note',
  'first_link',
  'first_task',
  'first_workflow',
  'first_browser',
  'privacy_review',
] as const

export type QuestId = (typeof QUEST_IDS)[number]

export type QuestStatus = 'available' | 'completed' | 'dismissed' | 'snoozed' | 'skipped_cloud'

export interface QuestRecord {
  id: QuestId
  status: QuestStatus
  snoozeUntil?: number
  completedAt?: number
}

/** Fill-pill scores shown in the session composer (not the home quest strip). */
export const SESSION_RATING_PILLS = [1, 2, 3, 10, 25, 50, 75, 100] as const

export interface SessionRating {
  sessionId: string
  score: number
  feedback?: string
  provenance?: string
  at: number
}

export function normalizeSessionRatingScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded < 1 || rounded > 100) return null
  return rounded
}

export const QUEST_XP_EVENT: Record<QuestId, XpEventType> = {
  first_note: 'first_note',
  first_link: 'note_linked',
  first_task: 'first_task',
  first_workflow: 'first_workflow',
  first_browser: 'first_browser',
  privacy_review: 'privacy_review',
}

/** Cloud-tied quests stay optional when the user turned cloud features off. */
export const QUEST_CLOUD_REQUIRED: Record<QuestId, boolean> = {
  first_note: false,
  first_link: false,
  first_task: false,
  first_workflow: false,
  first_browser: true,
  privacy_review: false,
}

export const QUEST_SNOOZE_MS = 72 * 60 * 60 * 1000

export function isQuestId(value: unknown): value is QuestId {
  return typeof value === 'string' && (QUEST_IDS as readonly string[]).includes(value)
}

export function defaultQuestRecords(): Record<QuestId, QuestRecord> {
  const records = {} as Record<QuestId, QuestRecord>
  for (const id of QUEST_IDS) {
    records[id] = { id, status: 'available' }
  }
  return records
}

export function visibleQuests(
  quests: Record<QuestId, QuestRecord>,
  now: number = Date.now(),
  cloudFeaturesEnabled: boolean = true,
): QuestRecord[] {
  const visible: QuestRecord[] = []
  for (const id of QUEST_IDS) {
    const quest = quests[id] ?? { id, status: 'available' as const }
    if (quest.status === 'completed' || quest.status === 'dismissed' || quest.status === 'skipped_cloud') {
      continue
    }
    if (quest.status === 'snoozed' && (quest.snoozeUntil ?? 0) > now) continue
    if (QUEST_CLOUD_REQUIRED[id] && !cloudFeaturesEnabled) {
      continue
    }
    visible.push(quest)
  }
  return visible
}

export function planProductAnalytics(
  event: string,
  analyticsConsent: boolean,
): { event: string; sent: boolean; localOnly: boolean } {
  if (!analyticsConsent) {
    return { event, sent: false, localOnly: true }
  }
  return { event, sent: true, localOnly: false }
}
