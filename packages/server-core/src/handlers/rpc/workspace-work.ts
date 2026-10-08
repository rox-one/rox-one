import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { getLocalIdentity } from '@rox/shared/orgs'
import { loadProjectById } from '@rox/shared/projects'
import { loadPageById } from '@rox/shared/pages'
import { loadSource } from '@rox/shared/sources'
import { loadSkillBySlug } from '@rox/shared/skills'
import type { WorkspaceTaskLink } from '@rox/shared/workspace-work'
import { pushTyped, type RpcServer, type RequestContext } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { WorkspaceWorkStore } from '../../workspace-work/store.ts'
import { WorkspaceWorkService, type WorkspaceWorkActor } from '../../workspace-work/service.ts'
import { validateWorkspaceId } from '../../workspace-work/validation.ts'

export const WORKSPACE_WORK_HANDLED_CHANNELS = [RPC_CHANNELS.workspaceWork.READ, RPC_CHANNELS.workspaceWork.WRITE,
  RPC_CHANNELS.workspaceWork.DELETE, RPC_CHANNELS.workspaceWork.SNAPSHOT_PROFILE] as const

/** Binds canonical root and actor solely from trusted transport/window state. */
export function workspaceWorkContext(ctx: RequestContext, value: unknown, deps: HandlerDeps, server?: RpcServer): {
  service: WorkspaceWorkService; actor: WorkspaceWorkActor
} {
  const workspaceId = validateWorkspaceId(value)
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace || workspace.id !== workspaceId) throw new CodedError('NOT_FOUND', 'Workspace unavailable')
  const boundId = ctx.workspaceId ?? (ctx.webContentsId === null ? undefined : deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId))
  if (boundId !== workspaceId) throw new CodedError('WORKSPACE_MISMATCH', 'Workspace mismatch')
  const authority = deps.nativeData?.authority
  const principal = ctx.principal
  const local = !principal && ctx.webContentsId !== null && deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId) === workspaceId
  if (!principal && (!local || authority?.hasRegisteredWorkspaces())) throw new CodedError('UNAUTHENTICATED', 'Workspace identity unavailable')
  if (principal && !authority) throw new CodedError('UNAUTHENTICATED', 'Workspace identity unavailable')
  const allowed = (action: 'read' | 'write' | 'delete' | 'manage') => principal
    ? !!authority?.authorize(principal, workspaceId, action, workspace.rootPath) : local
  const actorId = principal?.subject ?? getLocalIdentity().userId
  const actor: WorkspaceWorkActor = { actorId, canWrite: allowed('write'), canDelete: allowed('delete'), canManage: allowed('manage'),
    assertCurrent(action) {
      const current = getWorkspaceByNameOrId(workspaceId)
      if (!current || current.rootPath !== workspace.rootPath || !allowed('read') || !allowed(action) ||
        (server?.isRequestContextCurrent && !server.isRequestContextCurrent(ctx, action))) throw new CodedError('FORBIDDEN', 'Workspace work action denied')
      if (!principal && (!local || deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!) !== workspaceId)) throw new CodedError('WORKSPACE_MISMATCH', 'Workspace mismatch')
    } }
  actor.assertCurrent('read')
  const members = () => principal ? authority!.listWorkspaceMembers(principal, workspaceId) : [{ id: actorId, name: getLocalIdentity().name ?? actorId }]
  const hasProject = (id: string) => !!loadProjectById(workspace.rootPath, id)
  const hasReference = (link: WorkspaceTaskLink): boolean => {
    if (link.workspaceId !== workspaceId) return false
    switch (link.kind) {
      case 'project': return hasProject(link.id)
      case 'page': return !!loadPageById(workspace.rootPath, link.id)
      case 'session': return deps.sessionManager.getSessions(workspaceId).some(session => session.id === link.id && session.workspaceId === workspaceId)
      // Native Notes, Meetings and Automation adapters have separate canonical IDs.
      // Until they supply a resolver, reject an unverifiable link rather than fabricate one.
      default: return deps.workspaceWorkReferences?.exists(workspaceId, workspace.rootPath, link) === true
    }
  }
  return { actor, service: new WorkspaceWorkService(new WorkspaceWorkStore(workspace.rootPath, workspaceId), {
    members, hasMember: id => members().some(member => member.id === id), hasProject,
    hasSource: slug => !!loadSource(workspace.rootPath, slug), hasSkill: slug => !!loadSkillBySlug(workspace.rootPath, slug), hasReference,
  }) }
}

export function registerWorkspaceWorkHandlers(server: RpcServer, deps: HandlerDeps): void {
  const changed = (workspaceId: string, revision: number) => pushTyped(server, RPC_CHANNELS.workspaceWork.CHANGED,
    { to: 'workspace', workspaceId }, workspaceId, revision)
  server.handle(RPC_CHANNELS.workspaceWork.READ, (ctx, workspaceId: string) => {
    const { service, actor } = workspaceWorkContext(ctx, workspaceId, deps, server)
    return service.read(actor)
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })
  server.handle(RPC_CHANNELS.workspaceWork.WRITE, (ctx, workspaceId: string, command: unknown) => {
    const { service, actor } = workspaceWorkContext(ctx, workspaceId, deps, server)
    const result = service.write(actor, command)
    changed(workspaceId, result.snapshot.revision)
    return result
  }, { access: 'nativeOrLocalElectron', nativeAction: 'write' })
  server.handle(RPC_CHANNELS.workspaceWork.DELETE, (ctx, workspaceId: string, command: unknown) => {
    const { service, actor } = workspaceWorkContext(ctx, workspaceId, deps, server)
    const result = service.delete(actor, command)
    changed(workspaceId, result.snapshot.revision)
    return result
  }, { access: 'nativeOrLocalElectron', nativeAction: 'delete' })
  server.handle(RPC_CHANNELS.workspaceWork.SNAPSHOT_PROFILE, (ctx, workspaceId: string, profileId?: string) => {
    const { service, actor } = workspaceWorkContext(ctx, workspaceId, deps, server)
    return service.snapshotProfile(actor, profileId)
  }, { access: 'nativeOrLocalElectron', nativeAction: 'read' })
}
