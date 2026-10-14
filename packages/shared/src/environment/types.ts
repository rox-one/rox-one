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
  // Onboarding «Who are you?» profile (02-SPEC-foundations §2.2, D1).
  'role',
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
  role: 1,
}

export type ModelPlacement = 'local' | 'cloud' | 'mixed'
export type SttChoice = 'local' | 'cloud'
export type TtsChoice = 'edge' | 'local'
export type AgentRuleLabel = 'must' | 'forbid' | 'discretion' | 'custom'

export const BROWSER_IMPORT_CATEGORIES = [
  'bookmarks',
  'history',
  'cookies',
  'credentials',
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

/** Agents / CLIs the user already works with (onboarding «Who are you?»). */
export const WORK_STYLE_AGENTS = [
  'claudeCode',
  'codex',
  'opencode',
  'omp',
  'hermes',
  'openclaw',
  'cursor',
  'geminiCli',
  'antigravity',
  'chatgpt',
  'perplexity',
  'grok',
  'qwen',
  'deepseek',
  'gigachat',
  'zai',
  'kimi',
  'mistral',
  'copilot',
  'windsurf',
  'kiloCode',
  'cline',
  'rooCode',
  'aider',
  'other',
] as const
export type WorkStyleAgent = (typeof WORK_STYLE_AGENTS)[number]

/** Output formats the user prefers to receive. */
export const WORK_STYLE_FORMATS = ['chat', 'markdown', 'docx', 'pdf', 'pptx', 'xlsx', 'office', 'htmlDashboard', 'json', 'docs'] as const
export type WorkStyleFormat = (typeof WORK_STYLE_FORMATS)[number]

export type WorkStyleDetail = 'detailed' | 'concise'
export type WorkStyleLayout = 'prose' | 'bullets'
export type WorkStyleClarify = 'askFirst' | 'autonomous'
export type WorkStyleCollaboration = 'reasonTogether' | 'justDeliver'

/**
 * 0–10 sliders of «Как агенту работать». 0 is the left label, 10 the right:
 * detail Кратко↔Подробно, layout Текстом↔Списками, tone Сдержанно↔Дружелюбно,
 * formality Формально↔Неформально, clarify Сначала уточнить↔Действовать сам,
 * collaboration Рассуждать вместе↔Просто результат. An untouched slider is
 * absent («no preference»).
 */
export const WORK_STYLE_SCALES = ['detail', 'layout', 'tone', 'formality', 'clarify', 'collaboration'] as const
export type WorkStyleScaleKey = (typeof WORK_STYLE_SCALES)[number]
export const WORK_STYLE_SCALE_MAX = 10

/** Free-text «Другое» role: trimmed, at most this many characters. */
export const ONBOARDING_OTHER_ROLE_MAX = 32

/**
 * How the user wants the agent to work. Every field is optional: an absent
 * field means «no preference» and is left out of the agent prompt.
 */
export interface OnboardingWorkStyle {
  agents?: WorkStyleAgent[]
  formats?: WorkStyleFormat[]
  /** The one format to default to; always also listed in `formats`. */
  primaryFormat?: WorkStyleFormat
  /** Slider answers (0–10); supersede the legacy binary fields below. */
  scales?: Partial<Record<WorkStyleScaleKey, number>>
  /** Legacy binary answers (pre-slider profiles). */
  detail?: WorkStyleDetail
  layout?: WorkStyleLayout
  clarify?: WorkStyleClarify
  collaboration?: WorkStyleCollaboration
}

/** Onboarding «Who are you?» profile: the developer flag plus adjacent roles. */
export interface OnboardingRoleProfile {
  isDeveloper: boolean
  relatedRoles: string[]
  /**
   * True only when the user explicitly picked developer / not a developer.
   * `isDeveloper` is false by default, so prompts must not treat it as an
   * answer unless this is set. Absent on older profiles.
   */
  isDeveloperExplicit?: boolean
  /** Free text typed for «Другое» (≤ ONBOARDING_OTHER_ROLE_MAX chars). */
  otherRole?: string
  /** Answer/collaboration preferences that feed the agent's system prompt. */
  workStyle?: OnboardingWorkStyle
}

function pickList<T extends string>(raw: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<T>()
  for (const entry of raw) {
    if ((allowed as readonly unknown[]).includes(entry)) seen.add(entry as T)
  }
  return seen.size > 0 ? allowed.filter((value) => seen.has(value)) : undefined
}

function pickOne<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  return (allowed as readonly unknown[]).includes(raw) ? (raw as T) : undefined
}

