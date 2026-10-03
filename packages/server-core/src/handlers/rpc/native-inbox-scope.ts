import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CodedError } from '@craft-agent/shared/protocol'
import type { LessonOwner } from '@craft-agent/shared/memory/types'
import type { RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { readNativeWorkspaceRegistry } from './native-workspace-registry'

export function nativeInboxOwner(ctx: RequestContext): LessonOwner | undefined {
  return ctx.principal ? { issuer: ctx.principal.issuer, subject: ctx.principal.subject } : undefined
}

export function isInboxOwner(value: LessonOwner | undefined, ctx: RequestContext): boolean {
  return !ctx.principal || value?.issuer === ctx.principal.issuer && value.subject === ctx.principal.subject
}

/** Reads never run the legacy registry's migrations or bind a host directory. */
export function assertNativeInboxWorkspace(ctx: RequestContext, deps: HandlerDeps, server: RpcServer, workspaceId: string, action: 'read' | 'write' | 'delete' = 'read', capturedRoot?: string): string | undefined {
  if (!ctx.principal) return
  const workspace = readNativeWorkspaceRegistry(workspaceId)
  if (!workspace || ctx.workspaceId !== workspaceId || capturedRoot && capturedRoot !== workspace.rootPath
    || !deps.nativeData?.authority.authorize(ctx.principal, workspaceId, action, workspace.rootPath)) {
    throw new CodedError('FORBIDDEN', 'Inbox access denied')
  }
  if (!server.isRequestContextCurrent?.(ctx, action)) throw new CodedError('AUTH_FAILED', 'Inbox permission changed')
  return workspace.rootPath
}

/** Existing queue implementations are synchronous; check their bounded, link-free
 * filesystem tree immediately before calling them. A missing queue stays absent. */
export function assertNativeInboxPath(root: string, segments: string[], recursive = false): void {
  let path = root
  let remaining = 2000
  const inspect = (file: string, descend: boolean, depth = 0): void => {
    let stat: ReturnType<typeof lstatSync>
    try { stat = lstatSync(file) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (--remaining < 0 || depth > 8 || stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()
      || stat.isFile() && stat.size > 4 * 1024 * 1024) throw new CodedError('FORBIDDEN', 'Inbox storage path denied')
    if (descend && stat.isDirectory()) for (const entry of readdirSync(file)) inspect(join(file, entry), true, depth + 1)
  }
  for (const segment of segments) { path = join(path, segment); inspect(path, false) }
  if (recursive) inspect(path, true)
}
