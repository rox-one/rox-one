import { describe, expect, test } from 'bun:test'
import { claimDailySweep } from '../background'

function memoryStorage() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) } }
}

describe('radar daily claim', () => {
  test('only one claim per workspace per local day', () => {
    const storage = memoryStorage()
    const day1 = new Date(2026, 8, 29, 8).getTime()
    expect(claimDailySweep('ws', day1, storage)).toBe(true)
    expect(claimDailySweep('ws', day1 + 3600e3, storage)).toBe(false)
    expect(claimDailySweep('other', day1, storage)).toBe(true)
    expect(claimDailySweep('ws', day1 + 24 * 3600e3, storage)).toBe(true)
  })
})
