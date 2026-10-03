/**
 * M4 — memory export/import RPC handlers (spec §M4, self-learning v2).
 *
 * - memory.EXPORT(scope, workspaceId?) → versioned JSON bundle
 *   {version: 1, lessons, context, preferences, history: [{day, text}]}
 *   mirroring the sessions EXPORT pattern.
 * - memory.IMPORT(scope, workspaceId, bundle, {mode}) with two modes:
 *     merge  — LessonStore.add dedups rules (case-insensitive); context/
 *              preferences append only when their text is not already
 *              present; history days already on disk are skipped.
 *     replace — lessons.jsonl/context.md/preferences.md/daily history are
 *              rewritten to exactly the bundle content.
 *   A single memory.CHANGED broadcast fires after a completed import.
 *
 * Global scope has no context/history (no workspace); workspace export also
 * bundles the global preferences so a workspace export is self-contained.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { PushTarget } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import type { Lesson, LessonOwner, LessonScope } from '@rox/shared/memory/types'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import { pushTyped } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcMemoryIoActResult,
  rpcMemoryIoListResult,
  rpcMemoryIoReadResult,
} from '@rox/core/rox2'
import { LessonStore, lessonKey } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'

export const HANDLED_CHANNELS = [RPC_CHANNELS.memory.EXPORT, RPC_CHANNELS.memory.IMPORT] as const

export const MEMORY_BUNDLE_VERSION = 1
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
function broadcastChanged(server: RpcServer, workspaceId: string | null, scope: LessonScope): void {
  const target: PushTarget = workspaceId ? { to: 'workspace', workspaceId } : { to: 'all' }
  pushTyped(server, RPC_CHANNELS.memory.CHANGED, target, workspaceId, scope)
}

export interface MemoryHistoryEntry {
  /** YYYY-MM-DD */
  day: string
  text: string
}

export interface MemoryExportBundle {
  version: 1
  lessons: Lesson[]
  /** Workspace {root}/memory/context.md ('' for global scope) */
  context: string
  /** Global ~/.craft-agent/memory/preferences.md */
  preferences: string
  /** Daily history files, oldest first ('' texts are kept verbatim) */
  history: MemoryHistoryEntry[]
}

export interface MemoryImportOptions {
  /** 'merge' (default) dedups; 'replace' rewrites the target store. */
  mode?: 'merge' | 'replace'
}

export interface MemoryImportResult {
  /** Lessons written into the target store (all bundle lessons in replace mode). */
  added: number
  /** Bundle lessons skipped as duplicates (merge mode only). */
  skipped: number
  /** History days written to disk. */
  historyAdded: number
  /** History days skipped as already present (merge mode only). */
  historySkipped: number
}

function ownerFromContext(ctx: RequestContext): LessonOwner | undefined {
  return ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : undefined
}

function authorizeMemoryWorkspace(ctx: RequestContext, requestedId: string | null | undefined, deps: HandlerDeps): string | undefined {
  const boundId = ctx.workspaceId ?? (
    ctx.webContentsId === null ? undefined : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) ?? undefined
  )
  if (ctx.principal && !boundId) throw new Error('Workspace access denied')
  if (boundId && requestedId && boundId !== requestedId) throw new Error('Workspace access denied')
  return boundId ?? requestedId ?? undefined
}

/** Validate the bundle envelope; per-entry tolerance happens at apply time. */
function assertBundle(bundle: unknown): asserts bundle is MemoryExportBundle {
  const b = bundle as MemoryExportBundle | null
  if (!b || typeof b !== 'object') throw new Error('Invalid memory bundle')
  if (b.version !== MEMORY_BUNDLE_VERSION) throw new Error(`Unsupported memory bundle version: ${String(b.version)}`)
  if (!Array.isArray(b.lessons) || b.lessons.some(l => !l || typeof l !== 'object' || typeof (l as Lesson).rule !== 'string')) {
    throw new Error('Invalid memory bundle: lessons must be an array of lesson objects')
  }
  if (b.history !== undefined && !Array.isArray(b.history)) throw new Error('Invalid memory bundle: history must be an array')
}

/** Build a target lesson entry, enforcing the target scope and minimal fields. */
function normalizeImportLesson(l: Lesson, scope: LessonScope, ts: string, owner?: LessonOwner): Lesson {
  return {
    ...l,
    scope,
    ...(owner ? { owner } : { owner: undefined }),
    ts: typeof l.ts === 'string' && l.ts ? l.ts : ts,
    source: l.source ?? { trigger: 'explicit' },
  }
}

