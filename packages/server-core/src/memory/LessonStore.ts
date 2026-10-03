/**
 * LessonStore — manages one lessons.jsonl file for a single scope
 * ('global' or 'workspace').
 *
 * - Append-only writes for new lessons, full atomic rewrite (tmp + rename)
 *   for updates/deletes.
 * - Case-insensitive dedup on the rule text (lowercase + trim): a duplicate
 *   updates ts/source of the existing lesson in place.
 * - Enforces LESSON_LIMITS.total by pruning the oldest lessons after writes.
 * - Schema v2 (spec F1): usage metadata via touchUsed, conflict feedback via
 *   recordConflict, distillation lessons marked generated.
 * - Every mutation also appends to the scope's audit.jsonl via the internal
 *   AuditLog (spec F2); callers pass just their actor (default 'rpc').
 * - list() reads are mtime-cached: the file is re-parsed only when its mtime
 *   changed (another process appended to it, tests wrote to it, ...).
 * - Corrupt lines are skipped, never thrown.
 *
 * See docs/superpowers/specs/2026-08-06-self-learning-memory-design.md §1.
 */
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { selectContextLessons } from '@rox/shared/memory/context-select'
import { LESSON_LIMITS, type AuditActor, type Lesson, type LessonConflict, type LessonOwner, type LessonScope } from '@rox/shared/memory/types'
import { AuditLog, type AuditInput } from './AuditLog'
import { removeLesson as ftsRemoveLesson, upsertLesson as ftsUpsertLesson } from './fts-index'


/** Normalized dedup key for a lesson rule (case-insensitive, whitespace-trimmed). */
export function lessonKey(rule: string): string {
  return rule.trim().toLowerCase()
}

/** Missing owner denotes legacy machine-private data. */
export function lessonOwnerKey(owner?: LessonOwner): string {
  return owner ? `${owner.issuer}\u0000${owner.subject}` : ''
}


/**
 * Drop malformed schema-v2 fields (wrong types) while preserving everything
 * else verbatim — unknown keys from newer writers must round-trip untouched.
 */
function normalizeLesson(lesson: Lesson): Lesson {
  if (lesson.owner !== undefined && (
    !lesson.owner ||
    typeof lesson.owner.issuer !== 'string' ||
    lesson.owner.issuer.length === 0 ||
    typeof lesson.owner.subject !== 'string' ||
    lesson.owner.subject.length === 0
  )) delete lesson.owner
  if (lesson.mergedInto !== undefined && typeof lesson.mergedInto !== 'string') delete lesson.mergedInto
  if (lesson.mergeHistory !== undefined) {
    const history = lesson.mergeHistory
    if (
      !history ||
      history.version !== 1 ||
      !Array.isArray(history.lessons) ||
      history.lessons.length > LESSON_LIMITS.total ||
      history.lessons.some(saved => !saved || typeof saved.rule !== 'string' || (saved.scope !== 'global' && saved.scope !== 'workspace'))
    ) {
      delete lesson.mergeHistory
    } else {
      history.lessons = history.lessons.map(saved => {
        const { mergeHistory: _nested, ...original } = saved
        return original
      })
    }
  }
  if (lesson.usageCount !== undefined && (typeof lesson.usageCount !== 'number' || !Number.isFinite(lesson.usageCount) || lesson.usageCount < 0)) {
    delete lesson.usageCount
  }
  if (lesson.lastUsedAt !== undefined && typeof lesson.lastUsedAt !== 'string') delete lesson.lastUsedAt
  if (lesson.generated !== undefined && typeof lesson.generated !== 'boolean') delete lesson.generated
  if (lesson.conflicts !== undefined) {
    lesson.conflicts = Array.isArray(lesson.conflicts)
      ? lesson.conflicts
          .filter(c => c && typeof c.sessionId === 'string' && typeof c.ts === 'string' && (c.reason === 'branch' || c.reason === 'interrupted' || c.reason === 'error'))
          .slice(-LESSON_LIMITS.conflicts)
      : undefined
  }
  if (lesson.pinned !== undefined && typeof lesson.pinned !== 'boolean') delete lesson.pinned
  if (lesson.disabled !== undefined && typeof lesson.disabled !== 'boolean') delete lesson.disabled
  if (lesson.editedAt !== undefined && typeof lesson.editedAt !== 'string') delete lesson.editedAt
  if (lesson.tags !== undefined) {
    if (Array.isArray(lesson.tags)) lesson.tags = lesson.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    else delete lesson.tags
  }
  if (lesson.mergedFrom !== undefined) {
    if (Array.isArray(lesson.mergedFrom)) lesson.mergedFrom = lesson.mergedFrom.filter((rule): rule is string => typeof rule === 'string')
    else delete lesson.mergedFrom
  }
  if (lesson.usedAt !== undefined) {
    if (Array.isArray(lesson.usedAt)) lesson.usedAt = lesson.usedAt.filter((ts): ts is string => typeof ts === 'string').slice(-LESSON_LIMITS.usedAt)
    else delete lesson.usedAt
  }
  if (lesson.promoted !== undefined) {
    const p = lesson.promoted
    if (!p || p.fromScope !== 'workspace' || !Array.isArray(p.workspaceIds) || typeof p.ts !== 'string') delete lesson.promoted
  }
  return lesson
}

