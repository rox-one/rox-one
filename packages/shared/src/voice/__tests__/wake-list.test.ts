import { describe, expect, it } from 'bun:test'
import {
  MAX_WAKE_TRIGGER_UNITS,
  MAX_WAKE_TRIGGERS,
  defaultVoiceWakeList,
  matchesWakeTrigger,
  normalizeWakeList,
  normalizeWakeTrigger,
  toWakeChangedPayload,
} from '../wake-list.ts'

describe('wake trigger normalization', () => {
  it('NFC-normalizes, collapses whitespace and strips control characters', () => {
    expect(normalizeWakeTrigger('  Привет,\u0000\tРокс!  ')).toBe('Привет, Рокс!')
    expect(normalizeWakeTrigger('e\u0301lan')).toBe('\u00e9lan')
  })

  it('rejects empty and non-string inputs', () => {
    expect(normalizeWakeTrigger('   ')).toBeNull()
    expect(normalizeWakeTrigger('')).toBeNull()
    expect(normalizeWakeTrigger(42)).toBeNull()
    expect(normalizeWakeTrigger(null)).toBeNull()
  })

  it('clamps to 64 UTF-16 units without splitting a surrogate pair', () => {
    const long = 'a'.repeat(100)
    expect(normalizeWakeTrigger(long)).toHaveLength(MAX_WAKE_TRIGGER_UNITS)
    const emoji = '🔊'.repeat(40)
    const clamped = normalizeWakeTrigger(emoji)!
    expect(clamped.length).toBeLessThanOrEqual(MAX_WAKE_TRIGGER_UNITS)
    // No lone high surrogate left dangling by the cut.
    const last = clamped.charCodeAt(clamped.length - 1)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
  })
})

describe('wake list normalization', () => {
  it('de-duplicates case-insensitively, first spelling wins', () => {
    const { list, dropped } = normalizeWakeList({ triggers: ['Рокс', 'рокс', 'Rox', 'ROX'] })
    expect(list.triggers).toEqual(['Рокс', 'Rox'])
    expect(dropped).toBe(2)
  })

  it('caps the list at 32 triggers', () => {
    const triggers = Array.from({ length: 40 }, (_, index) => `trigger ${index}`)
    const { list, dropped } = normalizeWakeList({ triggers })
    expect(list.triggers).toHaveLength(MAX_WAKE_TRIGGERS)
    expect(dropped).toBe(8)
  })

  it('keeps the routing and does not bump revision on a no-op set', () => {
    const first = normalizeWakeList({ triggers: ['Рокс'], routing: 'agent' }, undefined, 1_000)
    expect(first.list).toEqual({ triggers: ['Рокс'], routing: 'agent', updatedAt: 1_000, revision: 1 })
    const second = normalizeWakeList({ triggers: ['рокс'], routing: 'agent' }, first.list, 2_000)
    expect(second.list.updatedAt).toBe(1_000)
    expect(second.list.revision).toBe(1)
    const third = normalizeWakeList({ triggers: ['Рокс', 'Rox'] }, second.list, 3_000)
    expect(third.list.revision).toBe(2)
    expect(third.list.updatedAt).toBe(3_000)
  })

  it('falls back to the previous list when triggers are absent', () => {
    const previous = defaultVoiceWakeList(500)
    const { list } = normalizeWakeList({ routing: 'none' }, { ...previous, triggers: ['Рокс'] }, 600)
    expect(list.triggers).toEqual(['Рокс'])
    expect(list.routing).toBe('none')
  })
})

describe('wake trigger matching', () => {
  const list = { triggers: ['Рокс', 'Hey Rox'] }

  it('matches case-insensitively on word boundaries', () => {
    expect(matchesWakeTrigger(list, 'Слушай, рокс, включи музыку')).toBe('Рокс')
    expect(matchesWakeTrigger(list, 'hey rox open the door')).toBe('Hey Rox')
    expect(matchesWakeTrigger(list, 'rockstar')).toBeNull()
    expect(matchesWakeTrigger(list, 'Рокси')).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(matchesWakeTrigger(list, '')).toBeNull()
    expect(matchesWakeTrigger({ triggers: [] }, 'Рокс')).toBeNull()
  })
})

describe('wake changed payload', () => {
  it('mirrors the renderer { enabled, names } shape and copies the trigger array', () => {
    const source = { triggers: ['Рокс'], routing: 'session' as const, updatedAt: 1, revision: 1 }
    const payload = toWakeChangedPayload(source, true)
    expect(payload).toEqual({ enabled: true, names: ['Рокс'] })
    payload.names.push('mutated')
    expect(source.triggers).toEqual(['Рокс'])
  })
})