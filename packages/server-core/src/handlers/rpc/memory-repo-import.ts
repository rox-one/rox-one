/**
 * RPC bridge for memory-repository edit imports (Wave A, WP-06).
 *
 * Importable edits become reviewable `MemoryProposal` rows — never direct
 * lesson writes. Approving a proposal stays the existing
 * `approveMemoryProposalDurably` path. Revert disables + archives through the
 * existing `LessonStore.update` path and records one proposal for audit.
 *
 * Bank data (working-tree files + the known lesson projection) comes from an
 * injected runtime accessor so the handler stays testable and the server-core
 * repo service owns fs/git.
 */
import { createHash } from 'node:crypto'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import type { MemoryRepoImportEdit, MemoryRepoImportPreview } from '@rox/shared/memory/repo'
import { estimateProposalTokens, type MemoryProposal } from '@rox/shared/memory/proposals'
import type { LessonOwner } from '@rox/shared/memory/types'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { authorizeMemoryRepoBank, lessonOwnerFromContext } from './memory'
import { LessonStore } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { MemoryProposalStore } from '../../memory/MemoryProposalStore'
import { parseBankId, ownerKey8For } from '../../memory/repo/RepoSourceProvider'
import { parseRepoEdits, repoRuleHash, type RepoImportKnownLesson } from '../../memory/repo/repo-import-parser'
import { notifyRepoMutation } from '../../memory/repo/notify'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT,
  RPC_CHANNELS.memory.REPO_APPLY_IMPORT,
  RPC_CHANNELS.memory.REPO_REVERT_IMPORT,
] as const

/** Everything the import handlers need about one bank, resolved from the runtime. */
export interface MemoryRepoImportRuntime {
  bankId: string
  scope: 'main' | 'workspace'
  /** Workspace id for `ws:<id>` banks; null for `main`. */
  workspaceId: string | null
  /** Workspace root for workspace-scope lesson stores; absent for `main`. */
  workspaceRoot?: string
  /** Directory holding the bank's `proposals.jsonl`. */
  memoryDir: string
  files: Array<{ path: string; content: string }>
  known: RepoImportKnownLesson[]
}

export type MemoryRepoImportRuntimeAccessor = (bankId: string) => Promise<MemoryRepoImportRuntime | null>

export interface MemoryRepoImportDeps extends HandlerDeps {
  /** Injected runtime accessor (server-core wires it to MemoryRepoService + provider). */
  memoryRepoImport?: MemoryRepoImportRuntimeAccessor
}

export interface MemoryRepoImportApplyArgs {
  paths?: string[]
  /** Confirm `conflict:'rule-changed'` edits instead of skipping them. */
  override?: boolean
}

export interface MemoryRepoImportApplyResult {
  bankId: string
  added: number
  skipped: Array<{ path: string; conflict: string }>
  proposalIds: string[]
}

export interface MemoryRepoImportRevertTarget {
  lessonId?: string
  rule?: string
  path?: string
}

export interface MemoryRepoImportRevertResult {
  bankId: string
  proposal: MemoryProposal
  disabled: boolean
}

function proposalId(prefix: string, bankId: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha1').update([bankId, ...parts].join('\u0000')).digest('hex').slice(0, 20)}`
}

function importEditProposal(
  edit: MemoryRepoImportEdit,
  bankId: string,
  runtime: MemoryRepoImportRuntime,
  owner: LessonOwner | undefined,
  now: Date,
): MemoryProposal {
  const text = edit.rule ?? ''
  const riskFlags = ['repo-import', `repo-edit:${edit.kind}`]
  if (edit.conflict) riskFlags.push(`repo-conflict:${edit.conflict}`)
  return {
    ...(owner ? { owner } : {}),
    id: proposalId('mprip', bankId, edit.path, repoRuleHash(text)),
    text,
    kind: 'rule',
    status: 'pending',
    sessionId: `repo:${bankId}`,
    workspaceId: runtime.workspaceId ?? runtime.bankId,
    sourceMessageIds: [],
    provenance: { trigger: 'brain' },
    riskFlags,
    conflicts: [],
    editHistory: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    cost: { tokens: estimateProposalTokens(text), model: 'rox/repo' },
  }
}

function revertProposal(
  lesson: RepoImportKnownLesson,
  bankId: string,
  runtime: MemoryRepoImportRuntime,
  owner: LessonOwner | undefined,
  now: Date,
): MemoryProposal {
  return {
    ...(owner ? { owner } : {}),
    id: proposalId('mprev', bankId, lesson.lessonId, repoRuleHash(lesson.rule)),
    text: lesson.rule,
    kind: 'rule',
    status: 'pending',
    sessionId: `repo:${bankId}`,
    workspaceId: runtime.workspaceId ?? runtime.bankId,
    sourceMessageIds: [],
    provenance: { trigger: 'brain' },
    riskFlags: ['repo-import', 'repo-revert', 'disable', 'archive'],
    conflicts: [],
    editHistory: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    cost: { tokens: estimateProposalTokens(lesson.rule), model: 'rox/repo' },
  }
}

function resolveRevertTarget(
  known: RepoImportKnownLesson[],
  target: MemoryRepoImportRevertTarget | undefined,
): RepoImportKnownLesson | null {
  if (target?.lessonId) return known.find((lesson) => lesson.lessonId === target.lessonId) ?? null
  if (target?.path) return known.find((lesson) => lesson.path === target.path) ?? null
  if (target?.rule) {
    const needle = target.rule.trim()
    return known.find((lesson) => lesson.rule.trim() === needle) ?? null
  }
  return known.length === 1 ? known[0]! : null
}

