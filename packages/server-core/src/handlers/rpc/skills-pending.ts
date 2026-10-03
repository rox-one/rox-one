import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import type { PendingSkill, PendingSkillDiff } from '@rox/shared/memory/types'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { pushTyped } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { SkillPendingQueue } from '../../memory/SkillPendingQueue'
import {
  isClaimableLive,
  rpcSkillsPendingActResult,
  rpcSkillsPendingListResult,
  rpcSkillsPendingReadResult,
} from '@rox/core/rox2'
import { assertNativeInboxPath, assertNativeInboxWorkspace, isInboxOwner } from './native-inbox-scope'
import { readNativeConfigurationFile } from './native-workspace-registry'
import type { LessonOwner } from '@rox/shared/memory/types'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skillsPending.LIST,
  RPC_CHANNELS.skillsPending.APPROVE,
  RPC_CHANNELS.skillsPending.DISMISS,
  RPC_CHANNELS.skillsPending.DIFF,
] as const

function queueFor(workspaceId: string, ctx: RequestContext, deps: HandlerDeps, server: RpcServer, action: 'read' | 'write' = 'read') {
  const root = assertNativeInboxWorkspace(ctx, deps, server, workspaceId, action)
  const workspace = root ? { rootPath: root } : getWorkspaceByNameOrId(workspaceId)
  if (!workspace) return null
  if (ctx.principal) {
    assertNativeInboxPath(workspace.rootPath, ['skills', '.pending'], true)
    const pending = join(workspace.rootPath, 'skills', '.pending')
    if (existsSync(pending)) for (const entry of readdirSync(pending, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name)) assertNativeInboxPath(workspace.rootPath, ['skills', entry.name], true)
    }
    if (action === 'write') assertNativeInboxPath(workspace.rootPath, ['memory', 'audit.jsonl'])
  }
  return new SkillPendingQueue(workspace.rootPath)
}

function candidateOwned(queue: SkillPendingQueue, ctx: RequestContext, slug: string): boolean {
  if (!ctx.principal) return true
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return false
  const candidate = readNativeConfigurationFile(join(queue.pendingDir, slug, '.meta.json'))
  return candidate?.slug === slug && isInboxOwner((candidate.source as { owner?: LessonOwner } | undefined)?.owner, ctx)
}

function ownCandidate(queue: SkillPendingQueue, ctx: RequestContext, slug: string): void {
  if (!ctx.principal) return
  if (!candidateOwned(queue, ctx, slug)) throw new Error('Skill candidate access denied')
  const approved = readNativeConfigurationFile(join(queue.skillsDir, slug, '.meta.json'))
  if (existsSync(join(queue.skillsDir, slug)) && (!approved || !isInboxOwner((approved.source as { owner?: LessonOwner } | undefined)?.owner, ctx))) throw new Error('Approved skill access denied')
}

export function registerSkillsPendingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const broadcastChanged = (workspaceId: string): void => {
    pushTyped(server, RPC_CHANNELS.skillsPending.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  }

  // List distilled skill candidates awaiting approval.
  server.handle(RPC_CHANNELS.skillsPending.LIST, async (ctx, workspaceId: string): Promise<PendingSkill[]> => {
    const listed = rpcSkillsPendingListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return []
    const queue = queueFor(workspaceId, ctx, deps, server)
    if (!queue) {
      deps.platform.logger?.error(`SKILLS_PENDING_LIST: Workspace not found: ${workspaceId}`)
      return []
    }
    return queue.list().filter(candidate => isInboxOwner(candidate.source.owner, ctx) && candidateOwned(queue, ctx, candidate.slug))
  }, { nativeAction: 'read' })

  // Approve a candidate: moves it from skills/.pending/<slug>/ to skills/<slug>/,
  // or — for update candidates — snapshots the live skill into .versions/ and
  // overwrites its SKILL.md. S2: candidates with script-validation violations
  // are rejected unless force=true.
  server.handle(RPC_CHANNELS.skillsPending.APPROVE, async (ctx, workspaceId: string, slug: string, force?: boolean) => {
    const act = rpcSkillsPendingActResult({ source: 'native', action: 'write', nativeId: slug })
    if (!isClaimableLive(act)) throw new Error('skills-pending approve is not live')
    const queue = queueFor(workspaceId, ctx, deps, server, 'write')
    if (!queue) throw new Error('Workspace not found')
    ownCandidate(queue, ctx, slug)
    queue.approve(slug, { force: force === true })
    deps.platform.logger?.info(`SKILLS_PENDING_APPROVE: approved '${slug}' in ${workspaceId}`)
    broadcastChanged(workspaceId)
    return true
  }, { nativeAction: 'write' })

  // Diff a candidate against the approved skill it updates (base is null for
  // brand-new candidates).
  server.handle(RPC_CHANNELS.skillsPending.DIFF, async (ctx, workspaceId: string, slug: string): Promise<PendingSkillDiff> => {
    const read = rpcSkillsPendingReadResult({ source: 'native', nativeId: slug })
    if (!isClaimableLive(read.result)) throw new Error('skills-pending diff is not live')
    const queue = queueFor(workspaceId, ctx, deps, server)
    if (!queue) throw new Error('Workspace not found')
    ownCandidate(queue, ctx, slug)
    return queue.diff(slug)
  }, { nativeAction: 'read' })

  // Dismiss a candidate: removes it and logs it for anti-repeat.
  server.handle(RPC_CHANNELS.skillsPending.DISMISS, async (ctx, workspaceId: string, slug: string, description?: string) => {
    if (!slug) throw new Error('slug is required')
    const act = rpcSkillsPendingActResult({ source: 'native', action: 'destroy', granted: true, nativeId: slug })
    if (!isClaimableLive(act)) throw new Error('skills-pending dismiss is not live')
    const queue = queueFor(workspaceId, ctx, deps, server, 'write')
    if (!queue) throw new Error('Workspace not found')
    ownCandidate(queue, ctx, slug)
    queue.dismiss(slug, description)
    deps.platform.logger?.info(`SKILLS_PENDING_DISMISS: dismissed '${slug}' in ${workspaceId}`)
    broadcastChanged(workspaceId)
    return true
  }, { nativeAction: 'write' })
}
