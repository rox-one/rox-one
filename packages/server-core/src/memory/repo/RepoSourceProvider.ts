/**
 * RepoSourceProvider — turns the existing memory stores (source of truth) into
 * the pure `RepoSourceBundle` the materializer consumes, and enumerates the
 * memory banks (spec §5, contract §3).
 *
 * Also owns the frozen `bankId` grammar shared with A3/A8:
 *   `main` | `main#<ownerKey8>` | `ws:<workspaceId>` | `ws:<workspaceId>#<ownerKey8>`
 * `ownerKey8 = sha1(lessonOwnerKey(owner)).slice(0,8)`; ownerless/local banks
 * use the literal `local`.
 *
 * Ownership filter: exactly `LessonStore.listForOwner` semantics — an
 * owner-scoped bank only ever sees lessons whose `lessonOwnerKey` hashes to its
 * `ownerKey8`; the `local` bank only sees rows without an owner.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { getWorkspaces } from '@rox/shared/config/storage'
import type { Workspace } from '@rox/shared/config'
import type { Lesson, LessonOwner } from '@rox/shared/memory/types'
import type { MemoryRepoBankInfo } from '@rox/shared/memory/repo'
import { LessonStore, lessonOwnerKey } from '../LessonStore'
import { MemoryFileStore } from '../MemoryFileStore'
import type { RepoSourceBundle, RepoSourceLesson } from './MemoryRepoMaterializer'

export interface ParsedBankId {
  scope: 'main' | 'workspace'
  workspaceId?: string
  ownerKey8?: string
}

const OWNER_KEY8_RE = /^[0-9a-f]{8}$/

function sha1Hex(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

/** `ownerKey8` for a lesson owner; `'local'` for the ownerless (legacy) bank. */
export function ownerKey8For(owner?: LessonOwner): string {
  return ownerKey8FromKey(lessonOwnerKey(owner))
}

/** `ownerKey8` for a raw `lessonOwnerKey` string; `'local'` when empty. */
export function ownerKey8FromKey(key: string): string {
  if (!key) return 'local'
  return sha1Hex(key).slice(0, 8)
}

/** Parse the frozen bankId grammar; throws on malformed input. */
export function parseBankId(bankId: string): ParsedBankId {
  if (typeof bankId !== 'string' || !bankId) throw new Error(`invalid bankId: ${String(bankId)}`)
  const trimmed = bankId.trim()
  if (!trimmed) throw new Error('invalid bankId: empty')

  const hashIndex = trimmed.indexOf('#')
  const base = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const ownerRaw = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : undefined
  if (ownerRaw !== undefined && !(ownerRaw === 'local' || OWNER_KEY8_RE.test(ownerRaw))) {
    throw new Error(`invalid bankId owner: ${trimmed}`)
  }

  if (base === 'main') {
    return ownerRaw === undefined ? { scope: 'main' } : { scope: 'main', ownerKey8: ownerRaw }
  }
  if (base.startsWith('ws:')) {
    const workspaceId = base.slice(3)
    if (!workspaceId || workspaceId.includes('#')) throw new Error(`invalid bankId: ${trimmed}`)
    return ownerRaw === undefined ? { scope: 'workspace', workspaceId } : { scope: 'workspace', workspaceId, ownerKey8: ownerRaw }
  }
  throw new Error(`invalid bankId: ${trimmed}`)
}

/** Format the frozen bankId grammar; `local`/absent ownerKey8 omits the suffix. */
export function formatBankId(scope: 'main' | 'workspace', workspaceId?: string, ownerKey8?: string): string {
  const base = scope === 'main' ? 'main' : `ws:${workspaceId ?? ''}`
  if (scope === 'workspace' && !workspaceId) throw new Error('formatBankId: workspaceId is required')
  if (!ownerKey8 || ownerKey8 === 'local') return base
  if (!OWNER_KEY8_RE.test(ownerKey8)) throw new Error(`formatBankId: invalid ownerKey8: ${ownerKey8}`)
  return `${base}#${ownerKey8}`
}

/**
 * Working tree for a bank: `{repoDir ?? configDir/memory/repos}/main/<ownerKey8>/`
 * or `.../ws-<sha1(workspaceId)[:8]>/<ownerKey8>/`.
 */
export function memoryRepoPath(
  opts: { configDir: string; repoDir?: string },
  bankId: string,
  ownerKey?: string,
): string {
  const parsed = parseBankId(bankId)
  const root = opts.repoDir ?? join(opts.configDir, 'memory', 'repos')
  const dirName = parsed.scope === 'main' ? 'main' : `ws-${sha1Hex(parsed.workspaceId ?? '').slice(0, 8)}`
  const owner8 = parsed.ownerKey8 ?? ownerKey8FromKey(ownerKey ?? '')
  return join(root, dirName, owner8)
}

export interface RepoSourceProvider {
  listBanks(): Promise<MemoryRepoBankInfo[]>
  loadBundle(bankId: string): Promise<RepoSourceBundle>
}