/**
 * Parse a lessons.jsonl payload resiliently. Blank lines are ignored and any
 * line that fails JSON.parse or doesn't look like a lesson is skipped — a
 * store must never fail to load because one line is corrupt.
 */
export function parseLessons(content: string): Lesson[] {
  const lessons: Lesson[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Lesson
      if (parsed && typeof parsed === 'object' && typeof parsed.rule === 'string') {
        lessons.push(normalizeLesson(parsed))
      }
    } catch {
      // skip corrupt line
    }
  }
  return lessons
}

/** Snapshots of lessons.jsonl kept in memory/backups/. */
export const LESSON_BACKUPS_KEPT = 30
const backedUp = new Set<string>()
/** Test hook: forget which files were snapshotted this process. */
export function resetLessonBackupsForTests(): void {
  backedUp.clear()
}

export class LessonStore {
  readonly filePath: string
  readonly scope: LessonScope
  /** Scope's audit log (audit.jsonl next to lessons.jsonl) — wired internally, callers pass nothing. */
  readonly auditLog: AuditLog
  /** Cached lessons, keyed by file mtime. */
  private cache: { mtimeMs: number; lessons: Lesson[] } | null = null

  constructor(filePath: string, scope: LessonScope) {
    this.filePath = filePath
    this.scope = scope
    this.auditLog = AuditLog.inDir(dirname(filePath), scope)
  }

  /** All lessons, oldest first. `limit` returns the most recent N. */
  list(limit?: number): Lesson[] {
    const lessons = this.read()
    if (limit === undefined) return lessons
    return lessons.slice(-limit)
  }

  /** Read only one authenticated personal owner or unowned machine-private lessons. */
  listForOwner(owner?: LessonOwner): Lesson[] {
    const ownerKey = lessonOwnerKey(owner)
    return this.list().filter((lesson) => lessonOwnerKey(lesson.owner) === ownerKey)
  }

  listArchivedForOwner(owner?: LessonOwner): Array<{ id: string; lesson: Lesson }> {
    this.recoverPendingArchive()
    const archivePath = join(dirname(this.filePath), 'lessons.archive.jsonl')
    if (!existsSync(archivePath)) return []
    const ownerKey = lessonOwnerKey(owner)
    return readFileSync(archivePath, 'utf8').split('\n').flatMap((line, index) => {
      if (!line.trim()) return []
      const lesson = parseLessons(line)[0]
      if (!lesson || lessonOwnerKey(lesson.owner) !== ownerKey) return []
      const id = createHash('sha256').update(`${index}\0${line}`).digest('hex')
      return [{ id, lesson }]
    })
  }

  restoreArchivedForOwner(owner: LessonOwner | undefined, archiveId: string): Lesson | null {
    const archived = this.listArchivedForOwner(owner).find(entry => entry.id === archiveId)
    if (!archived) return null
    const current = this.listForOwner(owner).find(lesson => lessonKey(lesson.rule) === lessonKey(archived.lesson.rule))
    if (current) return null
    const { archiveTransactionId: _transaction, ...lesson } = archived.lesson as Lesson & { archiveTransactionId?: string }
    return this.add({ ...lesson, ...(owner ? { owner } : { owner: undefined }) }, 'user')
  }


