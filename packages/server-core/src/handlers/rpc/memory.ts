import { peekRoxAccountAuthority, LOCAL_ROX_CALLER } from '@rox/shared/auth'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { PushTarget } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@rox/shared/config'
import { getMemoryConfig } from '@rox/shared/config/storage'
import type { Lesson, LessonCategory, LessonOwner, LessonScope, ProjectMemoryDto, WorkspaceMemory } from '@rox/shared/memory/types'
import type { WikiApplyResult, WikiClaimStatus, WikiGetResult, WikiLintReport, WikiListResult, WikiMutation } from '@rox/shared/memory/types'
import { pushTyped, type RequestContext, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcMemoryActResult,
  rpcMemoryListResult,
  rpcMemoryReadResult,
} from '@rox/core/rox2'
import { LessonStore, lessonKey } from '../../memory/LessonStore'
import { buildConflictPrompt, parseConflicts, promoteLessonToGlobal, scanPromotionCandidates } from '../../memory/lesson-graph'
import type { LessonConflictVerdict } from '../../memory/lesson-graph'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { MemoryIndexService, memoryIndexServiceFor } from '../../memory/MemoryIndexService'
import { WikiClaimStore } from '../../memory/WikiClaimStore'
import { compileWikiDigest } from '../../memory/wiki-lint'
import type { MemoryGetResult, MemoryIndexStatus, MemorySearchHit } from '@rox/shared/memory/types'
import { getProjectMemoryPath, loadProject, loadProjectById, loadProjectMemory } from '@rox/shared/projects'
import { search as ftsSearch } from '../../memory/fts-index'
import { notifyRepoMutation, type RepoBankRef } from '../../memory/repo/notify'
import { ownerKey8For, parseBankId, formatBankId } from '../../memory/repo/RepoSourceProvider'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.LIST_LESSONS,
  RPC_CHANNELS.memory.LIST_ARCHIVE,
  RPC_CHANNELS.memory.RESTORE_ARCHIVE,
  RPC_CHANNELS.memory.ADD_LESSON,
  RPC_CHANNELS.memory.UPDATE_LESSON,
  RPC_CHANNELS.memory.DELETE_LESSON,
  RPC_CHANNELS.memory.GET_CONTEXT,
  RPC_CHANNELS.memory.GET_PROJECT_MEMORY,
  RPC_CHANNELS.memory.UPDATE_CONTEXT,
  RPC_CHANNELS.memory.LIST_HISTORY,
  RPC_CHANNELS.memory.PROMOTION_CANDIDATES,
  RPC_CHANNELS.memory.PROMOTE_LESSON,
  RPC_CHANNELS.memory.SEARCH,
  RPC_CHANNELS.memory.GET,
  RPC_CHANNELS.memory.INDEX_STATUS,
  RPC_CHANNELS.memory.REBUILD_INDEX,
  RPC_CHANNELS.memory.WIKI_LIST,
  RPC_CHANNELS.memory.WIKI_GET,
  RPC_CHANNELS.memory.WIKI_APPLY,
  RPC_CHANNELS.memory.WIKI_LINT,
]

export interface LessonInput {
  rule: string
  category: LessonCategory
  negative?: boolean
  scope: LessonScope
}

/** ADD_LESSON result (spec L2): the stored lesson plus conflicts detected
 *  post-write against existing rules. `conflicts` is [] whenever the LLM
 *  check is unavailable or fails — it never blocks the write. */
export interface AddLessonResult {
  lesson: Lesson
  conflicts: LessonConflictVerdict[]
}

export interface MemoryContextDto {
  /** Global ~/.craft-agent/memory/preferences.md */
  preferences: string
  /** Workspace {root}/memory/context.md ('' when no workspace given) */
  context: string
  /** Full workspace memory bundle (context + preferences + recent history) */
  workspaceMemory: WorkspaceMemory | null
}

export interface MemoryHistoryDto {
  dates: string[]
  /** The date whose content is returned (requested, else most recent, else null) */
  date: string | null
  content: string
}

