import { describe, expect, it } from 'bun:test'
import { resolvePromoSlot } from '../promo-slot'

describe('resolvePromoSlot', () => {
  it('hides the slot until insights have loaded', () => {
    expect(resolvePromoSlot({ insightsLoaded: false, onboarded: false, totalLessons: 0 })).toBeNull()
  })

  it('shows onboarding only from a real empty, not-yet-onboarded workspace', () => {
    expect(resolvePromoSlot({ insightsLoaded: true, onboarded: false, totalLessons: 0 })).toBe('onboarding')
    expect(resolvePromoSlot({ insightsLoaded: true, onboarded: true, totalLessons: 0 })).toBeNull()
    expect(resolvePromoSlot({ insightsLoaded: true, onboarded: false, totalLessons: 3 })).toBeNull()
  })

  it('shows reminders only when a measured due count is positive', () => {
    expect(resolvePromoSlot({ insightsLoaded: true, onboarded: true, reminderDueCount: null })).toBeNull()
    expect(resolvePromoSlot({ insightsLoaded: true, onboarded: true, reminderDueCount: 0 })).toBeNull()
    expect(resolvePromoSlot({ insightsLoaded: true, onboarded: true, reminderDueCount: 2 })).toBe('reminder')
  })
})
