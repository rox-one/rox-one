/**
 * W1-09 (#1506) — `notification_pref` resolution and email batching windows.
 *
 * The windows are table-driven: the delivery class comes from the kind table's
 * channels, the length from `EMAIL_WINDOW_MINUTES`, and a principal's
 * `batch_minutes` overrides the default for batched kinds.
 */
import { describe, expect, it } from 'bun:test'
import {
  BATCHED_NOTIFICATION_KINDS,
  DEFAULT_EMAIL_BATCH_WINDOW_MINUTES,
  EMAIL_WINDOW_MINUTES,
  applyNotificationPrefUpdate,
  coalesceNotificationIntoBatch,
  defaultChannelsFor,
  dueEmailBatches,
  emailDeliveryFor,
  indexNotificationPrefs,
  isNotificationChannelList,
  mutedPrincipalsFor,
  notificationPrefKey,
  openEmailBatch,
  planEmailDelivery,
  resolveNotificationPref,
  type NotificationEmailBatchRow,
  type NotificationPrefRow,
} from '../index.ts'

const WORKSPACE = 'workspace-1'
const AT = Date.parse('2026-10-08T10:00:00.000Z')

function prefRow(overrides: Partial<NotificationPrefRow> = {}): NotificationPrefRow {
  return {
    workspaceId: WORKSPACE,
    principalId: 'principal-1',
    kind: 'comment',
    enabled: true,
    channels: ['inbox'],
    batchMinutes: DEFAULT_EMAIL_BATCH_WINDOW_MINUTES,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('notification preferences', () => {
  it('falls back to the kind table: declared channels minus opt-in instant email', () => {
    expect(defaultChannelsFor('mention')).toEqual(['inbox', 'os'])
    expect(defaultChannelsFor('rule_failed')).toEqual(['agent_dm'])
    expect(resolveNotificationPref({}, 'principal-1', 'mention')).toMatchObject({ enabled: true, channels: ['inbox', 'os'] })
  })

  it('applies a stored row, including the mute', () => {
    const index = indexNotificationPrefs([prefRow({ principalId: 'principal-1', kind: 'comment', enabled: false })])
    expect(notificationPrefKey('principal-1', 'comment')).toBe('principal-1\u0000comment')
    expect(resolveNotificationPref(index, 'principal-1', 'comment')).toMatchObject({ enabled: false, channels: [] })
    // Another principal is unaffected.
    expect(resolveNotificationPref(index, 'principal-2', 'comment').enabled).toBe(true)
  })

  it('lists exactly the muted principals for a kind', () => {
    const index = indexNotificationPrefs([
      prefRow({ principalId: 'p1', kind: 'comment', enabled: false }),
      prefRow({ principalId: 'p2', kind: 'comment', enabled: true }),
      prefRow({ principalId: 'p3', kind: 'mention', enabled: false }),
    ])
    expect(mutedPrincipalsFor(index, ['p1', 'p2', 'p3'], 'comment')).toEqual(['p1'])
  })

  it('upserts a pref row without losing the fields the update omits', () => {
    const current = prefRow({ channels: ['inbox', 'os'], batchMinutes: 30 })
    const updated = applyNotificationPrefUpdate(current, { kind: 'comment', enabled: false }, { workspaceId: WORKSPACE, principalId: 'principal-1', now: '2026-10-08T10:00:00.000Z' })
    expect(updated).toMatchObject({ enabled: false, channels: ['inbox', 'os'], batchMinutes: 30, createdAt: current.createdAt, updatedAt: '2026-10-08T10:00:00.000Z' })
    const created = applyNotificationPrefUpdate(undefined, { kind: 'mention' }, { workspaceId: WORKSPACE, principalId: 'principal-9', now: '2026-10-08T10:00:00.000Z' })
    expect(created).toMatchObject({ principalId: 'principal-9', kind: 'mention', enabled: true, channels: ['inbox', 'os'], batchMinutes: DEFAULT_EMAIL_BATCH_WINDOW_MINUTES })
  })

  it('validates channel lists', () => {
    expect(isNotificationChannelList(['inbox', 'agent_dm'])).toBe(true)
    expect(isNotificationChannelList(['inbox', 'telegram'])).toBe(false)
    expect(isNotificationChannelList('inbox')).toBe(false)
  })
})

describe('email batching windows', () => {
  it('derives the delivery class from the kind channels', () => {
    expect(emailDeliveryFor('mention')).toBe('instant')
    expect(emailDeliveryFor('comment')).toBe('batched')
    expect(emailDeliveryFor('check_in_due')).toBe('digest')
    expect(emailDeliveryFor('reminder_due')).toBe('none')
    expect(BATCHED_NOTIFICATION_KINDS).toEqual(['assignment', 'comment', 'suggestion'])
  })

  it('uses the table window and honours the principal batch_minutes override', () => {
    expect(planEmailDelivery('comment')).toEqual({ delivery: 'batched', windowMinutes: EMAIL_WINDOW_MINUTES.batched })
    expect(planEmailDelivery('comment', 30)).toEqual({ delivery: 'batched', windowMinutes: 30 })
    expect(planEmailDelivery('comment', 0)).toEqual({ delivery: 'batched', windowMinutes: DEFAULT_EMAIL_BATCH_WINDOW_MINUTES })
    expect(planEmailDelivery('mention', 30)).toEqual({ delivery: 'instant', windowMinutes: 0 })
    expect(planEmailDelivery('check_in_due', 30)).toEqual({ delivery: 'digest', windowMinutes: 24 * 60 })
    expect(planEmailDelivery('reminder_due', 30)).toEqual({ delivery: 'none', windowMinutes: 0 })
  })

  it('opens one batch per window and coalesces everything inside it', () => {
    const first = coalesceNotificationIntoBatch(undefined, { batchId: 'batch-1', workspaceId: WORKSPACE, principalId: 'p1', at: AT, windowMinutes: 5 })
    expect(first.created).toBe(true)
    expect(first.batch).toMatchObject({ status: 'pending', windowMinutes: 5, windowStartedAt: '2026-10-08T10:00:00.000Z', sendAt: '2026-10-08T10:05:00.000Z' })

    const second = coalesceNotificationIntoBatch(first.batch, { batchId: 'batch-2', workspaceId: WORKSPACE, principalId: 'p1', at: AT + 60_000, windowMinutes: 5 })
    expect(second.created).toBe(false)
    expect(second.batch.batchId).toBe('batch-1')

    // A different principal, a longer window and a closed window each open a new batch.
    expect(coalesceNotificationIntoBatch(first.batch, { batchId: 'b', workspaceId: WORKSPACE, principalId: 'p2', at: AT + 60_000, windowMinutes: 5 }).created).toBe(true)
    expect(coalesceNotificationIntoBatch(first.batch, { batchId: 'c', workspaceId: WORKSPACE, principalId: 'p1', at: AT + 60_000, windowMinutes: 30 }).created).toBe(true)
    const afterWindow = coalesceNotificationIntoBatch(first.batch, { batchId: 'd', workspaceId: WORKSPACE, principalId: 'p1', at: AT + 5 * 60_000, windowMinutes: 5 })
    expect(afterWindow.created).toBe(true)
    expect(afterWindow.batch.sendAt).toBe('2026-10-08T10:10:00.000Z')
  })

  it('holds a batch until its window closes, then reports it due', () => {
    const batch = openEmailBatch({ batchId: 'batch-1', workspaceId: WORKSPACE, principalId: 'p1', at: AT, windowMinutes: 5 })
    expect(dueEmailBatches([batch], AT + 4 * 60_000)).toEqual([])
    expect(dueEmailBatches([batch], AT + 5 * 60_000)).toEqual([batch])
    const sent: NotificationEmailBatchRow = { ...batch, status: 'sent', sentAt: batch.sendAt }
    expect(dueEmailBatches([sent], AT + 60 * 60_000)).toEqual([])
    const older = openEmailBatch({ batchId: 'batch-0', workspaceId: WORKSPACE, principalId: 'p2', at: AT - 60_000, windowMinutes: 5 })
    expect(dueEmailBatches([batch, older], AT + 10 * 60_000).map(entry => entry.batchId)).toEqual(['batch-0', 'batch-1'])
  })
})