  /** Replace one owner's lessons atomically without touching another owner's rows. */
  replaceForOwner(owner: LessonOwner | undefined, replacement: Lesson[], actor: AuditActor = 'rpc'): void {
    const ownerKey = lessonOwnerKey(owner)
    const current = this.read()
    const previous = current.filter(lesson => lessonOwnerKey(lesson.owner) === ownerKey)
    const retained = current.filter(lesson => lessonOwnerKey(lesson.owner) !== ownerKey)
    const next = replacement.map(lesson => ({
      ...lesson,
      ...(owner ? { owner } : { owner: undefined }),
    }))
    this.rewrite([...retained, ...next])
    for (const lesson of previous) this.unindexed(lesson.rule)
    for (const lesson of next) this.indexed(lesson)
    this.auditWrite({ actor, action: 'update', target: this.filePath, detail: `owner-scoped replacement (${next.length} lessons)` })
  }

  /**
   * Add a lesson. If a lesson with the same rule (case-insensitive) exists,
   * its ts and source are updated instead (and it moves to the end).
   * Enforces LESSON_LIMITS.total by pruning the oldest lessons.
   * Schema v2: lessons whose source trigger is anything but 'explicit'
   * (distillation, branch, interrupted, error) are marked `generated: true`.
   * Returns the stored lesson.
   */
  add(lesson: Lesson, actor: AuditActor = 'rpc'): Lesson {
    const lessons = this.read()
    const entry: Lesson = lesson.source.trigger === 'explicit' ? lesson : { ...lesson, generated: true }
    const key = lessonKey(entry.rule)
    const existingIdx = lessons.findIndex(l => lessonKey(l.rule) === key && lessonOwnerKey(l.owner) === lessonOwnerKey(entry.owner))
    if (existingIdx >= 0) {
      const existing = lessons[existingIdx]
      lessons.splice(existingIdx, 1)
      lessons.push({ ...existing, ts: entry.ts, source: entry.source, ...(entry.generated !== undefined ? { generated: entry.generated } : {}) })
      this.rewrite(lessons)
      this.auditWrite({ actor, action: 'add', target: entry.rule, detail: entry.source.trigger })
      return this.indexed(lessons[lessons.length - 1])
    }
    // Append-only fast path when we're under the limit.
    if (lessons.length < LESSON_LIMITS.total) {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(entry) + '\n', { flag: 'a' })
      this.cache = this.cache
        ? { mtimeMs: this.mtime(), lessons: [...lessons, entry] }
        : null
      this.auditWrite({ actor, action: 'add', target: entry.rule, detail: entry.source.trigger })
      return this.indexed(entry)
    }
    lessons.push(entry)
    this.rewrite(lessons)
    this.auditWrite({ actor, action: 'add', target: entry.rule, detail: entry.source.trigger })
    return this.indexed(entry)
  }

  /**
   * Patch a lesson identified by rule text (case-insensitive) or by index.
   * Audited as 'promote' when the patch carries a `promoted` marker, else
   * 'update'. Returns the patched lesson, or null when no lesson matches.
   */
  update(match: string | number, patch: Partial<Omit<Lesson, 'scope'>>, actor: AuditActor = 'rpc', owner?: LessonOwner): Lesson | null {
    const lessons = this.read()
    const idx = this.resolveIndex(lessons, match, owner)
    if (idx < 0 || lessonOwnerKey(lessons[idx].owner) !== lessonOwnerKey(owner)) return null
    const target = lessons[idx].rule
    const safePatch = { ...patch }
    delete safePatch.owner
    lessons[idx] = { ...lessons[idx], ...safePatch }
    this.rewrite(lessons)
    this.auditWrite({ actor, action: patch.promoted ? 'promote' : 'update', target, detail: Object.keys(patch).join(',') })
    // M1 FTS: the patch may have renamed the rule — drop the stale key first.
    if (lessonKey(lessons[idx].rule) !== lessonKey(target)) this.unindexed(target)
    return this.indexed(lessons[idx])
  }

  /**
   * Delete a lesson identified by rule text (case-insensitive) or by index.
   * Returns true when a lesson was removed.
   */
  delete(match: string | number, actor: AuditActor = 'rpc', owner?: LessonOwner): boolean {
    const lessons = this.read()
    const idx = this.resolveIndex(lessons, match, owner)
    if (idx < 0 || lessonOwnerKey(lessons[idx].owner) !== lessonOwnerKey(owner)) return false
    const target = lessons[idx].rule
    lessons.splice(idx, 1)
    this.rewrite(lessons)
    this.auditWrite({ actor, action: 'delete', target })
    this.unindexed(target)
    return true
  }

  /**
   * Mark the given lessons (by rule text, case-insensitive) as included in an
   * assembled prompt: usageCount++, lastUsedAt = now. Atomic rewrite.
   * Returns the number of lessons updated. Not audited — prompt assembly runs
   * per turn and would drown every real mutation in the log.
   */
  touchUsed(rules: string[], owner?: LessonOwner): number {
    if (rules.length === 0) return 0
    const keys = new Set(rules.map(lessonKey))
    const lessons = this.read()
    const now = new Date().toISOString()
    let touched = 0
    for (let i = 0; i < lessons.length; i++) {
      if (!keys.has(lessonKey(lessons[i].rule)) || lessonOwnerKey(lessons[i].owner) !== lessonOwnerKey(owner)) continue
      lessons[i] = {
        ...lessons[i],
        usageCount: (lessons[i].usageCount ?? 0) + 1,
        lastUsedAt: now,
        usedAt: [...(lessons[i].usedAt ?? []), now].slice(-LESSON_LIMITS.usedAt),
      }
      touched++
    }
    if (touched > 0) this.rewrite(lessons)
    return touched
  }

  /**
   * Record a violation of a lesson (feedback loop, spec F1/L1). The event is
   * appended to lesson.conflicts, capped at the most recent
   * LESSON_LIMITS.conflicts. Atomic rewrite. Returns the patched lesson, or
   * null when no lesson matches the rule text (case-insensitive).
   */
  recordConflict(ruleMatch: string, evt: LessonConflict, actor: AuditActor = 'rpc', owner?: LessonOwner): Lesson | null {
    const lessons = this.read()
    const key = lessonKey(ruleMatch)
    const idx = lessons.findIndex(l => lessonKey(l.rule) === key && lessonOwnerKey(l.owner) === lessonOwnerKey(owner))
    if (idx < 0) return null
    const conflicts = [...(lessons[idx].conflicts ?? []), evt].slice(-LESSON_LIMITS.conflicts)
    lessons[idx] = { ...lessons[idx], conflicts }
    this.rewrite(lessons)
    this.auditWrite({ actor, action: 'conflict', target: lessons[idx].rule, detail: `${evt.reason} (session ${evt.sessionId})` })
    return lessons[idx]
  }

  /**
   * Lessons injected into a prompt (max LESSON_LIMITS.context): disabled
   * lessons skipped, pinned first, then the most recent — most recent first.
   */
  forContext(owner?: LessonOwner): Lesson[] {
    return selectContextLessons(this.listForOwner(owner), LESSON_LIMITS.context)
  }

  /** Drop the cache so the next list() re-reads the file. */
  invalidate(): void {
    this.cache = null
  }

  /** Best-effort audit write — the secondary log must never break a mutation. */
  private auditWrite(input: AuditInput): void {
    try {
      this.auditLog.append(input)
    } catch {
      // auditing is best-effort; the mutation already landed
    }
  }

  /** M1 FTS: (re)index the stored lesson; the index may never break a mutation. */
  private indexed(lesson: Lesson): Lesson {
    try {
      ftsUpsertLesson(dirname(this.filePath), lesson)
    } catch {
      // best-effort projection of the jsonl file
    }
    return lesson
  }

  /** M1 FTS: drop a lesson from the scope's index (matched by normalized rule). */
  private unindexed(rule: string): void {
    try {
      ftsRemoveLesson(dirname(this.filePath), rule)
    } catch {
      // best-effort
    }
  }

  private resolveIndex(lessons: Lesson[], match: string | number, owner?: LessonOwner): number {
    if (typeof match === 'number') {
      return match >= 0 && match < lessons.length ? match : -1
    }
    const key = lessonKey(match)
    const ownerKey = lessonOwnerKey(owner)
    return lessons.findIndex(l => lessonKey(l.rule) === key && lessonOwnerKey(l.owner) === ownerKey)
  }

  private mtime(): number {
    try {
      return statSync(this.filePath).mtimeMs
    } catch {
      return -1
    }
  }

  private read(): Lesson[] {
    this.recoverPendingArchive()
    if (!existsSync(this.filePath)) {
      this.cache = { mtimeMs: -1, lessons: [] }
      return []
    }
    const mtimeMs = this.mtime()
    if (!this.cache || this.cache.mtimeMs !== mtimeMs) {
      this.cache = { mtimeMs, lessons: parseLessons(readFileSync(this.filePath, 'utf8')) }
    }
    return this.cache.lessons.map((lesson) => ({ ...lesson }))
  }

  /**
   * A snapshot is a write precondition, not best-effort. Marking it complete
   * before copy succeeds can make a later rewrite destroy the only recovery
   * copy, so failures propagate and leave the source untouched.
   */
  private backupOnce(): void {
    if (backedUp.has(this.filePath) || !existsSync(this.filePath)) return
    const dir = join(dirname(this.filePath), 'backups')
    mkdirSync(dir, { recursive: true })
    const content = readFileSync(this.filePath)
    const base = `lessons-${new Date().toISOString().replace(/[:.]/g, '-')}`
    let backupPath = join(dir, `${base}.jsonl`)
    for (let suffix = 1; existsSync(backupPath); suffix++) backupPath = join(dir, `${base}-${suffix}.jsonl`)
    const tmpPath = `${backupPath}.${process.pid}.tmp`
    try {
      writeFileSync(tmpPath, content, { flag: 'wx' })
      if (!readFileSync(tmpPath).equals(content)) throw new Error('Lesson backup verification failed')
      renameSync(tmpPath, backupPath)
      const snapshots = readdirSync(dir).filter(name => /^lessons-.*\.jsonl$/.test(name)).sort()
      for (const old of snapshots.slice(0, Math.max(0, snapshots.length - LESSON_BACKUPS_KEPT))) {
        try { unlinkSync(join(dir, old)) } catch { /* retain older snapshots if pruning fails */ }
      }
      backedUp.add(this.filePath)
    } catch (error) {
      try { unlinkSync(tmpPath) } catch { /* no temporary snapshot remains */ }
      throw error
    }
  }

  /** Recover archive work interrupted after the active-file rename. */
  private recoverPendingArchive(): void {
    const journalPath = `${this.filePath}.archive.pending`
    if (!existsSync(journalPath)) return
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      id: string
      active: string
      archived: Lesson[]
    }
    const active = existsSync(this.filePath) ? readFileSync(this.filePath, 'utf8') : ''
    if (active === journal.active) {
      const archivePath = join(dirname(this.filePath), 'lessons.archive.jsonl')
      const existing = existsSync(archivePath) ? readFileSync(archivePath, 'utf8') : ''
      const committed = new Set(existing.split('\n').filter(Boolean).flatMap((line) => {
        try {
          const row = JSON.parse(line) as { archiveTransactionId?: string }
          return row.archiveTransactionId ? [row.archiveTransactionId] : []
        } catch {
          return []
        }
      }))
      if (!committed.has(journal.id)) {
        const archived = journal.archived.map((lesson) => JSON.stringify({ ...lesson, archiveTransactionId: journal.id })).join('\n')
        const archiveTmp = `${archivePath}.${process.pid}.tmp`
        writeFileSync(archiveTmp, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${archived}\n`)
        renameSync(archiveTmp, archivePath)
      }
    }
    unlinkSync(journalPath)
  }

  /** Full atomic rewrite: stage overflow, write a tmp file, then rename. */
  private rewrite(lessons: Lesson[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    this.backupOnce()
    const positionsByOwner = new Map<string, number[]>()
    for (let i = 0; i < lessons.length; i++) {
      const ownerKey = lessonOwnerKey(lessons[i].owner)
      const positions = positionsByOwner.get(ownerKey) ?? []
      positions.push(i)
      positionsByOwner.set(ownerKey, positions)
    }
    const drop = new Set<number>()
    for (const positions of positionsByOwner.values()) {
      const overflow = Math.max(0, positions.length - LESSON_LIMITS.total)
      let dropped = 0
      for (const i of positions) {
        if (dropped >= overflow) break
        if (lessons[i].pinned) continue
        drop.add(i)
        dropped++
      }
      for (const i of positions) {
        if (dropped >= overflow) break
        if (drop.has(i)) continue
        drop.add(i)
        dropped++
      }
    }
    const archived = lessons.filter((_, i) => drop.has(i))
    const pruned = lessons.filter((_, i) => !drop.has(i))
    const active = pruned.map(l => JSON.stringify(l)).join('\n') + (pruned.length ? '\n' : '')
    const journalPath = `${this.filePath}.archive.pending`
    if (archived.length) {
      const id = randomUUID()
      const journal = JSON.stringify({ id, active, archived })
      const journalTmp = `${journalPath}.${process.pid}.tmp`
      writeFileSync(journalTmp, journal)
      renameSync(journalTmp, journalPath)
    }
    const tmp = join(dirname(this.filePath), `.${Date.now()}-${process.pid}.lessons.tmp`)
    writeFileSync(tmp, active)
    renameSync(tmp, this.filePath)
    if (archived.length) this.recoverPendingArchive()
    this.cache = { mtimeMs: this.mtime(), lessons: pruned }
  }
}
