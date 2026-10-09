/**
 * W1-12 (#1509) — the daily-note contract (TECH-SPEC §14.3). The renderer's
 * `note-views.ts` re-exports `DAILY_VAULT_FOLDER` / `dailyNoteDestination`, so
 * the same expectations must hold there (see the notes view test).
 */
import { describe, expect, test } from 'bun:test'
import {
  DAILY_VAULT_FOLDER,
  dailyLinkBlockId,
  dailyNoteDateKey,
  dailyNoteDestination,
  dailyNoteId,
  dailyNoteRef,
  isDailyNoteRef,
} from '../daily'

describe('daily note destination', () => {
  test('uses the local date and the daily vault folder', () => {
    expect(DAILY_VAULT_FOLDER).toBe('daily')
    expect(dailyNoteDestination(new Date('2026-09-12T12:00:00Z'))).toEqual({ folder: 'daily', title: '2026-09-12' })
    expect(dailyNoteDestination(new Date(2026, 0, 3, 8, 0, 0))).toEqual({ folder: 'daily', title: '2026-01-03' })
  })

  test('date keys respect an explicit time zone', () => {
    // 2026-10-09T21:30Z is already the 10th in Moscow (UTC+3).
    expect(dailyNoteDateKey('2026-10-09T21:30:00.000Z', 'Europe/Moscow')).toBe('2026-10-10')
    expect(dailyNoteDateKey('2026-10-09T21:30:00.000Z', 'UTC')).toBe('2026-10-09')
    expect(dailyNoteDateKey('2026-10-09T21:30:00.000Z')).toBe(dailyNoteDateKey('2026-10-09T21:30:00.000Z'))
  })

  test('rejects an unparsable date instead of silently using today', () => {
    expect(() => dailyNoteDateKey('not-a-date')).toThrow('Invalid date')
  })
})

describe('deterministic ids', () => {
  test('one note per (workspace, owner, date)', () => {
    const id = dailyNoteId('ws-1', 'principal-mark', '2026-10-09')
    expect(id).toBe(dailyNoteId('ws-1', 'principal-mark', '2026-10-09'))
    expect(id).not.toBe(dailyNoteId('ws-1', 'principal-anna', '2026-10-09'))
    expect(id).not.toBe(dailyNoteId('ws-2', 'principal-mark', '2026-10-09'))
    expect(id).not.toBe(dailyNoteId('ws-1', 'principal-mark', '2026-10-10'))
    expect(dailyNoteRef('ws-1', 'principal-mark', '2026-10-09')).toEqual({ kind: 'note', id })
    expect(isDailyNoteRef('ws-1', 'principal-mark', '2026-10-09', { kind: 'note', id })).toBe(true)
    expect(isDailyNoteRef('ws-1', 'principal-mark', '2026-10-09', { kind: 'note', id: 'other' })).toBe(false)
  })

  test('the daily-link block id is stable per idempotency key (in-place update)', () => {
    const key = 'R1:event-1:single:principal-mark'
    expect(dailyLinkBlockId(key)).toBe(dailyLinkBlockId(key))
    expect(dailyLinkBlockId(key)).not.toBe(dailyLinkBlockId('R1:event-2:single:principal-mark'))
  })
})