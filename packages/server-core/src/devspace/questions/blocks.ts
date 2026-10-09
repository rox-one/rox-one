/**
 * Dev Space question-block generator (03-SPEC-features §3, D8).
 *
 * Deterministic, offline template generator: exactly ten questions per block
 * (`learn` / `features` / `security`), each carrying a transparent
 * «почему этот вопрос» (§3.2) built from the onboarding profile (D1), the
 * repository context (status/snapshot/size) and the read-only working signals
 * (uncommitted working copy, CI presence). No network, no model, no filesystem:
 * the caller (the `devSpace:generateQuestions` handler) supplies the context, so
 * the same inputs always yield the byte-identical blocks (idempotency).
 *
 * Every question also references the artifact/topic it was generated from
 * (§3.1: symbols/wiki/learning/source-graph/sbom/cve/…). Recalculation happens
 * only on an explicit command (O8); the handler is that command.
 */
import type {
  DevSpaceManifestEntryKind, DevSpaceQuestion, DevSpaceQuestionBlock, DevSpaceQuestionBlockName,
  DevSpaceQuestionWhy, DevSpaceRepositoryStatus,
} from '@rox/shared/dev-space'
import { DEV_SPACE_QUESTIONS_PER_BLOCK } from '@rox/shared/dev-space'

/** Fixed block identity and order (§3.1). */
export const DEV_SPACE_QUESTION_BLOCK_NAMES: readonly DevSpaceQuestionBlockName[] = ['learn', 'features', 'security']

/** Quota per block (D8) — re-exported from the shared contract so it cannot drift. */
export { DEV_SPACE_QUESTIONS_PER_BLOCK }

/** Onboarding role/profile input (§2.2, `EnvironmentPrefs.role`). */
export interface DevSpaceQuestionProfile {
  readonly answered: boolean
  readonly isDeveloper: boolean | null
  readonly relatedRoles: readonly string[]
}

/** Repository context input: catalog status, snapshot and size (§3.2). */
export interface DevSpaceQuestionRepo {
  readonly status: DevSpaceRepositoryStatus
  readonly snapshotId: string | null
  /** From the code-intelligence snapshot; `null` when the snapshot is not loadable. */
  readonly dirty: boolean | null
  readonly fileCount: number | null
  readonly totalBytes: number | null
}

/** Read-only working signals (§3.2): CI presence is best-effort from `.github/workflows`. */
export interface DevSpaceQuestionSignals {
  readonly ci: boolean | null
  readonly ciWorkflows: number | null
}

/** Security scan outcome folded into block 3 (§3.4). */
export interface DevSpaceQuestionSecurity {
  readonly sbomAvailable: boolean
  readonly cveChecked: boolean
}

/** The complete, serialisable input to the generator. */
export interface DevSpaceQuestionContext {
  readonly profile: DevSpaceQuestionProfile
  readonly repo: DevSpaceQuestionRepo
  readonly signals: DevSpaceQuestionSignals
  readonly security: DevSpaceQuestionSecurity
}

interface QuestionTemplate {
  readonly topic: string
  readonly source: { readonly kind: DevSpaceManifestEntryKind; readonly ref: string }
  readonly text: (context: DevSpaceQuestionContext) => string
  readonly why: (context: DevSpaceQuestionContext) => DevSpaceQuestionWhy
}

// ---------------------------------------------------------------------------
// «Почему» builders — each field appears only when its input actually drove the
// question, so the UI can show exactly which inputs contributed (§3.2).
// ---------------------------------------------------------------------------

/** Human-readable role label from the onboarding answer; `null` when unanswered. */
export function roleLabel(profile: DevSpaceQuestionProfile): string | null {
  if (!profile.answered) return null
  const base = profile.isDeveloper ? 'разработчик' : 'не разработчик'
  const related = profile.relatedRoles.length > 0 ? ` (${profile.relatedRoles.join(', ')})` : ''
  return `${base}${related}`
}

function profileWhy(context: DevSpaceQuestionContext): DevSpaceQuestionWhy {
  const label = roleLabel(context.profile)
  return label ? { profile: `онбординг-профиль: ${label}` } : {}
}

function shortSnapshot(snapshotId: string | null): string | null {
  if (!snapshotId) return null
  return snapshotId.length > 17 ? `${snapshotId.slice(0, 17)}…` : snapshotId
}