export function registerMemoryRepoImportHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  runtime?: MemoryRepoImportRuntimeAccessor,
): void {
  const accessor = runtime ?? (deps as MemoryRepoImportDeps).memoryRepoImport
  const authorize = (ctx: RequestContext, bankId: string): { bankId: string; workspaceId: string | null } => {
    const canonical = authorizeMemoryRepoBank(ctx, bankId, deps)
    const parsed = parseBankId(canonical)
    return { bankId: canonical, workspaceId: parsed.scope === 'workspace' ? parsed.workspaceId ?? null : null }
  }
  const loadRuntime = async (bankId: string, workspaceId: string | null): Promise<MemoryRepoImportRuntime> => {
    const resolved = accessor ? await accessor(bankId) : null
    if (!resolved) throw new Error('Memory repo bank not found')
    if (resolved.workspaceId !== workspaceId) throw new Error('Workspace access denied')
    return resolved
  }

  server.handle(
    RPC_CHANNELS.memory.REPO_PREVIEW_IMPORT,
    async (ctx, bankId: string): Promise<MemoryRepoImportPreview> => {
      const auth = authorize(ctx, bankId)
      const bank = auth.bankId
      const runtime = await loadRuntime(bank, auth.workspaceId)
      const edits = parseRepoEdits({ bankId: bank, files: runtime.files, known: runtime.known })
      const existing = new Set(new MemoryProposalStore(runtime.memoryDir).list().map((proposal) => proposal.id))
      const annotated = edits.map((edit) => {
        const id = proposalId('mprip', bank, edit.path, repoRuleHash(edit.rule ?? ''))
        return existing.has(id) ? { ...edit, proposalId: id } : edit
      })
      return { bankId: bank, edits: annotated, conflicts: edits.filter((edit) => Boolean(edit.conflict)).length }
    },
    { nativeAction: 'read' },
  )

  server.handle(
    RPC_CHANNELS.memory.REPO_APPLY_IMPORT,
    async (
      ctx,
      bankId: string,
      args?: MemoryRepoImportApplyArgs | string[],
      overrideArg?: boolean,
    ): Promise<MemoryRepoImportApplyResult> => {
      const auth = authorize(ctx, bankId)
      const bank = auth.bankId
      const runtime = await loadRuntime(bank, auth.workspaceId)
      const owner = lessonOwnerFromContext(ctx)
      const override = Array.isArray(args) ? Boolean(overrideArg) : Boolean(args?.override)
      const paths = Array.isArray(args) ? args : args?.paths
      const selected = paths && paths.length > 0 ? new Set(paths) : null
      const edits = parseRepoEdits({ bankId: bank, files: runtime.files, known: runtime.known })
        .filter((edit) => !selected || selected.has(edit.path))
      const store = new MemoryProposalStore(runtime.memoryDir)
      const now = new Date()
      const existing = new Set(store.list().map((proposal) => proposal.id))
      const created: MemoryProposal[] = []
      const skipped: Array<{ path: string; conflict: string }> = []
      for (const edit of edits) {
        if (edit.conflict && !override) {
          skipped.push({ path: edit.path, conflict: edit.conflict })
          continue
        }
        const proposal = importEditProposal(edit, bank, runtime, owner, now)
        if (existing.has(proposal.id)) continue
        existing.add(proposal.id)
        created.push(proposal)
      }
      if (created.length > 0) store.saveMany(created)
      return { bankId: bank, added: created.length, skipped, proposalIds: created.map((proposal) => proposal.id) }
    },
    { nativeAction: 'write' },
  )

  server.handle(
    RPC_CHANNELS.memory.REPO_REVERT_IMPORT,
    async (
      ctx,
      bankId: string,
      target?: MemoryRepoImportRevertTarget,
    ): Promise<MemoryRepoImportRevertResult> => {
      const auth = authorize(ctx, bankId)
      const bank = auth.bankId
      const runtime = await loadRuntime(bank, auth.workspaceId)
      const owner = lessonOwnerFromContext(ctx)
      const lesson = resolveRevertTarget(runtime.known, target)
      if (!lesson) throw new Error('Memory repo revert target not found')

      // Disable through the existing store/update path (never a direct file write).
      const scope = runtime.scope === 'workspace' ? 'workspace' : 'global'
      const lessonStore = new LessonStore(new MemoryFileStore(scope, runtime.workspaceRoot).lessonsPath, scope)
      const updated = lessonStore.update(lesson.rule, { disabled: true }, 'user', owner)

      const store = new MemoryProposalStore(runtime.memoryDir)
      const proposal = store.get(proposalId('mprev', bank, lesson.lessonId, repoRuleHash(lesson.rule)))
        ?? revertProposal(lesson, bank, runtime, owner, new Date())
      store.save(proposal)
      // `{disabled:true}` is a projected lesson field: after a successful update,
      // re-materialize the owner-scoped bank that was actually written.
      if (updated) {
        const ownerKey8 = owner ? ownerKey8For(owner) : undefined
        notifyRepoMutation(
          runtime.scope === 'workspace'
            ? { scope: 'workspace', workspaceId: runtime.workspaceId ?? '', ...(ownerKey8 ? { ownerKey8 } : {}) }
            : { scope: 'main', ...(ownerKey8 ? { ownerKey8 } : {}) },
          'repoRevertImport',
        )
      }
      return { bankId: bank, proposal, disabled: Boolean(updated) }
    },
    { nativeAction: 'write' },
  )
}