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
  deleteProposal,
  detectProposalConflicts,
  editProposal,
  extractProposalsFromTranscript,
  isPendingProposal,
  rejectProposal,
  type MemoryProposal,
  type MemoryProposalScope,
  type MemoryProposalTrigger,
  type TranscriptMessage,
} from '@craft-agent/shared/memory/proposals'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { pushTyped } from '@craft-agent/server-core/transport'
import type { PushTarget } from '@craft-agent/shared/protocol'
import type { HandlerDeps } from '../handler-deps'
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
export const HANDLED_CHANNELS = PROPOSAL_HANDLED_CHANNELS

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
    const ctx = storeFor(workspaceId)
    if (!ctx) return []
    return ctx.store.list().filter((p) => (!sessionId || p.sessionId === sessionId) && p.status !== 'deleted')
  })

  server.handle(RPC_CHANNELS.memory.EXTRACT_PROPOSALS, async (_ctx, args: ExtractProposalsArgs) => {
    const ctx = storeFor(args.workspaceId)
    if (!ctx) return { disabled: false, proposals: [] as MemoryProposal[], preview: [] as string[] }
    if (!workspaceMemoryEnabled(ctx.root)) {
      return { disabled: true, proposals: [] as MemoryProposal[], preview: [] as string[] }
    }
    const extracted = extractProposalsFromTranscript({
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      trigger: args.trigger,
      messages: args.messages ?? [],
      existingRules: existingRules(ctx.root),
    })
    const saved = ctx.store.saveMany(extracted)
    broadcast(args.workspaceId)
    return {
      disabled: false,
      proposals: saved.filter((p) => isPendingProposal(p)),
      preview: saved.map((p) => p.text),
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
    const ctx = storeFor(workspaceId)
    if (!ctx) return false
    const current = ctx.store.get(proposalId)
    if (!current) return false
    ctx.store.save(deleteProposal(current))
    broadcast(workspaceId)
    return true
  })
}