/** `1.5 МБ` style size, rounded to one decimal. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(1)} КБ`
  return `${(kib / 1024).toFixed(1)} МБ`
}

function repoWhy(context: DevSpaceQuestionContext): DevSpaceQuestionWhy {
  const parts = [`статус ${context.repo.status}`]
  const snapshot = shortSnapshot(context.repo.snapshotId)
  if (snapshot) parts.push(`снапшот ${snapshot}`)
  if (context.repo.fileCount !== null) parts.push(`${context.repo.fileCount} файлов`)
  if (context.repo.totalBytes !== null) parts.push(formatBytes(context.repo.totalBytes))
  return { repo: `репо-контекст: ${parts.join(', ')}` }
}

function signalsWhy(context: DevSpaceQuestionContext): DevSpaceQuestionWhy {
  const parts: string[] = []
  if (context.repo.dirty === true) parts.push('незакоммиченные изменения в рабочем дереве')
  else if (context.repo.dirty === false) parts.push('рабочее дерево чистое')
  if (context.signals.ci === true) {
    parts.push(context.signals.ciWorkflows !== null
      ? `CI: ${context.signals.ciWorkflows} workflow в .github/workflows`
      : 'CI: .github/workflows присутствует')
  } else if (context.signals.ci === false) parts.push('CI не настроен (.github/workflows отсутствует)')
  return parts.length > 0 ? { signals: `рабочие сигналы: ${parts.join('; ')}` } : {}
}

/** Merge non-empty why fragments left-to-right; a template picks what applies. */
function why(...fragments: readonly DevSpaceQuestionWhy[]): DevSpaceQuestionWhy {
  const merged: { profile?: string; repo?: string; signals?: string } = {}
  for (const fragment of fragments) {
    if (fragment.profile) merged.profile = fragment.profile
    if (fragment.repo) merged.repo = fragment.repo
    if (fragment.signals) merged.signals = fragment.signals
  }
  return merged
}

// ---------------------------------------------------------------------------
// Templates — exactly ten per block.
// ---------------------------------------------------------------------------

const LEARN_TEMPLATES: readonly QuestionTemplate[] = [
  {
    topic: 'entrypoints', source: { kind: 'code-graph', ref: 'symbols' },
    text: () => 'С каких точек входа начинать чтение репозитория?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'core-modules', source: { kind: 'code-graph', ref: 'symbols' },
    text: () => 'Какие модули образуют ядро системы и за что отвечают?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'architecture', source: { kind: 'wiki', ref: 'repo-wiki' },
    text: () => 'Как связаны ключевые подсистемы и в каком направлении идут зависимости?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'conventions', source: { kind: 'wiki', ref: 'repo-wiki' },
    text: () => 'Какие соглашения о структуре папок и именовании здесь приняты?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'getting-started', source: { kind: 'wiki', ref: 'repo-wiki' },
    text: () => 'Как собрать и запустить проект локально?',
    why: context => why(signalsWhy(context)),
  },
  {
    topic: 'data-flow', source: { kind: 'understanding', ref: 'learning' },
    text: () => 'Как данные проходят между слоями от входа до хранилища?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'testing', source: { kind: 'wiki', ref: 'repo-wiki' },
    text: () => 'Какие тесты покрывают поведение и как их запускать?',
    why: context => why(signalsWhy(context)),
  },
  {
    topic: 'domains', source: { kind: 'understanding', ref: 'learning' },
    text: () => 'Какие доменные понятия определяют предметную область проекта?',
    why: context => why(profileWhy(context), repoWhy(context)),
  },
  {
    topic: 'change-safety', source: { kind: 'wiki', ref: 'repo-wiki' },
    text: () => 'Что нужно знать перед первым изменением, чтобы ничего не сломать?',
    why: context => why(signalsWhy(context)),
  },
  {
    topic: 'onboarding-path', source: { kind: 'understanding', ref: 'learning' },
    text: () => 'Какой маршрут изучения выбрать под мою роль?',
    why: context => why(profileWhy(context), signalsWhy(context)),
  },
]

const FEATURES_TEMPLATES: readonly QuestionTemplate[] = [
  {
    topic: 'extension-points', source: { kind: 'code-graph', ref: 'source-graph' },
    text: () => 'Где точки расширения, через которые добавлять новые фичи?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'coupling', source: { kind: 'knowledge-graph', ref: 'inferred' },
    text: () => 'Какие модули связаны сильнее всего и где из-за этого риск изменений?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'callers', source: { kind: 'code-graph', ref: 'callers' },
    text: () => 'Кто вызывает публичные API и что затронет их изменение?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'reduce-deps', source: { kind: 'knowledge-graph', ref: 'inferred' },
    text: () => 'Какие зависимости можно сократить или заменить?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'inferred-nodes', source: { kind: 'knowledge-graph', ref: 'inferred' },
    text: () => 'Какие связи помечены как предположение и требуют проверки по коду?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'duplication', source: { kind: 'code-graph', ref: 'callees' },
    text: () => 'Где дублирование или неиспользуемый код, который стоит убрать?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'blast-radius', source: { kind: 'code-graph', ref: 'source-graph' },
    text: () => 'Какие изменения затронут больше всего файлов?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'quick-wins', source: { kind: 'code-graph', ref: 'source-graph' },
    text: () => 'Какую фичу проще всего добавить уже сейчас?',
    why: context => why(profileWhy(context), signalsWhy(context)),
  },
  {
    topic: 'doc-gaps', source: { kind: 'wiki', ref: 'repo-wiki' },
    text: () => 'Какие важные части системы не покрыты документацией?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'wip-hygiene', source: { kind: 'code-graph', ref: 'source-graph' },
    text: () => 'Что делать с незакоммиченными изменениями перед новой работой?',
    why: context => why(signalsWhy(context)),
  },
]

