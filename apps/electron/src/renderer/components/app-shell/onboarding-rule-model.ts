import type { LessonCategory } from '@craft-agent/shared/memory/types'

export type OnboardingRuleType = 'required' | 'forbidden' | 'discretionary' | 'custom'

export interface OnboardingRuleDraft {
  id: string
  text: string
  type: OnboardingRuleType
  customLabel: string
  selected: boolean
}

export interface OnboardingLessonInput {
  rule: string
  category: LessonCategory
  negative?: boolean
  scope: 'global'
}

interface SeedLesson {
  key: 'memory.seed1' | 'memory.seed2' | 'memory.seed3'
  type: OnboardingRuleType
}

const SEEDS: SeedLesson[] = [
  { key: 'memory.seed1', type: 'required' },
  { key: 'memory.seed2', type: 'forbidden' },
  { key: 'memory.seed3', type: 'discretionary' },
]

const TYPE_CATEGORY: Record<Exclude<OnboardingRuleType, 'custom'>, LessonCategory> = {
  required: 'workflow',
  forbidden: 'correction',
  discretionary: 'preference',
}

export const ONBOARDING_RULE_TYPES: OnboardingRuleType[] = ['required', 'forbidden', 'discretionary', 'custom']

export const ONBOARDING_RULE_TYPE_LABEL_KEYS: Record<OnboardingRuleType, string> = {
  required: 'memory.ruleType.required',
  forbidden: 'memory.ruleType.forbidden',
  discretionary: 'memory.ruleType.discretionary',
  custom: 'memory.ruleType.custom',
}

type Translate = (key: string) => string

export function makeOnboardingSeedDrafts(t: Translate): OnboardingRuleDraft[] {
  return SEEDS.map((seed, index) => ({
    id: `seed-${index}`,
    text: t(seed.key),
    type: seed.type,
    customLabel: '',
    selected: true,
  }))
}

export function makeBlankOnboardingDraft(id = 'custom-0'): OnboardingRuleDraft {
  return {
    id,
    text: '',
    type: 'custom',
    customLabel: '',
    selected: false,
  }
}

export function onboardingDraftToLessonInput(draft: OnboardingRuleDraft): OnboardingLessonInput | null {
  const rule = draft.text.trim()
  if (!draft.selected || !rule) return null
  const customLabel = draft.customLabel.trim()
  return {
    rule,
    category: draft.type === 'custom' ? (customLabel || 'custom') : TYPE_CATEGORY[draft.type],
    scope: 'global',
    ...(draft.type === 'forbidden' ? { negative: true } : {}),
  }
}

export function collectOnboardingLessonInputs(drafts: OnboardingRuleDraft[]): OnboardingLessonInput[] {
  return drafts.map(onboardingDraftToLessonInput).filter((input): input is OnboardingLessonInput => input !== null)
}

export function onboardingAddLessonErrorDescription(err: unknown, t: Translate): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/timeout|timed?\s*out|30000ms|30s/i.test(raw)) return t('memory.lessonAddRecoverableTimeout')
  if (/workspace not found/i.test(raw)) return t('memory.lessonAddRecoverableWorkspace')
  return t('memory.lessonAddRecoverable')
}
