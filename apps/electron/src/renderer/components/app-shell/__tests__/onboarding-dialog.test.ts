import { describe, expect, it } from 'bun:test'
import {
  collectOnboardingLessonInputs,
  makeOnboardingSeedDrafts,
  onboardingAddLessonErrorDescription,
  onboardingDraftToLessonInput,
  type OnboardingRuleDraft,
} from '../onboarding-rule-model'

const translations: Record<string, string> = {
  'memory.seed1': 'Перед финальным ответом запускай подходящие проверки: тесты, typecheck или сборку.',
  'memory.seed2': 'Не сохраняй и не коммить секреты: API-ключи, токены, пароли и приватные данные.',
  'memory.seed3': 'Если задача простая, отвечай кратко. Если задача сложная, сначала объясняй план.',
  'memory.lessonAddRecoverable': 'Правило не сохранилось. Исправьте текст, попробуйте ещё раз или пропустите настройку.',
  'memory.lessonAddRecoverableTimeout': 'Сервер памяти не ответил вовремя. Правило осталось на экране, можно попробовать ещё раз или пропустить настройку.',
  'memory.lessonAddRecoverableWorkspace': 'Рабочее пространство не найдено. Выберите другое рабочее пространство или пропустите настройку.',
}

const t = (key: string) => translations[key] ?? key

describe('OnboardingDialog rule drafts', () => {
  it('keeps the default rules selected and maps the forbidden rule to a negative correction', () => {
    const drafts = makeOnboardingSeedDrafts(t)

    expect(drafts.map((draft) => draft.type)).toEqual(['required', 'forbidden', 'discretionary'])
    expect(drafts.every((draft) => draft.selected)).toBe(true)

    expect(collectOnboardingLessonInputs(drafts)).toEqual([
      {
        rule: translations['memory.seed1'],
        category: 'workflow',
        scope: 'global',
      },
      {
        rule: translations['memory.seed2'],
        category: 'correction',
        scope: 'global',
        negative: true,
      },
      {
        rule: translations['memory.seed3'],
        category: 'preference',
        scope: 'global',
      },
    ])
  })

  it('supports a custom label without saving empty or unselected drafts', () => {
    const customDraft: OnboardingRuleDraft = {
      id: 'custom-1',
      text: '  Используй деловой тон  ',
      type: 'custom',
      customLabel: 'Стиль',
      selected: true,
    }
    const emptyDraft: OnboardingRuleDraft = {
      ...customDraft,
      id: 'custom-2',
      text: '   ',
    }
    const unselectedDraft: OnboardingRuleDraft = {
      ...customDraft,
      id: 'custom-3',
      selected: false,
    }

    expect(onboardingDraftToLessonInput(customDraft)).toEqual({
      rule: 'Используй деловой тон',
      category: 'Стиль',
      scope: 'global',
    })
    expect(collectOnboardingLessonInputs([customDraft, emptyDraft, unselectedDraft])).toHaveLength(1)
  })

  it('turns transport failures into recoverable Russian messages', () => {
    expect(onboardingAddLessonErrorDescription(new Error('Request timeout: memory:addLesson (30000ms)'), t))
      .toBe(translations['memory.lessonAddRecoverableTimeout'])
    expect(onboardingAddLessonErrorDescription(new Error('Workspace not found'), t))
      .toBe(translations['memory.lessonAddRecoverableWorkspace'])
    expect(onboardingAddLessonErrorDescription(new Error('disk full'), t))
      .toBe(translations['memory.lessonAddRecoverable'])
  })
})