/** Minimal workspace identity the provider needs (getWorkspaces() satisfies it). */
export interface WorkspaceRef {
  id: string
  name: string
  rootPath: string
}

export interface RepoSourceProviderDeps {
  configDir: string
  repoDir?: string
  getWorkspaces?: () => WorkspaceRef[]
  now?: () => Date
}

function toRepoSourceLesson(lesson: Lesson): RepoSourceLesson {
  return {
    lessonKey: lesson.rule.trim().toLowerCase(),
    rule: lesson.rule,
    category: lesson.category,
    negative: lesson.negative === true,
    pinned: lesson.pinned === true,
    disabled: lesson.disabled === true,
    tags: [...(lesson.tags ?? [])],
    createdAt: lesson.ts,
    ...(lesson.editedAt ? { updatedAt: lesson.editedAt } : {}),
    source: {
      trigger: lesson.source.trigger,
      ...(lesson.source.sessionId ? { sessionId: lesson.source.sessionId } : {}),
      ...(lesson.source.proposalId ? { proposalId: lesson.source.proposalId } : {}),
      ...(lesson.source.consentEventId ? { consent: lesson.source.consentEventId } : {}),
    },
  }
}

/** Materializes source bundles from the existing stores; reads only, never writes. */
export class MemoryRepoSourceProvider implements RepoSourceProvider {
  private readonly configDir: string
  private readonly repoDir?: string
  private readonly workspaces: () => WorkspaceRef[]

  constructor(deps: RepoSourceProviderDeps) {
    this.configDir = deps.configDir
    this.repoDir = deps.repoDir
    this.workspaces = deps.getWorkspaces ?? (() => getWorkspaces().map((w: Workspace) => ({ id: w.id, name: w.name, rootPath: w.rootPath })))
  }

  private repoPathFor(bankId: string, ownerKey?: string): string {
    return memoryRepoPath({ configDir: this.configDir, ...(this.repoDir ? { repoDir: this.repoDir } : {}) }, bankId, ownerKey)
  }

  async listBanks(): Promise<MemoryRepoBankInfo[]> {
    const banks: MemoryRepoBankInfo[] = [
      { id: 'main', scope: 'main', label: 'main', repoPath: this.repoPathFor('main'), isMain: true },
    ]
    for (const workspace of this.workspaces()) {
      banks.push({
        id: `ws:${workspace.id}`,
        scope: 'workspace',
        label: workspace.name,
        repoPath: this.repoPathFor(`ws:${workspace.id}`),
        isMain: false,
      })
    }
    return banks
  }

  async loadBundle(bankId: string): Promise<RepoSourceBundle> {
    const parsed = parseBankId(bankId)
    if (parsed.scope === 'main') return this.loadMainBundle(bankId, parsed.ownerKey8)
    return this.loadWorkspaceBundle(bankId, parsed.workspaceId ?? '', parsed.ownerKey8)
  }

  private matchesOwner(lesson: Lesson, ownerKey8?: string): boolean {
    const key = lessonOwnerKey(lesson.owner)
    if (ownerKey8 === undefined || ownerKey8 === 'local') return key === ''
    return ownerKey8FromKey(key) === ownerKey8
  }

  private readLessons(store: LessonStore, ownerKey8?: string): RepoSourceLesson[] {
    return store
      .list()
      .filter((lesson) => this.matchesOwner(lesson, ownerKey8))
      .map(toRepoSourceLesson)
      .sort((a, b) => (a.createdAt === b.createdAt ? a.lessonKey.localeCompare(b.lessonKey) : a.createdAt.localeCompare(b.createdAt)))
  }

  private loadMainBundle(bankId: string, ownerKey8?: string): RepoSourceBundle {
    const files = new MemoryFileStore('global', undefined, this.configDir)
    const lessonStore = new LessonStore(files.lessonsPath, 'global')
    const preferences = files.readPreferences()
    return {
      bankId,
      scope: 'main',
      lessons: this.readLessons(lessonStore, ownerKey8),
      context: null,
      preferences: preferences.length > 0 ? preferences : null,
      history: [],
    }
  }

  private loadWorkspaceBundle(bankId: string, workspaceId: string, ownerKey8?: string): RepoSourceBundle {
    const workspace = this.workspaces().find((w) => w.id === workspaceId)
    if (!workspace) throw new Error(`unknown workspace for bankId: ${bankId}`)
    const files = new MemoryFileStore('workspace', workspace.rootPath, this.configDir)
    const lessonStore = new LessonStore(files.lessonsPath, 'workspace')
    const context = files.readContext()
    const history = files
      .listHistoryDates()
      .slice()
      .sort()
      .map((date) => ({ date, content: files.readHistory(date) }))
      .filter((entry) => entry.content.length > 0)
    return {
      bankId,
      scope: 'workspace',
      workspaceName: workspace.name,
      lessons: this.readLessons(lessonStore, ownerKey8),
      context: context.length > 0 ? context : null,
      preferences: null,
      history,
    }
  }
}