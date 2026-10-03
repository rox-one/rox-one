/**
 * Issue 13 RPC: session-learning memory proposals.
 * Writes a durable lesson only after Global / This project approval.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getProjectMemoryPath, loadProjectById } from '@craft-agent/shared/projects'
import {
  approveProposal,
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
} from '@craft-agent/shared/memory/proposals'
import type { RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { PushTarget } from '@craft-agent/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcMemoryProposalsActResult,
  rpcMemoryProposalsListResult,
  rpcMemoryProposalsReadResult,
} from '@craft-agent/core/rox2'
import { LessonStore } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { MemoryProposalStore } from '../../memory/MemoryProposalStore'
import { assertNativeInboxPath, assertNativeInboxWorkspace, isInboxOwner, nativeInboxOwner } from './native-inbox-scope'
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

function existingRules(workspaceRoot: string, request: RequestContext): string[] {
  if (request.principal) assertNativeInboxPath(dirname(new MemoryFileStore('global').memoryDir), ['memory'], true)
  const owner = nativeInboxOwner(request)
  if (request.principal) assertNativeInboxPath(workspaceRoot, ['memory', 'lessons.jsonl'])
  const workspaceStore = new LessonStore(new MemoryFileStore('workspace', workspaceRoot).lessonsPath, 'workspace')
  const globalStore = new LessonStore(new MemoryFileStore('global').lessonsPath, 'global')
  const workspace = request.principal ? workspaceStore.listForOwner(owner) : workspaceStore.list()
  const global = request.principal ? globalStore.listForOwner(owner) : globalStore.list()
  return [...workspace, ...global].map((l) => l.rule)
}

export function registerMemoryProposalHandlers(server: RpcServer, deps: HandlerDeps): void {
  const broadcast = (workspaceId: string) => {
    const target: PushTarget = { to: 'workspace', workspaceId }
    pushTyped(server, RPC_CHANNELS.memory.CHANGED, target, workspaceId, 'workspace')
  }

  server.handle(RPC_CHANNELS.memory.LIST_PROPOSALS, async (request, workspaceId: string, sessionId?: string) => {
    const listed = rpcMemoryProposalsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const ctx = storeFor(workspaceId, request, deps, server)
    if (!ctx) return []
    return ctx.store.list().filter((p) => isInboxOwner(p.owner, request) && (!request.principal || p.workspaceId === workspaceId) && (!sessionId || p.sessionId === sessionId) && p.status !== 'deleted')
  }, { nativeAction: 'read' })

  server.handle(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, async (request, args: ExtractProposalsArgs) => {
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
    const rules = existingRules(ctx.root, request)
    const input = {
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      trigger: args.trigger,
      messages,
      existingRules: rules,
    }
    const { extracted, source, warning } = await extractWithLlmFallback(
      input,
      deps.sessionManager?.querySessionLlm?.bind(deps.sessionManager),
    )
    assertNativeInboxWorkspace(request, deps, server, args.workspaceId, 'write', ctx.root)
    if (request.principal) assertNativeInboxPath(ctx.root, ['memory', 'proposals.jsonl'])
    const owner = nativeInboxOwner(request)
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
  }, { nativeAction: 'write' })

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
      if (scope !== 'global' && scope !== 'project') throw new Error('Invalid memory proposal scope')
      const read = rpcMemoryProposalsReadResult({ source: 'native', nativeId: proposalId })
      if (!isClaimableLive(read.result)) return null
      const act = rpcMemoryProposalsActResult({ source: 'native', action: 'write', nativeId: proposalId })
      if (!isClaimableLive(act)) return null
      const ctx = storeFor(workspaceId, request, deps, server, 'write')
      if (!ctx) return null
      const current = ctx.store.get(proposalId)
      if (!current || !isInboxOwner(current.owner, request) || request.principal && current.workspaceId !== workspaceId) return null
      const { proposal: next, lesson } = approveProposal({
        proposal: current,
        scope,
        editedText,
        projectId,
      })
      next.conflicts = detectProposalConflicts(next.text, existingRules(ctx.root, request))
      if (scope === 'project') {
        const project = request.principal ? readNativeProjects(ctx.root, workspaceId).find(project => project.config.id === (projectId ?? next.projectId ?? '')) : loadProjectById(ctx.root, projectId ?? next.projectId ?? '')
        if (!project && request.principal) throw new Error('Project not found')
        if (project) {
          const memoryPath = getProjectMemoryPath(ctx.root, project.config.slug)
          if (request.principal) assertNativeInboxPath(ctx.root, ['projects', project.config.slug], true)
          mkdirSync(dirname(memoryPath), { recursive: true })
          appendFileSync(
            memoryPath,
            `\n- ${next.text} (session ${next.sessionId}; consent ${next.provenance.consentEventId ?? ''})\n`,
          )
        }
      } else if (lesson) {
        const lessonStore = new LessonStore(new MemoryFileStore('global').lessonsPath, 'global')
        lessonStore.add({
          ts: next.updatedAt,
          rule: lesson.rule,
          category: lesson.category,
          scope: 'global',
          ...(nativeInboxOwner(request) ? { owner: nativeInboxOwner(request) } : {}),
          source: { sessionId: next.sessionId, trigger: 'explicit' },
        }, 'user')
      }
      ctx.store.save(next)
      broadcast(workspaceId)
      return next
    },
    { nativeAction: 'write' },
  )

  server.handle(RPC_CHANNELS.memory.REJECT_PROPOSAL, async (request, workspaceId: string, proposalId: string) => {
    const ctx = storeFor(workspaceId, request, deps, server, 'write')
    if (!ctx) return null
    const current = ctx.store.get(proposalId)
    if (!current || !isInboxOwner(current.owner, request) || request.principal && current.workspaceId !== workspaceId) return null
    const next = rejectProposal(current)
    ctx.store.save(next)
    broadcast(workspaceId)
    return next
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.memory.EDIT_PROPOSAL, async (request, workspaceId: string, proposalId: string, text: string) => {
    const ctx = storeFor(workspaceId, request, deps, server, 'write')
    if (!ctx) return null
    const current = ctx.store.get(proposalId)
    if (!current || !isInboxOwner(current.owner, request) || request.principal && current.workspaceId !== workspaceId) return null
    const next = editProposal(current, text)
    next.conflicts = detectProposalConflicts(next.text, existingRules(ctx.root, request))
    ctx.store.save(next)
    broadcast(workspaceId)
    return next
  }, { nativeAction: 'write' })

  server.handle(RPC_CHANNELS.memory.DELETE_PROPOSAL, async (request, workspaceId: string, proposalId: string) => {
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
    const current = ctx.store.get(proposalId)
    if (!current || !isInboxOwner(current.owner, request) || request.principal && current.workspaceId !== workspaceId) return false
    ctx.store.save(deleteProposal(current))
    broadcast(workspaceId)
    return true
  }, { nativeAction: 'write' })
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