export function registerMemoryIoHandlers(server: RpcServer, deps: HandlerDeps): void {
  // ——— EXPORT(scope, workspaceId?) ———
  server.handle(RPC_CHANNELS.memory.EXPORT, async (ctx, scope: LessonScope, workspaceId?: string): Promise<MemoryExportBundle> => {
    const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
    const owner = ownerFromContext(ctx)
    const listed = rpcMemoryIoListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('memory export is not live')
    const read = rpcMemoryIoReadResult({ source: 'native', nativeId: scope ?? 'bundle' })
    if (!isClaimableLive(read.result)) throw new Error('memory export is not live')
    const globalFiles = new MemoryFileStore('global')
    const preferences = ctx.principal ? '' : globalFiles.readPreferences()
    if (scope === 'global') {
      const lessons = new LessonStore(globalFiles.lessonsPath, 'global').listForOwner(owner)
      return { version: 1, lessons, context: '', preferences, history: [] }
    }
    const workspace = authorizedWorkspaceId ? getWorkspaceByNameOrId(authorizedWorkspaceId) : null
    if (!workspace) throw new Error('Workspace not found')
    const wsFiles = new MemoryFileStore('workspace', workspace.rootPath)
    const lessons = new LessonStore(wsFiles.lessonsPath, 'workspace').listForOwner(owner)
    const history: MemoryHistoryEntry[] = wsFiles
      .listHistoryDates()
      .sort((a, b) => a.localeCompare(b))
      .map(day => ({ day, text: wsFiles.readHistory(day) }))
    return { version: 1, lessons, context: wsFiles.readContext(), preferences, history }
  }, { nativeAction: 'read' })

  // ——— IMPORT(scope, workspaceId, bundle, {mode}) ———
  server.handle(
    RPC_CHANNELS.memory.IMPORT,
    async (
      ctx,
      scope: LessonScope,
      workspaceId: string | null,
      bundle: MemoryExportBundle,
      options?: MemoryImportOptions,
    ): Promise<MemoryImportResult> => {
      const authorizedWorkspaceId = authorizeMemoryWorkspace(ctx, workspaceId, deps)
      const owner = ownerFromContext(ctx)
      const act = rpcMemoryIoActResult({ source: 'native', action: 'write', nativeId: scope ?? 'import' })
      if (!isClaimableLive(act)) throw new Error('memory import is not live')
      assertBundle(bundle)
      if (ctx.principal && typeof bundle.preferences === 'string' && bundle.preferences.length > 0) {
        throw new Error('Machine-private preferences cannot be imported by a personal memory owner')
      }
      const mode = options?.mode ?? 'merge'
      if (mode !== 'merge' && mode !== 'replace') throw new Error(`Invalid import mode: ${String(mode)}`)
      const ts = new Date().toISOString()
      const result: MemoryImportResult = { added: 0, skipped: 0, historyAdded: 0, historySkipped: 0 }

      const globalFiles = new MemoryFileStore('global')
      let wsFiles: MemoryFileStore | null = null
      if (scope === 'workspace') {
        const workspace = authorizedWorkspaceId ? getWorkspaceByNameOrId(authorizedWorkspaceId) : null
        if (!workspace) throw new Error('Workspace not found')
        wsFiles = new MemoryFileStore('workspace', workspace.rootPath)
      }

      const files = scope === 'global' ? globalFiles : wsFiles!
      const store = new LessonStore(files.lessonsPath, scope)
      const lessons = bundle.lessons.map(l => normalizeImportLesson(l, scope, ts, owner))
      if (mode === 'replace') {
        store.replaceForOwner(owner, lessons)
        result.added = lessons.length
      } else {
        const existing = new Set(store.listForOwner(owner).map(l => lessonKey(l.rule)))
        for (const lesson of lessons) {
          if (existing.has(lessonKey(lesson.rule))) {
            result.skipped++
            continue
          }
          store.add(lesson, 'rpc')
          existing.add(lessonKey(lesson.rule))
          result.added++
        }
      }

      // — preferences (global file; bundled by both scopes) —
      const bundlePrefs = typeof bundle.preferences === 'string' ? bundle.preferences : ''
      if (!ctx.principal && mode === 'replace') {
        globalFiles.writePreferences(bundlePrefs)
      } else if (!ctx.principal && bundlePrefs) {
        const current = globalFiles.readPreferences()
        if (!current.includes(bundlePrefs)) {
          globalFiles.writePreferences(current ? `${current.replace(/\n*$/, '')}\n\n${bundlePrefs}` : bundlePrefs)
        }
      }

      // — workspace-only payload: context.md + daily history —
      if (scope === 'workspace' && wsFiles) {
        const bundleContext = typeof bundle.context === 'string' ? bundle.context : ''
        if (mode === 'replace') {
          wsFiles.writeContext(bundleContext)
        } else if (bundleContext) {
          const current = wsFiles.readContext()
          if (!current.includes(bundleContext)) {
            wsFiles.writeContext(current ? `${current.replace(/\n*$/, '')}\n\n${bundleContext}` : bundleContext)
          }
        }

        const entries = (bundle.history ?? []).filter((e): e is MemoryHistoryEntry =>
          Boolean(e && typeof e === 'object' && DAY_RE.test(e.day) && typeof e.text === 'string'),
        )
        const historyDir = wsFiles.memoryDir + '/history'
        if (mode === 'replace') {
          // Rewrite: drop every existing daily file, then write the bundle's.
          if (existsSync(historyDir)) {
            for (const name of readdirSync(historyDir)) {
              if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) {
                try {
                  unlinkSync(join(historyDir, name))
                } catch {
                  // best-effort
                }
              }
            }
          }
        }
        for (const entry of entries) {
          const path = join(historyDir, `${entry.day}.md`)
          if (mode === 'merge' && existsSync(path)) {
            result.historySkipped++
            continue
          }
          // Verbatim write: exported text already carries the `# YYYY-MM-DD`
          // header, so prepending one would duplicate it on round-trip.
          mkdirSync(historyDir, { recursive: true })
          const tmp = join(historyDir, `.${Date.now()}-${process.pid}.import.tmp`)
          writeFileSync(tmp, entry.text.endsWith('\n') ? entry.text : entry.text + '\n')
          renameSync(tmp, path)
          result.historyAdded++
        }
      }

      broadcastChanged(server, scope === 'global' ? null : authorizedWorkspaceId ?? null, scope)
      deps.platform.logger?.info?.(`MEMORY_IMPORT: ${mode} import into ${scope} store (+${result.added} lessons, ${result.skipped} skipped)`)
      return result
    },
    { nativeAction: 'write' },
  )
}
