/**
 * Issue 13 RPC: session-learning memory proposals.
 * Writes a durable lesson only after Global / This project approval.
 */
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import {
  buildProposalExtractionPrompt,
  deleteProposal,
  detectProposalConflicts,
  editProposal,
  extractProposalsFromTranscript,
  isPendingProposal,
  parseProposalExtractionResponse,
  proposalTranscriptMessages,
  proposalsFromLlmCandidates,
  rejectProposal,
  ROX_PROPOSAL_MODEL_POLICY,
  type MemoryProposal,
  type MemoryProposalScope,
  type MemoryProposalTrigger,
  type TranscriptMessage,
} from '@rox/shared/memory/proposals'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import { pushTyped } from '@rox/server-core/transport'
import type { PushTarget } from '@rox/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcMemoryProposalsActResult,
  rpcMemoryProposalsListResult,
  rpcMemoryProposalsReadResult,
} from '@rox/core/rox2'
import { LessonStore, lessonOwnerKey } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { MemoryProposalStore } from '../../memory/MemoryProposalStore'
import { approveMemoryProposalDurably } from '../../memory/approve-memory-proposal'
import type { LessonOwner } from '@rox/shared/memory/types'
import { assertNativeInboxPath, assertNativeInboxWorkspace } from './native-inbox-scope'
import { assertNativeSession } from './native-session-scope'
import { readNativeProjects } from './native-sidebar-metadata'

export const PROPOSAL_HANDLED_CHANNELS = [
  RPC_CHANNELS.memory.LIST_PROPOSALS,
  RPC_CHANNELS.memory.EXTRACT_PROPOSALS,
  RPC_CHANNELS.memory.APPROVE_PROPOSAL,
  RPC_CHANNELS.memory.REJECT_PROPOSAL,
  RPC_CHANNELS.memory.EDIT_PROPOSAL,
  RPC_CHANNELS.memory.DELETE_PROPOSAL,
] as const

export interface ExtractProposalsArgs {
  workspaceId: string
  sessionId: string
  projectId?: string
  trigger: MemoryProposalTrigger
  messages: TranscriptMessage[]
}

function workspaceMemoryEnabled(workspaceRoot: string): boolean {
  const configPath = join(workspaceRoot, 'config.json')
  if (!existsSync(configPath)) return true
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as { memory?: { enabled?: boolean; proposalsEnabled?: boolean } }
    if (parsed.memory?.proposalsEnabled === false) return false
    if (parsed.memory?.enabled === false) return false
    return true
  } catch {
    return true
  }
}

function storeFor(workspaceId: string, request: RequestContext, deps: HandlerDeps, server: RpcServer, action: 'read' | 'write' | 'delete' = 'read'): { store: MemoryProposalStore; root: string; workspaceId: string } | null {
  const root = assertNativeInboxWorkspace(request, deps, server, workspaceId, action)
  const workspace = root ? { rootPath: root } : getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  if (request.principal) {
    assertNativeInboxPath(workspace.rootPath, ['memory', 'proposals.jsonl'])
    assertNativeInboxPath(workspace.rootPath, ['memory', 'proposals.jsonl.tmp'])
  }
  const memoryDir = new MemoryFileStore('workspace', workspace.rootPath).memoryDir
  return { store: new MemoryProposalStore(memoryDir), root: workspace.rootPath, workspaceId }
}

function existingRules(workspaceRoot: string, owner?: LessonOwner): string[] {
  if (owner) {
    assertNativeInboxPath(dirname(new MemoryFileStore('global').memoryDir), ['memory'], true)
    assertNativeInboxPath(workspaceRoot, ['memory', 'lessons.jsonl'])
  }
  const workspace = new LessonStore(new MemoryFileStore('workspace', workspaceRoot).lessonsPath, 'workspace').listForOwner(owner)
  const global = new LessonStore(new MemoryFileStore('global').lessonsPath, 'global').listForOwner(owner)
  return [...workspace, ...global].map((l) => l.rule)
}

function authorizeWorkspace(ctx: RequestContext, workspaceId: string, deps: HandlerDeps): LessonOwner | undefined {
  const bound = ctx.workspaceId ?? (ctx.webContentsId != null ? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) : undefined)
  if ((bound && bound !== workspaceId) || (ctx.principal && !bound)) throw new Error('Workspace access denied')
  return ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : undefined
}

