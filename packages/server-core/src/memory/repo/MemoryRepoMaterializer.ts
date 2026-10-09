/**
 * MemoryRepoMaterializer — pure projection of memory sources into the
 * markdown files of a memory repository (spec §5, contract §3-materializer).
 *
 * No fs, no git, no network, no clock. The same sources always render the same
 * bytes (identical input ⇒ byte-identical output; shuffled input order ⇒ same
 * output), so a materialization of unchanged sources never produces a commit.
 *
 * `opts.generatedAt` is accepted for interface symmetry with the single writer
 * but is deliberately NOT embedded in any file: a fresh materialization
 * timestamp would change every render and defeat the no-churn invariant
 * (spec §5). The rendering is fully determined by `bundle` alone.
 *
 * Telemetry fields (`usageCount`, `lastUsedAt`, `conflicts`, ...) are never
 * written into repo files — the screen reads them from the stores (spec §2.5).
 */
import { createHash } from 'crypto'

/** One lesson as projected into the repo; telemetry is already stripped. */
export interface RepoSourceLesson {
  lessonKey: string
  rule: string
  category: string
  negative: boolean
  pinned: boolean
  disabled: boolean
  tags: string[]
  /** ISO-8601 timestamp of the lesson. */
  createdAt: string
  updatedAt?: string
  source?: {
    trigger?: string
    sessionId?: string
    proposalId?: string
    consent?: string
  }
}

/** The complete set of sources for one bank. */
export interface RepoSourceBundle {
  bankId: string
  scope: 'main' | 'workspace'
  workspaceName?: string
  lessons: RepoSourceLesson[]
  context: string | null
  preferences: string | null
  history: Array<{ date: string; content: string }>
}

export interface RenderedRepoFile {
  path: string
  content: string
  kind: 'memory' | 'profile' | 'lesson' | 'history' | 'readme' | 'gitignore'
  lessonKey?: string
  lessonId?: string
  ruleHash?: string
}

/** How long a lesson slug may be. */
const SLUG_MAX = 60

/** ISO-8601 UTC marker of when the bank was materialized; unused by design. */
export interface RenderOpts {
  generatedAt: string
}

/**
 * sha1 hex of the canonical rule text: NFKC-normalized and trimmed. Used as the
 * `baseHash` of a lesson so a human edit of the rule is detectable on import.
 */
export function ruleHash(rule: string): string {
  return sha1Hex(rule.normalize('NFKC').trim())
}

/**
 * Lowercase ASCII slug for a rule: Cyrillic is transliterated, every run of
 * non-alphanumerics collapses to a single dash, leading/trailing dashes are
 * trimmed, the result is capped at {@link SLUG_MAX} and falls back to `rule`.
 */
export function lessonSlug(rule: string): string {
  return slugify(rule, 'rule')
}

/**
 * Stable file id of a lesson. Lessons that came from an approved proposal keep
 * their proposal id (`p:<id>`); all others use the scope-scoped hash of the
 * normalized lesson key.
 */
export function lessonFileId(bundle: RepoSourceBundle, lesson: RepoSourceLesson): string {
  const proposalId = lesson.source?.proposalId
  if (proposalId) return `p:${proposalId}`
  return `${bundle.scope}:${sha1Hex(lesson.lessonKey).slice(0, 10)}`
}

/**
 * Render every repo file for a bank, sorted by path. `opts.generatedAt` is
 * accepted but not embedded — see the module docblock.
 */
export function renderRepoFiles(bundle: RepoSourceBundle, opts: RenderOpts): RenderedRepoFile[] {
  void opts // intentionally not rendered; keeps unchanged sources byte-identical
  const lessons = sortLessons(bundle)

  const files: RenderedRepoFile[] = []
  files.push({ path: 'MEMORY.md', content: renderMemory(bundle, lessons), kind: 'memory' })

  // PROFILE.md carries global preferences and exists in the `main` bank only.
  if (bundle.scope === 'main') {
    files.push({ path: 'PROFILE.md', content: renderProfile(bundle), kind: 'profile' })
  }

  for (const lesson of lessons) {
    const fileId = lessonFileId(bundle, lesson)
    files.push({
      path: lessonPath(lesson, fileId),
      content: renderLesson(bundle, lesson, fileId),
      kind: 'lesson',
      lessonKey: lesson.lessonKey,
      lessonId: fileId,
      ruleHash: ruleHash(lesson.rule),
    })
  }

  // Daily history files are byte-for-byte copies of the source content.
  for (const entry of bundle.history) {
    files.push({ path: `history/${entry.date}.md`, content: entry.content, kind: 'history' })
  }

  files.push({ path: 'README.md', content: README_CONTENT, kind: 'readme' })
  files.push({ path: '.gitignore', content: GITIGNORE_CONTENT, kind: 'gitignore' })

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return files
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/** Lessons sorted by (ts, id) with a stable tiebreak, so the order is input-independent. */
function sortLessons(bundle: RepoSourceBundle): RepoSourceLesson[] {
  return [...bundle.lessons].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
    const ia = lessonFileId(bundle, a)
    const ib = lessonFileId(bundle, b)
    if (ia !== ib) return ia < ib ? -1 : 1
    const ha = ruleHash(a.rule)
    const hb = ruleHash(b.rule)
    if (ha !== hb) return ha < hb ? -1 : 1
    return a.lessonKey < b.lessonKey ? -1 : a.lessonKey > b.lessonKey ? 1 : 0
  })
}

