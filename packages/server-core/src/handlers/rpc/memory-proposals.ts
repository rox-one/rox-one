/**
 * Issue 13 RPC: session-learning memory proposals.
 * Writes a durable lesson only after Global / This project approval.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { getProjectMemoryPath, loadProjectById } from '@rox/shared/projects'
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
} from '@rox/shared/memory/proposals'
import type { RpcServer } from '@rox/server-core/transport'
import { pushTyped } from '@rox/server-core/transport'
import type { PushTarget } from '@rox/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
import {
  isClaimableLive,
  rpcMemoryProposalsActResult,
  rpcMemoryProposalsListResult,
  rpcMemoryProposalsReadResult,
} from '@rox/core/rox2'
import { LessonStore } from '../../memory/LessonStore'
import { MemoryFileStore } from '../../memory/MemoryFileStore'
import { MemoryProposalStore } from '../../memory/MemoryProposalStore'

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

function storeFor(workspaceId: string): { store: MemoryProposalStore; root: string; workspaceId: string } | null {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  const memoryDir = new MemoryFileStore('workspace', workspace.rootPath).memoryDir
  return { store: new MemoryProposalStore(memoryDir), root: workspace.rootPath, workspaceId }
}

function existingRules(workspaceRoot: string): string[] {
  const workspace = new LessonStore(new MemoryFileStore('workspace', workspaceRoot).lessonsPath, 'workspace').list()
  const global = new LessonStore(new MemoryFileStore('global').lessonsPath, 'global').list()
  return [...workspace, ...global].map((l) => l.rule)
}

export function registerMemoryProposalHandlers(server: RpcServer, deps: HandlerDeps): void {
  const broadcast = (workspaceId: string) => {
    const target: PushTarget = { to: 'workspace', workspaceId }
    pushTyped(server, RPC_CHANNELS.memory.CHANGED, target, workspaceId, 'workspace')
  }

  server.handle(RPC_CHANNELS.memory.LIST_PROPOSALS, async (_ctx, workspaceId: string, sessionId?: string) => {
    const listed = rpcMemoryProposalsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const ctx = storeFor(workspaceId)
    if (!ctx) return []
    return ctx.store.list().filter((p) => (!sessionId || p.sessionId === sessionId) && p.status !== 'deleted')
  })

  server.handle(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, async (_ctx, args: ExtractProposalsArgs) => {
    const act = rpcMemoryProposalsActResult({
      source: 'native',
      action: 'write',
      nativeId: args?.sessionId ?? 'extract',
    })
    if (!isClaimableLive(act)) throw new Error('memory extract is not live')
    const ctx = storeFor(args.workspaceId)
    const empty = { proposals: [] as MemoryProposal[], preview: [] as string[], scannedMessages: 0, source: 'none' as const }
    if (!ctx) return { disabled: false, ...empty }
    if (!workspaceMemoryEnabled(ctx.root)) {
      return { disabled: true, ...empty }
    }
    const messages = args.messages ?? []
    const scannedMessages = proposalTranscriptMessages(messages).length
    const rules = existingRules(ctx.root)
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
    const saved = ctx.store.saveMany(extracted)
    broadcast(args.workspaceId)
    return {
      disabled: false,
      proposals: saved.filter((p) => isPendingProposal(p)),
      preview: saved.map((p) => p.text),
      scannedMessages,
      source,
      warning,
    }
  })

  server.handle(
    RPC_CHANNELS.memory.APPROVE_PROPOSAL,
    async (
      _ctx,
      workspaceId: string,
      proposalId: string,
      scope: MemoryProposalScope,
      editedText?: string,
      projectId?: string,
    ) => {
      const read = rpcMemoryProposalsReadResult({ source: 'native', nativeId: proposalId })
      if (!isClaimableLive(read.result)) return null
      const act = rpcMemoryProposalsActResult({ source: 'native', action: 'write', nativeId: proposalId })
      if (!isClaimableLive(act)) return null
      const ctx = storeFor(workspaceId)
      if (!ctx) return null
      const current = ctx.store.get(proposalId)
      if (!current) return null
      const { proposal: next, lesson } = approveProposal({
        proposal: current,
        scope,
        editedText,
        projectId,
      })
      next.conflicts = detectProposalConflicts(next.text, existingRules(ctx.root))
      ctx.store.save(next)
      if (scope === 'project') {
        const project = loadProjectById(ctx.root, projectId ?? next.projectId ?? '')
        if (project) {
          const memoryPath = getProjectMemoryPath(ctx.root, project.config.slug)
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
          source: { sessionId: next.sessionId, trigger: 'explicit' },
        }, 'user')
      }
      broadcast(workspaceId)
      return next
    },
  )

  server.handle(RPC_CHANNELS.memory.REJECT_PROPOSAL, async (_ctx, workspaceId: string, proposalId: string) => {
    const ctx = storeFor(workspaceId)
    if (!ctx) return null
    const current = ctx.store.get(proposalId)
    if (!current) return null
    const next = rejectProposal(current)
    ctx.store.save(next)
    broadcast(workspaceId)
    return next
  })

  server.handle(RPC_CHANNELS.memory.EDIT_PROPOSAL, async (_ctx, workspaceId: string, proposalId: string, text: string) => {
    const ctx = storeFor(workspaceId)
    if (!ctx) return null
    const current = ctx.store.get(proposalId)
    if (!current) return null
    const next = editProposal(current, text)
    next.conflicts = detectProposalConflicts(next.text, existingRules(ctx.root))
    ctx.store.save(next)
    broadcast(workspaceId)
    return next
  })

  server.handle(RPC_CHANNELS.memory.DELETE_PROPOSAL, async (_ctx, workspaceId: string, proposalId: string) => {
    if (!proposalId) return false
    const act = rpcMemoryProposalsActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: proposalId,
    })
    if (!isClaimableLive(act)) return false
    const ctx = storeFor(workspaceId)
    if (!ctx) return false
    const current = ctx.store.get(proposalId)
    if (!current) return false
    ctx.store.save(deleteProposal(current))
    broadcast(workspaceId)
    return true
  })
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
