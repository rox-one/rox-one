/**
 * Meeting collection RPC (issue #368 / I012).
 * ACL is applied before search. Delete tombstones; it does not empty the archive.
 */

import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  deleteMeeting,
  getMeeting,
  listMeetings,
  type MeetingQueryActor,
  type MeetingQueryRecord,
} from '../../meetings/queries.ts'
import { loadMeetingQueryIndex, saveMeetingQueryIndex } from '../../meetings/query-store.ts'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.meetings.LIST,
  RPC_CHANNELS.meetings.GET,
  RPC_CHANNELS.meetings.SEARCH,
  RPC_CHANNELS.meetings.DELETE,
] as const

export type MeetingsListOpts = {
  query?: string
  cursor?: string
  limit?: number
  offline?: boolean
}

export type MeetingsHandlerRuntime = {
  resolveActor?: (workspaceId: string) => MeetingQueryActor | Promise<MeetingQueryActor>
  resolveStoreDir?: (workspaceId: string) => string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
}

export function registerMeetingsHandlers(
  server: RpcServer,
  _deps: HandlerDeps,
  runtime: MeetingsHandlerRuntime = {},
): void {
  const actorFor = async (workspaceId: string): Promise<MeetingQueryActor> => {
    if (runtime.resolveActor) return runtime.resolveActor(workspaceId)
    return { workspaceId, allowed: Boolean(getWorkspaceByNameOrId(workspaceId)) }
  }

  const dirFor = (workspaceId: string): string => {
    if (runtime.resolveStoreDir) return runtime.resolveStoreDir(workspaceId)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      throw Object.assign(new Error('denied'), { code: 'denied' })
    }
    return join(workspace.rootPath, 'meetings')
  }

  const load = async (workspaceId: string, actor: MeetingQueryActor): Promise<MeetingQueryRecord[]> => {
    if (!actor.allowed) return []
    return loadMeetingQueryIndex(dirFor(workspaceId))
  }

  server.handle(RPC_CHANNELS.meetings.LIST, async (_ctx, workspaceId: string, opts?: MeetingsListOpts) => {
    const actor = await actorFor(workspaceId)
    if (!actor.allowed) return { items: [], state: 'denied' as const }
    const meetings = await load(workspaceId, actor)
    return listMeetings({
      meetings,
      actor,
      query: opts?.query,
      cursor: opts?.cursor,
      limit: clampLimit(opts?.limit),
      offline: opts?.offline,
    })
  })

  server.handle(RPC_CHANNELS.meetings.SEARCH, async (_ctx, workspaceId: string, query: string, opts?: Omit<MeetingsListOpts, 'query'>) => {
    const actor = await actorFor(workspaceId)
    if (!actor.allowed) return { items: [], state: 'denied' as const }
    const meetings = await load(workspaceId, actor)
    return listMeetings({
      meetings,
      actor,
      query,
      cursor: opts?.cursor,
      limit: clampLimit(opts?.limit),
      offline: opts?.offline,
    })
  })

  server.handle(RPC_CHANNELS.meetings.GET, async (_ctx, workspaceId: string, id: string) => {
    const actor = await actorFor(workspaceId)
    if (!actor.allowed) return { state: 'denied' as const }
    const meetings = await load(workspaceId, actor)
    return getMeeting(meetings, id, actor)
  })

  server.handle(RPC_CHANNELS.meetings.DELETE, async (_ctx, workspaceId: string, id: string) => {
    const actor = await actorFor(workspaceId)
    const meetings = await load(workspaceId, actor)
    const next = deleteMeeting(meetings, id, actor)
    await saveMeetingQueryIndex(dirFor(workspaceId), next)
    return getMeeting(next, id, actor)
  })
}