function renderMemory(bundle: RepoSourceBundle, lessons: RepoSourceLesson[]): string {
  const head: string[] = ['---', `bank: ${bundle.bankId}`, `scope: ${bundle.scope}`]
  if (bundle.scope === 'workspace' && bundle.workspaceName) {
    head.push(`workspace: ${bundle.workspaceName}`)
  }
  head.push(`lessons: ${lessons.length}`, '---')

  const context = bundle.context ?? ''
  const profile = bundle.scope === 'main' ? '\n\n## Профиль → [[PROFILE.md]]' : ''
  const rules = `\n\n## Правила (${lessons.length})\n` + lessons.map(lesson => renderRuleLine(bundle, lesson)).join('\n')

  return `${head.join('\n')}\n\n## Контекст\n\n${context}${profile}${rules}\n`
}

/** One `- <rule> → [[lessons/...]]` line, flagging negative and disabled rules. */
function renderRuleLine(bundle: RepoSourceBundle, lesson: RepoSourceLesson): string {
  const link = lessonPath(lesson, lessonFileId(bundle, lesson)).replace(/\.md$/, '')
  const rule = lesson.rule.replace(/\s+/g, ' ').trim()
  const flags: string[] = []
  if (lesson.negative) flags.push('negative')
  if (lesson.disabled) flags.push('disabled')
  const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : ''
  return `- ${rule} → [[${link}]]${suffix}`
}

function renderLesson(bundle: RepoSourceBundle, lesson: RepoSourceLesson, fileId: string): string {
  const lines: string[] = ['---']
  lines.push(`id: ${fileId}`)
  lines.push(`scope: ${bundle.scope}`)
  lines.push(`category: ${lesson.category}`)
  lines.push(`negative: ${lesson.negative}`)
  lines.push(`pinned: ${lesson.pinned}`)
  lines.push(`disabled: ${lesson.disabled}`)
  lines.push(lesson.tags.length > 0 ? `tags: ${lesson.tags.join(', ')}` : 'tags:')
  lines.push(`ts: ${lesson.createdAt}`)
  const source = lesson.source
  if (source?.trigger) lines.push(`source.trigger: ${source.trigger}`)
  if (source?.sessionId) lines.push(`source.session: ${source.sessionId}`)
  if (source?.proposalId) lines.push(`source.proposal: ${source.proposalId}`)
  if (source?.consent) lines.push(`source.consent: ${source.consent}`)
  lines.push(`baseHash: ${ruleHash(lesson.rule)}`)
  lines.push('---')

  const body = lesson.rule.replace(/\s+$/, '')
  return `${lines.join('\n')}\n\n${body}\n`
}

function renderProfile(bundle: RepoSourceBundle): string {
  const head = ['---', `bank: ${bundle.bankId}`, 'scope: main', '---'].join('\n')
  const content = `${head}\n\n${bundle.preferences ?? ''}`
  return content.endsWith('\n') ? content : `${content}\n`
}

// ---------------------------------------------------------------------------
// paths and slugs
// ---------------------------------------------------------------------------

function lessonPath(lesson: RepoSourceLesson, fileId: string): string {
  const category = slugify(lesson.category, 'other')
  const slug = lessonSlug(lesson.rule)
  return `lessons/${category}/${slug}--${lessonId8(fileId)}.md`
}

/**
 * Short, path-safe tail of a lesson file id, used to disambiguate identical
 * slugs. Non-alphanumerics (e.g. the `:` of the `p:` form) are dropped so the
 * name stays valid on Windows; an all-symbol tail falls back to a hash.
 */
function lessonId8(fileId: string): string {
  const tail = fileId.slice(-8).replace(/[^A-Za-z0-9]/g, '')
  return tail.length > 0 ? tail : sha1Hex(fileId).slice(0, 8)
}

/** Lowercase ASCII slug with Cyrillic transliteration; `fallback` when empty. */
function slugify(text: string, fallback: string): string {
  let out = ''
  for (const ch of text.normalize('NFKC').toLowerCase()) {
    const mapped = CYRILLIC[ch]
    out += mapped === undefined ? ch : mapped
  }
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (out.length > SLUG_MAX) out = out.slice(0, SLUG_MAX).replace(/-+$/g, '')
  return out.length > 0 ? out : fallback
}

/** Lowercase Cyrillic → ASCII (RU plus the common Ukrainian/Belarusian letters). */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
}

function sha1Hex(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------

const README_CONTENT = `# Память Rox — репозиторий

Этот репозиторий — детерминированная проекция памяти Rox. Источник истины —
хранилища памяти Rox; файлы здесь существуют для чтения, истории, диффов и
экспорта.

## Правила правок

- Правки в этом каталоге не перезаписываются молча.
- Если файл изменён вручную, материализатор сохранит копию в \`.conflicts/<ts>/\`,
  помечает файл как \`edited\` и приостанавливает его проекцию до импорта правок
  или явного отката.
- Правки возвращаются в память только через предложения памяти (approval).

## Машинные зоны

Не редактируйте текст между маркерами \`rox:auto\` — его перезаписывает
материализатор:

<!-- rox:auto:start -->
Управляется автоматически.
<!-- rox:auto:end -->

## Файлы

- \`MEMORY.md\` — визитка банка: контекст и правила.
- \`PROFILE.md\` — профиль (только банк \`main\`).
- \`lessons/<category>/<slug>--<id8>.md\` — один урок.
- \`history/YYYY-MM-DD.md\` — дневная история (побайтовая копия).
- \`DREAMS.md\` — сводки снов (создаётся сном, не материализатором).
`

const GITIGNORE_CONTENT = `.snapshots/
*.tmp
.conflicts/
.meta.json
`