function lessonStoreFor(scope: LessonScope, workspaceId?: string): LessonStore | null {
  if (scope === 'global') {
    return new LessonStore(new MemoryFileStore('global').lessonsPath, 'global')
  }
  if (!workspaceId) return null
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  return new LessonStore(new MemoryFileStore('workspace', workspace.rootPath).lessonsPath, 'workspace')
}

export function authorizeMemoryWorkspace(ctx: RequestContext, requestedId: string | null | undefined, deps: HandlerDeps): string | undefined {
  const boundId = ctx.workspaceId ?? (
    ctx.webContentsId === null ? undefined : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) ?? undefined
  )
  if (boundId && requestedId && boundId !== requestedId) throw new Error('Workspace access denied')
  if (ctx.principal && !boundId) throw new Error('Workspace access denied')
  return boundId ?? requestedId ?? undefined
}

export function lessonOwnerFromContext(ctx: RequestContext): LessonOwner | undefined {
  return ctx.principal
    ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject }
    : undefined
}

/**
 * Authorize a memory-repo bank selector (`main[#<ownerKey8>]` |
 * `ws:<workspaceId>[#<ownerKey8>]`) for the memory:repo* / memory:dream*
 * channels and the import handlers (one shared policy, both modules).
 *
 * The workspace part is authorized exactly like every other memory handler
 * (`authorizeMemoryWorkspace`, including the cross-workspace rejection); the
 * `#<ownerKey8>` suffix selects a lesson owner and MUST be bound to the caller
 * too — the service filters the bundle by it, so a foreign suffix would leak
 * another owner's rules:
 *
 * - Native principal: only its own workspace bank, ownerless or with its own
 *   owner key (`ownerKey8For(principal)`). `main*` is denied outright — it
 *   renders the global `PROFILE.md`/preferences that principals never see
 *   (see GET_CONTEXT) — and so is any foreign owner suffix.
 * - Local host (no principal): `main`/`ws:<id>` stay available ownerless
 *   (absent or `local`); a concrete owner suffix has no authenticated owner to
 *   bind to and is denied.
 *
 * Throws before any service access; returns the CANONICAL bank id
 * (`formatBankId(parseBankId(bankId))`: trimmed, `#local` collapsed to the
 * ownerless base) so every downstream helper — `bankWorkspaceId`,
 * `memoryDirFor`, `bankTarget`, `resolveWorkspaceRoot`, the import accessor and
 * the per-bank lock key — keys on one spelling of a repository.
 */
export function authorizeMemoryRepoBank(ctx: RequestContext, bankId: string, deps: HandlerDeps): string {
  const parsed = parseBankId(bankId)
  const canonical = formatBankId(parsed.scope, parsed.workspaceId, parsed.ownerKey8)
  const bound = authorizeMemoryWorkspace(ctx, parsed.workspaceId, deps)
  if (parsed.scope === 'workspace' && bound && parsed.workspaceId && bound !== parsed.workspaceId) {
    throw new Error('Workspace access denied')
  }
  const ownerKey8 = parsed.ownerKey8
  if (ctx.principal) {
    if (parsed.scope === 'main') throw new Error('Memory bank access denied')
    if (ownerKey8 !== undefined && ownerKey8 !== ownerKey8For(ctx.principal)) {
      throw new Error('Memory bank access denied')
    }
    return canonical
  }
  if (ownerKey8 !== undefined && ownerKey8 !== 'local') {
    throw new Error('Memory bank access denied')
  }
  return canonical
}

/** Repo bank a lesson/context write belongs to: `main` for global, the workspace bank otherwise,
 * scoped to the writing owner when the caller is an authenticated principal. */
function memoryBank(scope: LessonScope, workspaceId: string | null | undefined, owner?: LessonOwner): RepoBankRef {
  const ownerKey8 = owner ? ownerKey8For(owner) : undefined
  if (scope === 'global') {
    return ownerKey8 ? { scope: 'main', ownerKey8 } : { scope: 'main' }
  }
  return ownerKey8
    ? { scope: 'workspace', workspaceId: workspaceId ?? '', ownerKey8 }
    : { scope: 'workspace', workspaceId: workspaceId ?? '' }
}

