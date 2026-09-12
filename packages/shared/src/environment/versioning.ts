import {
  ENVIRONMENT_QUESTIONNAIRE_VERSION,
  QUESTION_IDS,
  QUESTION_VERSIONS,
  unanswered,
  type Choice,
  type EnvironmentPrefs,
  type QuestionId,
} from './types.ts'

export function pendingQuestionIds(
  prefs: EnvironmentPrefs,
  currentVersion: number = ENVIRONMENT_QUESTIONNAIRE_VERSION,
  versions: Record<QuestionId, number> = QUESTION_VERSIONS,
): QuestionId[] {
  return QUESTION_IDS.filter((id) => versions[id]! > prefs.seenVersion && versions[id]! <= currentVersion)
}

export function skipChoice<T>(current: Choice<T>): Choice<T> {
  if (current.status === 'answered') return current
  return { status: 'skipped', value: current.value }
}

export function answerChoice<T>(value: T): Choice<T> {
  return { status: 'answered', value }
}

export function skipUnansweredQuestions(prefs: EnvironmentPrefs): EnvironmentPrefs {
  const pending = new Set(pendingQuestionIds(prefs))
  return {
    ...prefs,
    modelPlacement: pending.has('modelPlacement') ? skipChoice(prefs.modelPlacement) : prefs.modelPlacement,
    sttEngine: pending.has('sttTts') ? skipChoice(prefs.sttEngine) : prefs.sttEngine,
    ttsEngine: pending.has('sttTts') ? skipChoice(prefs.ttsEngine) : prefs.ttsEngine,
    wakeWord: pending.has('wakeWord') ? skipChoice(prefs.wakeWord) : prefs.wakeWord,
    browserImport: pending.has('browserImport') ? skipChoice(prefs.browserImport) : prefs.browserImport,
    syncPurposes: pending.has('syncPurposes') ? skipChoice(prefs.syncPurposes) : prefs.syncPurposes,
    notifications: pending.has('notifications') ? skipChoice(prefs.notifications) : prefs.notifications,
  }
}

export function markQuestionnaireSeen(
  prefs: EnvironmentPrefs,
  version: number = ENVIRONMENT_QUESTIONNAIRE_VERSION,
  now: number = Date.now(),
): EnvironmentPrefs {
  return {
    ...prefs,
    seenVersion: Math.max(prefs.seenVersion, version),
    updatedAt: now,
  }
}

export function finishQuestionnaire(
  prefs: EnvironmentPrefs,
  version: number = ENVIRONMENT_QUESTIONNAIRE_VERSION,
  now: number = Date.now(),
): EnvironmentPrefs {
  return markQuestionnaireSeen(skipUnansweredQuestions(prefs), version, now)
}

export function resetUnansweredIfMissing(choice: Choice<unknown> | undefined): Choice<unknown> {
  if (!choice) return unanswered()
  return choice
}