/** Keep only known values; returns undefined when nothing meaningful is left. */
export function normalizeWorkStyle(raw: unknown): OnboardingWorkStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const out: OnboardingWorkStyle = {}
  const agents = pickList(obj.agents, WORK_STYLE_AGENTS)
  const formats = pickList(obj.formats, WORK_STYLE_FORMATS)
  const detail = pickOne(obj.detail, ['detailed', 'concise'] as const)
  const layout = pickOne(obj.layout, ['prose', 'bullets'] as const)
  const clarify = pickOne(obj.clarify, ['askFirst', 'autonomous'] as const)
  const collaboration = pickOne(obj.collaboration, ['reasonTogether', 'justDeliver'] as const)
  if (agents) out.agents = agents
  if (formats) out.formats = formats
  const primaryFormat = pickOne(obj.primaryFormat, WORK_STYLE_FORMATS)
  if (primaryFormat && formats?.includes(primaryFormat)) out.primaryFormat = primaryFormat
  if (obj.scales && typeof obj.scales === 'object') {
    const rawScales = obj.scales as Record<string, unknown>
    const scales: Partial<Record<WorkStyleScaleKey, number>> = {}
    for (const key of WORK_STYLE_SCALES) {
      const value = rawScales[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        scales[key] = Math.max(0, Math.min(WORK_STYLE_SCALE_MAX, Math.round(value)))
      }
    }
    if (Object.keys(scales).length > 0) out.scales = scales
  }
  if (detail) out.detail = detail
  if (layout) out.layout = layout
  if (clarify) out.clarify = clarify
  if (collaboration) out.collaboration = collaboration
  return Object.keys(out).length > 0 ? out : undefined
}

/** Trim and cap the «Другое» text; empty → undefined. */
export function normalizeOtherRole(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, ONBOARDING_OTHER_ROLE_MAX).trim()
  return text.length > 0 ? text : undefined
}

/** Role profile with only known fields (drops unknown keys and bad values). */
export function normalizeOnboardingRoleProfile(value: OnboardingRoleProfile): OnboardingRoleProfile {
  const workStyle = normalizeWorkStyle(value.workStyle)
  const otherRole = normalizeOtherRole(value.otherRole)
  return {
    isDeveloper: value.isDeveloper,
    relatedRoles: [...value.relatedRoles],
    ...(value.isDeveloperExplicit === true ? { isDeveloperExplicit: true } : {}),
    ...(otherRole ? { otherRole } : {}),
    ...(workStyle ? { workStyle } : {}),
  }
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
  role: Choice<OnboardingRoleProfile>
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
    // Selection preferences only: cookie and OS credential grants are separate.
    browserImport: { status: 'unanswered', value: [...BROWSER_IMPORT_CATEGORIES] },
    syncPurposes: unanswered(),
    notifications: unanswered(),
    agentRules: [],
    role: unanswered(),
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

export function isOnboardingRoleProfile(value: unknown): value is OnboardingRoleProfile {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return typeof obj.isDeveloper === 'boolean'
    && Array.isArray(obj.relatedRoles)
    && obj.relatedRoles.every((role) => typeof role === 'string')
}

export function isBrowserImportCategory(value: unknown): value is BrowserImportCategory {
  return (BROWSER_IMPORT_CATEGORIES as readonly string[]).includes(value as string)
}

export function isSyncPurpose(value: unknown): value is SyncPurpose {
  return (SYNC_PURPOSES as readonly string[]).includes(value as string)
}