export function registerMemoryHandlers(server: RpcServer, deps: HandlerDeps): void {
  const broadcastChanged = (workspaceId: string | null, scope: LessonScope | 'both'): void => {
    const target: PushTarget = workspaceId ? { to: 'workspace', workspaceId } : { to: 'all' }
    pushTyped(server, RPC_CHANNELS.memory.CHANGED, target, workspaceId, scope)
  }

  // L2: post-write, best-effort LLM check of the new rule against existing
  // rules (same scope; workspace adds also check global rules). One attempt,
  // any failure (no workspaces configured, no distiller wired, LLM error,
  // unparseable reply) degrades to [] — the write always stands.
  const detectLessonConflicts = async (
    workspaceId: string | null,
    scope: LessonScope,
    store: LessonStore,
    newLesson: Lesson,
    owner?: LessonOwner,
  ): Promise<LessonConflictVerdict[]> => {
    try {
      const run = deps.sessionManager?.runDistillOneShot
      if (typeof run !== 'function') return []
      const existing = store.listForOwner(owner).filter(l => lessonKey(l.rule) !== lessonKey(newLesson.rule))
      if (scope === 'workspace') {
        existing.push(...new LessonStore(new MemoryFileStore('global').lessonsPath, 'global').listForOwner(owner))
      }
      if (existing.length === 0) return []
      const llmWorkspaceId = workspaceId ?? getWorkspaces()[0]?.id
      if (!llmWorkspaceId) return []
      const rules = existing.map(l => l.rule)
      const text = await run.call(deps.sessionManager, llmWorkspaceId, buildConflictPrompt(newLesson.rule, rules), await peekRoxAccountAuthority()?.capture(owner ?? LOCAL_ROX_CALLER))
      return parseConflicts(text, rules)
    } catch (err) {
      deps.platform.logger?.warn('MEMORY_ADD_LESSON: conflict check failed, skipping', err)
      return []
    }
  }

  // List lessons for one scope or both.
  server.handle(RPC_CHANNELS.memory.LIST_LESSONS, async (ctx, scope: LessonScope | 'both', workspaceId?: string) => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    const owner = lessonOwnerFromContext(ctx)
    const listed = rpcMemoryListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const scopes: LessonScope[] = scope === 'both' ? ['global', 'workspace'] : [scope]
    const lessons: Lesson[] = []
    for (const s of scopes) {
      const store = lessonStoreFor(s, authorizedWorkspaceId)
      if (!store) {
        if (s === 'workspace') deps.platform.logger?.error(`MEMORY_LIST_LESSONS: Workspace not found: ${authorizedWorkspaceId}`)
        continue
      }
      lessons.push(...store.listForOwner(owner))
    }
    return lessons
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.LIST_ARCHIVE, async (ctx, scope: LessonScope, workspaceId?: string) => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    const store = lessonStoreFor(scope, authorizedWorkspaceId)
    if (!store) {
      if (scope === 'workspace') throw new Error('Workspace not found')
      return []
    }
    return store.listArchivedForOwner(lessonOwnerFromContext(ctx))
  }, { nativeAction: 'read' })

  server.handle(
    RPC_CHANNELS.memory.RESTORE_ARCHIVE,
    async (ctx, workspaceId: string | null, scope: LessonScope, archiveId: string): Promise<Lesson | null> => {
      const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
      const store = lessonStoreFor(scope, authorizedWorkspaceId)
      if (!store) throw new Error('Workspace not found')
      const owner = lessonOwnerFromContext(ctx)
      const restored = store.restoreArchivedForOwner(owner, archiveId)
      if (restored) {
        broadcastChanged(scope === 'global' ? null : authorizedWorkspaceId ?? null, scope)
        notifyRepoMutation(memoryBank(scope, authorizedWorkspaceId, owner), 'rpc:restoreArchive')
      }
      return restored
    },
    { nativeAction: 'write' },
  )

  // Add a lesson from the UI (explicit trigger). Returns {lesson, conflicts}:
  // the L2 conflict list is best-effort and empty whenever the check is
  // unavailable (no LLM, parse failure) — it never blocks the write.
  server.handle(RPC_CHANNELS.memory.ADD_LESSON, async (ctx, workspaceId: string | null, input: LessonInput): Promise<AddLessonResult> => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    const owner = lessonOwnerFromContext(ctx)
    const act = rpcMemoryActResult({ source: 'native', action: 'write', nativeId: input?.scope ?? 'lesson' })
    if (!isClaimableLive(act)) throw new Error('memory add is not live')
    const scope: LessonScope = input.scope ?? 'global'
    const store = lessonStoreFor(scope, authorizedWorkspaceId)
    if (!store) throw new Error('Workspace not found')
    const lesson = store.add({
      ts: new Date().toISOString(),
      rule: input.rule,
      category: input.category,
      scope,
      ...(owner ? { owner } : {}),
      ...(input.negative ? { negative: true } : {}),
      source: { trigger: 'explicit' },
    })
    broadcastChanged(scope === 'global' ? null : authorizedWorkspaceId ?? null, scope)
    notifyRepoMutation(memoryBank(scope, authorizedWorkspaceId, owner), 'rpc:addLesson')
    const conflicts = await detectLessonConflicts(authorizedWorkspaceId ?? null, scope, store, lesson, owner)
    return { lesson, conflicts }
  }, { nativeAction: 'write' })


  // Patch a lesson by rule text or index.
  server.handle(
    RPC_CHANNELS.memory.UPDATE_LESSON,
    async (ctx, workspaceId: string | null, scope: LessonScope, match: string | number, patch: Partial<Omit<Lesson, 'scope'>>) => {
      const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
      const owner = lessonOwnerFromContext(ctx)
      const store = lessonStoreFor(scope, authorizedWorkspaceId)
      if (!store) throw new Error('Workspace not found')
      const updated = store.update(match, patch, 'rpc', owner)
      if (!updated) return null
      broadcastChanged(scope === 'global' ? null : authorizedWorkspaceId ?? null, scope)
      notifyRepoMutation(memoryBank(scope, authorizedWorkspaceId, owner), 'rpc:updateLesson')
      return updated
    },
    { nativeAction: 'write' },
  )

  // Delete a lesson by rule text or index.
  server.handle(RPC_CHANNELS.memory.DELETE_LESSON, async (ctx, workspaceId: string | null, scope: LessonScope, match: string | number) => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    const owner = lessonOwnerFromContext(ctx)
    if (match === undefined || match === null || match === '') {
      throw new Error('memory.delete: match is required')
    }
    const act = rpcMemoryActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: String(match),
    })
    if (!isClaimableLive(act)) throw new Error('memory delete is not live')
    const store = lessonStoreFor(scope, authorizedWorkspaceId)
    if (!store) throw new Error('Workspace not found')
    const deleted = store.delete(match, 'rpc', owner)
    if (deleted) {
      broadcastChanged(scope === 'global' ? null : authorizedWorkspaceId ?? null, scope)
      notifyRepoMutation(memoryBank(scope, authorizedWorkspaceId, owner), 'rpc:deleteLesson')
    }
    return deleted
  }, { nativeAction: 'delete' })

  // L3: rules repeated as workspace lessons in ≥2 distinct workspaces →
  // candidates for promotion to the global scope (Memory tab banner).
  server.handle(RPC_CHANNELS.memory.PROMOTION_CANDIDATES, async (ctx) => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, undefined, deps)
    const workspaces = ctx.principal
      ? (authorizedWorkspaceId ? [getWorkspaceByNameOrId(authorizedWorkspaceId)].filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace)) : [])
      : getWorkspaces()
    return scanPromotionCandidates(workspaces, lessonOwnerFromContext(ctx))
  }, { nativeAction: 'read' })

  // L3: copy a workspace rule into the global scope, marked promoted.
  server.handle(RPC_CHANNELS.memory.PROMOTE_LESSON, async (ctx, workspaceId: string | null, rule: string) => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    const owner = lessonOwnerFromContext(ctx)
    const workspaces = ctx.principal
      ? (authorizedWorkspaceId ? [getWorkspaceByNameOrId(authorizedWorkspaceId)].filter((workspace): workspace is NonNullable<typeof workspace> => Boolean(workspace)) : [])
      : getWorkspaces()
    const result = promoteLessonToGlobal(workspaces, rule, undefined, owner)
    if (!result) return null
    broadcastChanged(null, 'global')
    notifyRepoMutation(owner ? { scope: 'main', ownerKey8: ownerKey8For(owner) } : { scope: 'main' }, 'rpc:promoteLesson')
    return result
  }, { nativeAction: 'write' })

  // Global preferences.md + workspace context.md (+ workspace memory bundle).
  // M1: optional query → FTS-ranked subset of the bundle (context/preferences
  // documents only when matched, history restricted to ranked days, top-K per
  // memory.ftsLimit). Missing query, any index error, or zero hits fall back
  // to the full recent bundle.
  server.handle(RPC_CHANNELS.memory.GET_CONTEXT, async (ctx, workspaceId?: string, query?: string): Promise<MemoryContextDto> => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    const read = rpcMemoryReadResult({ source: 'native', nativeId: authorizedWorkspaceId ?? 'global' })
    if (!isClaimableLive(read.result)) throw new Error('memory context is not live')
    const globalStore = new MemoryFileStore('global')
    const preferences = ctx.principal ? '' : globalStore.readPreferences()
    if (!authorizedWorkspaceId) return { preferences, context: '', workspaceMemory: null }
    const workspace = getWorkspaceByNameOrId(authorizedWorkspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`MEMORY_GET_CONTEXT: Workspace not found: ${authorizedWorkspaceId}`)
      return { preferences, context: '', workspaceMemory: null }
    }
    const wsStore = new MemoryFileStore('workspace', workspace.rootPath)
    const fullBundle = (): MemoryContextDto => {
      const workspaceMemory = wsStore.loadWorkspaceMemory()
      return {
        preferences,
        context: wsStore.readContext(),
        // The legacy bundle includes machine-global preferences. A native
        // principal's workspace grant does not authorize that private content.
        workspaceMemory: ctx.principal ? { ...workspaceMemory, preferences: '' } : workspaceMemory,
      }
    }
    if (!query?.trim()) return fullBundle()
    try {
      const limit = getMemoryConfig().ftsLimit ?? 20
      const wHits = ftsSearch(wsStore.memoryDir, query, { limit })
      const gHits = ctx.principal ? null : ftsSearch(globalStore.memoryDir, query, { limit })
      if (!wHits || (!ctx.principal && !gHits)) return fullBundle()
      const contextDoc = wHits.context.find(h => h.kind === 'context')?.text ?? ''
      const prefsDoc = gHits?.context.find(h => h.kind === 'preferences')?.text ?? ''
      const historyText = wHits.history.map(h => h.text).filter(t => t.trim().length > 0).join('\n\n')
      if (!contextDoc && !prefsDoc && !historyText) return fullBundle()
      return {
        preferences: prefsDoc,
        context: contextDoc,
        workspaceMemory: { context: contextDoc, preferences: prefsDoc, recentHistory: historyText },
      }
    } catch {
      return fullBundle()
    }
  }, { nativeAction: 'read' })

  // M5: project-scope memory is read-only in the Memory tab.
  server.handle(RPC_CHANNELS.memory.GET_PROJECT_MEMORY, async (ctx, workspaceId: string, projectId: string): Promise<ProjectMemoryDto | null> => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    if (!authorizedWorkspaceId) throw new Error('Workspace access denied')
    const workspace = getWorkspaceByNameOrId(authorizedWorkspaceId)
    if (!workspace) return null
    const project = loadProjectById(workspace.rootPath, projectId) ?? loadProject(workspace.rootPath, projectId)
    if (!project) return null
    const slug = project.config.slug
    return {
      name: project.config.name,
      slug,
      memoryPath: getProjectMemoryPath(workspace.rootPath, slug),
      memoryContent: loadProjectMemory(workspace.rootPath, slug, 20_000) ?? '',
    }
  }, { nativeAction: 'read' })

  // Overwrite preferences.md (global) or context.md (workspace).
  server.handle(RPC_CHANNELS.memory.UPDATE_CONTEXT, async (ctx, workspaceId: string | null, scope: LessonScope, content: string) => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    if (scope === 'global') {
      if (ctx.principal) throw new Error('Global preferences are machine-private')
      new MemoryFileStore('global').writePreferences(content)
      broadcastChanged(null, 'global')
      notifyRepoMutation({ scope: 'main' }, 'rpc:updateContext')
      return true
    }
    const workspace = authorizedWorkspaceId ? getWorkspaceByNameOrId(authorizedWorkspaceId) : null
    if (!workspace) throw new Error('Workspace not found')
    new MemoryFileStore('workspace', workspace.rootPath).writeContext(content)
    broadcastChanged(authorizedWorkspaceId!, 'workspace')
    notifyRepoMutation(memoryBank('workspace', authorizedWorkspaceId), 'rpc:updateContext')
    return true
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.memory.LIST_HISTORY, async (ctx, workspaceId: string, date?: string): Promise<MemoryHistoryDto> => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    if (!authorizedWorkspaceId) throw new Error('Workspace access denied')
    const workspace = getWorkspaceByNameOrId(authorizedWorkspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`MEMORY_LIST_HISTORY: Workspace not found: ${authorizedWorkspaceId}`)
      return { dates: [], date: null, content: '' }
    }
    const store = new MemoryFileStore('workspace', workspace.rootPath)
    const dates = store.listHistoryDates()
    const selected = date ?? dates[0] ?? null
    return { dates, date: selected, content: selected ? store.readHistory(selected) : '' }
  }, { nativeAction: 'read' })

  // c1.1/c1.3: the workspace memory chunk index. Retrieval is provenance-aware
  // but NOT provenance-filtered: an untrusted chunk is still returned (labelled
  // by `origin`) — the gate lives in the injection paths, not in retrieval.
  const indexFor = (
    ctx: RequestContext,
    requestedId: string | null | undefined,
  ): { index: MemoryIndexService; workspaceId: string } => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, requestedId, deps)
    if (!authorizedWorkspaceId) throw new Error('Workspace access denied')
    const workspace = getWorkspaceByNameOrId(authorizedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return { index: memoryIndexServiceFor(workspace.rootPath, workspace.id), workspaceId: workspace.id }
  }

  server.handle(
    RPC_CHANNELS.memory.SEARCH,
    async (ctx, args: { workspaceId?: string; query?: string; limit?: number }): Promise<MemorySearchHit[]> => {
      const { index } = indexFor(ctx, args?.workspaceId)
      return index.search(args?.query ?? '', args?.limit ?? 8).hits
    },
    { nativeAction: 'read' },
  )

  server.handle(
    RPC_CHANNELS.memory.GET,
    async (ctx, args: { workspaceId?: string; chunkId?: string }): Promise<MemoryGetResult | null> => {
      if (!args?.chunkId) return null
      const { index } = indexFor(ctx, args.workspaceId)
      return index.get(args.chunkId)
    },
    { nativeAction: 'read' },
  )

  server.handle(
    RPC_CHANNELS.memory.INDEX_STATUS,
    async (ctx, workspaceId: string): Promise<MemoryIndexStatus> => {
      const { index } = indexFor(ctx, workspaceId)
      return index.status()
    },
    { nativeAction: 'read' },
  )

  server.handle(
    RPC_CHANNELS.memory.REBUILD_INDEX,
    async (ctx, workspaceId: string) => {
      const { index, workspaceId: authorizedId } = indexFor(ctx, workspaceId)
      const status = index.rebuild()
      broadcastChanged(authorizedId, 'workspace')
      return { ok: status.state !== 'failed', ...status }
    },
    { nativeAction: 'write' },
  )

  // c1.7: the workspace memory wiki — evidence-backed claims (+ lint digest).
  // The wiki lives under {workspaceRoot}/memory/wiki and is a document surface:
  // it is never injected through buildMemoryBlocks.
  const wikiFor = (
    ctx: RequestContext,
    requestedId: string | null | undefined,
  ): { store: WikiClaimStore; workspaceId: string; owner: LessonOwner | undefined } => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, requestedId, deps)
    if (!authorizedWorkspaceId) throw new Error('Workspace access denied')
    const workspace = getWorkspaceByNameOrId(authorizedWorkspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return {
      store: new WikiClaimStore(new MemoryFileStore('workspace', workspace.rootPath).memoryDir, 'workspace'),
      workspaceId: workspace.id,
      owner: lessonOwnerFromContext(ctx),
    }
  }

  server.handle(
    RPC_CHANNELS.memory.WIKI_LIST,
    async (ctx, args?: { workspaceId?: string | null; scope?: string; status?: WikiClaimStatus }): Promise<WikiListResult> => {
      const listed = rpcMemoryListResult({ source: 'native' })
      if (!isClaimableLive(listed.result)) return { claims: [] }
      const { store, owner } = wikiFor(ctx, args?.workspaceId)
      return {
        claims: store.list({
          ...(owner ? { owner } : {}),
          ...(args?.scope ? { scope: args.scope } : {}),
          ...(args?.status ? { status: args.status } : {}),
        }),
      }
    },
    { nativeAction: 'read' },
  )

  server.handle(
    RPC_CHANNELS.memory.WIKI_GET,
    async (ctx, args: { workspaceId?: string | null; id: string }): Promise<WikiGetResult> => {
      const read = rpcMemoryReadResult({ source: 'native', nativeId: args?.id ?? '' })
      if (!isClaimableLive(read.result)) return { claim: null }
      const { store, owner } = wikiFor(ctx, args?.workspaceId)
      return { claim: store.get(args?.id ?? '', owner ? { owner } : undefined) }
    },
    { nativeAction: 'read' },
  )

  server.handle(
    RPC_CHANNELS.memory.WIKI_APPLY,
    async (ctx, args: { workspaceId?: string | null; mutation: WikiMutation }): Promise<WikiApplyResult> => {
      const act = rpcMemoryActResult({ source: 'native', action: 'write', nativeId: args?.mutation?.op ?? 'claim' })
      if (!isClaimableLive(act)) throw new Error('memory wiki apply is not live')
      const { store, workspaceId, owner } = wikiFor(ctx, args?.workspaceId)
      const result = store.apply(args.mutation, { actor: 'rpc', ...(owner ? { owner } : {}) })
      broadcastChanged(workspaceId, 'workspace')
      notifyRepoMutation(memoryBank('workspace', workspaceId, owner), 'rpc:wikiApply')
      return result
    },
    { nativeAction: 'write' },
  )

  server.handle(
    RPC_CHANNELS.memory.WIKI_LINT,
    async (ctx, args?: { workspaceId?: string | null }): Promise<{ report: WikiLintReport; digestPath: string }> => {
      const read = rpcMemoryReadResult({ source: 'native', nativeId: 'wiki' })
      if (!isClaimableLive(read.result)) {
        return { report: { findings: [], claimsChecked: 0 }, digestPath: '' }
      }
      const { store, workspaceId, owner } = wikiFor(ctx, args?.workspaceId)
      // Evidence liveness: an evidence source resolves while it is still a live
      // memory chunk id. After a forget, the id no longer resolves and the lint
      // flags `evidence-missing` (never throws on an unreadable index).
      const workspace = getWorkspaceByNameOrId(workspaceId)
      const index = workspace ? memoryIndexServiceFor(workspace.rootPath, workspace.id) : null
      const { report, digestPath } = compileWikiDigest({
        memoryDir: store.memoryDir,
        scope: 'workspace',
        ...(owner ? { owner } : {}),
        ...(index ? { isEvidenceLive: (evidence) => index.get(evidence.source) !== null } : {}),
      })
      return { report, digestPath }
    },
    { nativeAction: 'read' },
  )

}