function writableProposal(store: MemoryProposalStore, id: string, workspaceId: string, owner?: LessonOwner): MemoryProposal | null {
  const proposal = store.get(id)
  if (!proposal) return null
  if (proposal.workspaceId !== workspaceId) throw new Error('Memory proposal workspace access denied')
  if (lessonOwnerKey(proposal.owner) !== lessonOwnerKey(owner)) return null
  if (proposal.approval || proposal.status.startsWith('approved_')) throw new Error('An approval has already started; retry approval to finish it')
  return proposal
}

export function registerMemoryProposalHandlers(server: RpcServer, deps: HandlerDeps): void {
  const broadcast = (workspaceId: string) => {
    const target: PushTarget = { to: 'workspace', workspaceId }
    pushTyped(server, RPC_CHANNELS.memory.CHANGED, target, workspaceId, 'workspace')
  }

  server.handle(RPC_CHANNELS.memory.LIST_PROPOSALS, async (request, workspaceId: string, sessionId?: string) => {
    const owner = authorizeWorkspace(request, workspaceId, deps)
    const listed = rpcMemoryProposalsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const ctx = storeFor(workspaceId, request, deps, server)
    if (!ctx) return []
    return ctx.store.list().filter((p) => p.workspaceId === workspaceId && lessonOwnerKey(p.owner) === lessonOwnerKey(owner)
      && (!sessionId || p.sessionId === sessionId) && p.status !== 'deleted')
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, async (request, args: ExtractProposalsArgs) => {
    const owner = authorizeWorkspace(request, args.workspaceId, deps)
    const act = rpcMemoryProposalsActResult({
      source: 'native',
      action: 'write',
      nativeId: args?.sessionId ?? 'extract',
    })
    if (!isClaimableLive(act)) throw new Error('memory extract is not live')
    const ctx = storeFor(args.workspaceId, request, deps, server, 'write')
    const empty = { proposals: [] as MemoryProposal[], preview: [] as string[], scannedMessages: 0, source: 'none' as const }
    if (!ctx) return { disabled: false, ...empty }
    if (!workspaceMemoryEnabled(ctx.root)) {
      return { disabled: true, ...empty }
    }
    let messages = args.messages ?? []
    if (request.principal) {
      assertNativeSession(request, deps, server, args.sessionId)
      const session = await deps.sessionManager.getSession(args.sessionId)
      assertNativeInboxWorkspace(request, deps, server, args.workspaceId, 'write', ctx.root)
      messages = (session?.messages ?? []).filter(message => !message.hidden && (message.role === 'user' || message.role === 'assistant')).map(message => ({ id: message.id, role: message.role, content: message.content }))
    }
    const scannedMessages = proposalTranscriptMessages(messages).length
    const query = deps.sessionManager?.querySessionLlm?.bind(deps.sessionManager)
    // The request's workspace grant cannot authorize a one-shot connection
    // selected by a session ID from another workspace.
    if (request.principal || query) {
      const sessions = deps.sessionManager?.getSessions?.(args.workspaceId) ?? []
      if (!sessions.some(session => session.id === args.sessionId && session.workspaceId === args.workspaceId)) {
        throw new Error('Memory session workspace access denied')
      }
    }
    const rules = existingRules(ctx.root, owner)
    const input = {
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      trigger: args.trigger,
      messages,
      existingRules: rules,
    }
    if (server.isRequestContextCurrent && !server.isRequestContextCurrent(request, 'write')) throw new Error('Memory request is no longer authorized')
    const { extracted, source, warning } = await extractWithLlmFallback(input, query)
    if (server.isRequestContextCurrent && !server.isRequestContextCurrent(request, 'write')) throw new Error('Memory request is no longer authorized')
    assertNativeInboxWorkspace(request, deps, server, args.workspaceId, 'write', ctx.root)
    if (request.principal) assertNativeInboxPath(ctx.root, ['memory', 'proposals.jsonl'])
    const saved = ctx.store.saveMany(extracted.map(proposal => ({ ...proposal, ...(owner ? { owner } : {}) })))
    broadcast(args.workspaceId)
    return {
      disabled: false,
      proposals: saved.filter((p) => isPendingProposal(p)),
      preview: saved.map((p) => p.text),
      scannedMessages,
      source,
      warning,
    }
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  server.handle(
    RPC_CHANNELS.memory.APPROVE_PROPOSAL,
    async (
      request,
      workspaceId: string,
      proposalId: string,
      scope: MemoryProposalScope,
      editedText?: string,
      projectId?: string,
    ) => {
      const owner = authorizeWorkspace(request, workspaceId, deps)
      const read = rpcMemoryProposalsReadResult({ source: 'native', nativeId: proposalId })
      if (!isClaimableLive(read.result)) return null
      const act = rpcMemoryProposalsActResult({ source: 'native', action: 'write', nativeId: proposalId })
      if (!isClaimableLive(act)) return null
      const ctx = storeFor(workspaceId, request, deps, server, 'write')
      if (!ctx) return null
      const current = ctx.store.get(proposalId)
      if (current && current.workspaceId !== workspaceId) throw new Error('Memory proposal workspace access denied')
      if (request.principal) {
        if (scope === 'project') {
          const project = readNativeProjects(ctx.root, workspaceId).find(project => project.config.id === (projectId ?? current?.projectId ?? ''))
          if (!project) throw new Error('Project memory target not found')
          assertNativeInboxPath(ctx.root, ['projects', project.config.slug], true)
        } else if (scope === 'workspace') assertNativeInboxPath(ctx.root, ['memory'], true)
        else assertNativeInboxPath(dirname(new MemoryFileStore('global').memoryDir), ['memory'], true)
      }
      const next = approveMemoryProposalDurably({
        store: ctx.store,
        workspaceRoot: ctx.root,
        proposalId,
        scope,
        editedText,
        projectId,
        owner,
      })
      broadcast(workspaceId)
      return next
    },
    { access: 'nativeOrLocalElectron', nativeAction: 'write' },
  )

  server.handle(RPC_CHANNELS.memory.REJECT_PROPOSAL, async (request, workspaceId: string, proposalId: string) => {
    const owner = authorizeWorkspace(request, workspaceId, deps)
    const ctx = storeFor(workspaceId, request, deps, server, 'write')
    if (!ctx) return null
    const current = writableProposal(ctx.store, proposalId, workspaceId, owner)
    if (!current) return null
    const next = rejectProposal(current)
    ctx.store.save(next)
    broadcast(workspaceId)
    return next
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.memory.EDIT_PROPOSAL, async (request, workspaceId: string, proposalId: string, text: string) => {
    const owner = authorizeWorkspace(request, workspaceId, deps)
    const ctx = storeFor(workspaceId, request, deps, server, 'write')
    if (!ctx) return null
    const current = writableProposal(ctx.store, proposalId, workspaceId, owner)
    if (!current) return null
    const next = editProposal(current, text)
    next.conflicts = detectProposalConflicts(next.text, existingRules(ctx.root, owner))
    ctx.store.save(next)
    broadcast(workspaceId)
    return next
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })

  server.handle(RPC_CHANNELS.memory.DELETE_PROPOSAL, async (request, workspaceId: string, proposalId: string) => {
    const owner = authorizeWorkspace(request, workspaceId, deps)
    if (!proposalId) return false
    const act = rpcMemoryProposalsActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: proposalId,
    })
    if (!isClaimableLive(act)) return false
    const ctx = storeFor(workspaceId, request, deps, server, 'write')
    if (!ctx) return false
    const current = writableProposal(ctx.store, proposalId, workspaceId, owner)
    if (!current) return false
    ctx.store.save(deleteProposal(current))
    broadcast(workspaceId)
    return true
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })
}

type SessionLlmQuery = (
  sessionId: string,
  request: { prompt: string; systemPrompt?: string; maxTokens?: number; temperature?: number },
  options?: { preferFastModel?: boolean },
) => Promise<{ text: string; model?: string; warning?: string }>

/**
 * Real LLM extraction (rox/fast or the connection's mini model) with the
 * regex extractor as fallback. The LLM error is returned as `warning` so the
 * renderer can show it instead of silently showing nothing.
 */
export async function extractWithLlmFallback(
  input: Parameters<typeof extractProposalsFromTranscript>[0],
  query: SessionLlmQuery | undefined,
): Promise<{ extracted: MemoryProposal[]; source: 'llm' | 'regex' | 'none'; warning?: string }> {
  if (proposalTranscriptMessages(input.messages).length === 0) {
    return { extracted: [], source: 'none' }
  }
  let warning: string | undefined
  if (query) {
    try {
      const built = buildProposalExtractionPrompt(input.messages, input.existingRules ?? [])
      const result = await query(
        input.sessionId,
        { systemPrompt: built.systemPrompt, prompt: built.prompt, maxTokens: 1024, temperature: 0 },
        { preferFastModel: true },
      )
      const candidates = parseProposalExtractionResponse(result.text, built.indexToMessageId)
      if (candidates === null) throw new Error('The model answer could not be read as a list of memories')
      return {
        extracted: proposalsFromLlmCandidates(input, candidates, result.model ?? ROX_PROPOSAL_MODEL_POLICY.model),
        source: 'llm',
      }
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error)
    }
  }
  return { extracted: extractProposalsFromTranscript(input), source: 'regex', warning }
}
