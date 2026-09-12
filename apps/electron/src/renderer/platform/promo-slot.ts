/**
 * Onboarding / reminder promo. Hidden until real insights load.
 * reminderDueCount must be a measured number — never invent a count.
 */

export type PromoKind = 'onboarding' | 'reminder'

export function resolvePromoSlot(input: {
  insightsLoaded: boolean
  onboarded?: boolean
  totalLessons?: number
  reminderDueCount?: number | null
}): PromoKind | null {
  if (!input.insightsLoaded) return null
  if (input.onboarded === false && input.totalLessons === 0) return 'onboarding'
  if (input.reminderDueCount != null && input.reminderDueCount > 0) return 'reminder'
  return null
}