const SECURITY_TEMPLATES: readonly QuestionTemplate[] = [
  {
    topic: 'dependencies', source: { kind: 'sbom-cve', ref: 'sbom' },
    text: () => 'Какие зависимости стоит обновить в первую очередь?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'cves', source: { kind: 'sbom-cve', ref: 'cve' },
    text: () => 'Есть ли у зависимостей известные уязвимости (CVE)?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'heaviest-packages', source: { kind: 'sbom-cve', ref: 'sbom' },
    text: () => 'Какие пакеты самые тяжёлые и нужны ли они все?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'licenses', source: { kind: 'sbom-cve', ref: 'sbom' },
    text: () => 'Есть ли зависимости с несовместимыми или отсутствующими лицензиями?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'duplicate-deps', source: { kind: 'sbom-cve', ref: 'sbom' },
    text: () => 'Какие пакеты одного назначения дублируются?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'unsafe-calls', source: { kind: 'code-graph', ref: 'exec' },
    text: () => 'Какие сетевые или исполняемые вызовы в коде требуют ревью?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'cve-coverage', source: { kind: 'sbom-cve', ref: 'cve' },
    text: () => 'Полна ли текущая CVE-проверка и что мешает её расширить?',
    why: context => why(securityWhy(context)),
  },
  {
    topic: 'performance', source: { kind: 'diagram', ref: 'performance' },
    text: () => 'Какие узкие места производительности видны из графа зависимостей?',
    why: context => why(repoWhy(context)),
  },
  {
    topic: 'ci-hardening', source: { kind: 'diagram', ref: 'dependencies' },
    text: () => 'Что проверяет CI и как усилить его защитные шаги?',
    why: context => why(signalsWhy(context), securityWhy(context)),
  },
  {
    topic: 'build-reliability', source: { kind: 'sbom-cve', ref: 'sbom' },
    text: () => 'Что изменить, чтобы сборка и проверки стали надёжнее?',
    why: context => why(signalsWhy(context), securityWhy(context)),
  },
]

/** Security availability folded into a why fragment (§3.4). */
function securityWhy(context: DevSpaceQuestionContext): DevSpaceQuestionWhy {
  const parts = [`SBOM: ${context.security.sbomAvailable ? 'доступен' : 'недоступен (syft не найден)'}`]
  parts.push(context.security.cveChecked ? 'CVE-проверка выполнена' : 'CVE-проверка пропущена (нет согласия на сеть)')
  return { signals: `безопасность: ${parts.join('; ')}` }
}

const BLOCK_TEMPLATES: Readonly<Record<DevSpaceQuestionBlockName, readonly QuestionTemplate[]>> = {
  learn: LEARN_TEMPLATES,
  features: FEATURES_TEMPLATES,
  security: SECURITY_TEMPLATES,
}

const BLOCK_TITLES: Readonly<Record<DevSpaceQuestionBlockName, string>> = {
  learn: 'Обучение',
  features: 'Фичи и улучшения',
  security: 'Безопасность, зависимости, производительность',
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Stable, collision-free question id: `qst_<block>_<nn>`. */
function questionId(block: DevSpaceQuestionBlockName, index: number): string {
  return `qst_${block}_${String(index + 1).padStart(2, '0')}`
}

/**
 * Generate the three blocks. Pure and deterministic: no I/O, no clock, no random
 * — the caller stamps provenance. Always exactly `DEV_SPACE_QUESTIONS_PER_BLOCK`
 * questions per block, in the fixed block order of §3.1.
 */
export function generateQuestionBlocks(context: DevSpaceQuestionContext): readonly DevSpaceQuestionBlock[] {
  return DEV_SPACE_QUESTION_BLOCK_NAMES.map(block => {
    const templates = BLOCK_TEMPLATES[block]
    const questions: DevSpaceQuestion[] = templates.slice(0, DEV_SPACE_QUESTIONS_PER_BLOCK).map((template, index) => ({
      id: questionId(block, index),
      block,
      text: template.text(context),
      // Repository context always exists (at least the catalog status), so every
      // question carries at least one transparent «почему» fragment (§3.2).
      why: why(repoWhy(context), template.why(context)),
      source: template.source,
    }))
    return { block, title: BLOCK_TITLES[block], questions }
  })
}