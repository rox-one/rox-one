/**
 * Versioned environment questionnaire for onboarding and Settings.
 *
 * seenVersion is the last questionnaire revision the user finished (or skipped).
 * Bumping ENVIRONMENT_QUESTIONNAIRE_VERSION plus a new QUESTION_VERSIONS entry
 * is how existing users see only new questions.
 */

export const ENVIRONMENT_QUESTIONNAIRE_VERSION = 1

export const QUESTION_IDS = [
  'modelPlacement',
  'sttTts',
  'wakeWord',
  'browserImport',
  'syncPurposes',
  'notifications',
  'agentRules',
] as const

export type QuestionId = (typeof QUESTION_IDS)[number]

/** Questionnaire revision that introduced each question. */
export const QUESTION_VERSIONS: Record<QuestionId, number> = {
  modelPlacement: 1,
  sttTts: 1,
  wakeWord: 1,
  browserImport: 1,
  syncPurposes: 1,
  notifications: 1,
  agentRules: 1,
}

export type ModelPlacement = 'local' | 'cloud' | 'mixed'
export type SttChoice = 'local' | 'cloud'
export type TtsChoice = 'edge' | 'local'
export type AgentRuleLabel = 'must' | 'forbid' | 'discretion' | 'custom'

export const BROWSER_IMPORT_CATEGORIES = [
  'bookmarks',
  'history',
  'cookies',
  'extensions',
] as const
export type BrowserImportCategory = (typeof BROWSER_IMPORT_CATEGORIES)[number]

export const SYNC_PURPOSES = ['backup', 'devices', 'insights'] as const
export type SyncPurpose = (typeof SYNC_PURPOSES)[number]

export type ChoiceStatus = 'unanswered' | 'skipped' | 'answered'

export interface Choice<T> {
  status: ChoiceStatus
  value: T | null
}

export interface AgentRule {
  id: string
  text: string
  label: AgentRuleLabel
}

export interface EnvironmentPrefs {
  version: 1
  /** Last questionnaire revision the user completed or skipped as a whole. */
  seenVersion: number
  modelPlacement: Choice<ModelPlacement>
  sttEngine: Choice<SttChoice>
  ttsEngine: Choice<TtsChoice>
  wakeWord: Choice<boolean>
  browserImport: Choice<BrowserImportCategory[]>
  syncPurposes: Choice<SyncPurpose[]>
  notifications: Choice<boolean>
  agentRules: AgentRule[]
  updatedAt: number
}

export function unanswered<T>(): Choice<T> {
  return { status: 'unanswered', value: null }
}

export function getDefaultEnvironmentPrefs(now: number = Date.now()): EnvironmentPrefs {
  return {
    version: 1,
    seenVersion: 0,
    modelPlacement: unanswered(),
    sttEngine: unanswered(),
    ttsEngine: unanswered(),
    wakeWord: unanswered(),
    browserImport: unanswered(),
    syncPurposes: unanswered(),
    notifications: unanswered(),
    agentRules: [],
    updatedAt: now,
  }
}

export function isModelPlacement(value: unknown): value is ModelPlacement {
  return value === 'local' || value === 'cloud' || value === 'mixed'
}

export function isSttChoice(value: unknown): value is SttChoice {
  return value === 'local' || value === 'cloud'
}

export function isTtsChoice(value: unknown): value is TtsChoice {
  return value === 'edge' || value === 'local'
}

export function isAgentRuleLabel(value: unknown): value is AgentRuleLabel {
  return value === 'must' || value === 'forbid' || value === 'discretion' || value === 'custom'
}

export function isBrowserImportCategory(value: unknown): value is BrowserImportCategory {
  return (BROWSER_IMPORT_CATEGORIES as readonly string[]).includes(value as string)
}

export function isSyncPurpose(value: unknown): value is SyncPurpose {
  return (SYNC_PURPOSES as readonly string[]).includes(value as string)
}
