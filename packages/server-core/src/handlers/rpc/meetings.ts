/**
 * Meeting collection RPC (issue #368 / I012, I028, I032).
 * ACL is applied before search. Delete tombstones; it does not empty the archive.
 * Actor comes from the RPC session, not a forged body identity.
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
import { exportMeeting, importMeeting, type MeetingExportBundle, type MeetingExportFormat } from '../../meetings/exports.ts'
import { deleteMeetingWithRetention } from '../../meetings/retention.ts'
import { authorizeMeetingRpc } from '../../meetings/security.ts'
import {
  addLinkedNote,
  emptyMeetingShare,
  type MeetingShareRecord,
} from '../../meetings/sharing.ts'
import { loadMeetingShareIndex, saveMeetingShareIndex } from '../../meetings/share-store.ts'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.meetings.LIST,
  RPC_CHANNELS.meetings.GET,
  RPC_CHANNELS.meetings.SEARCH,
  RPC_CHANNELS.meetings.DELETE,
  RPC_CHANNELS.meetings.EXPORT,
  RPC_CHANNELS.meetings.IMPORT,
] as const

export type MeetingsListOpts = {
  query?: string
  cursor?: string
  limit?: number
  offline?: boolean
}

export type MeetingsExportOpts = {
  format?: MeetingExportFormat
  audience?: 'owner' | 'shared'
  clip?: { startMs: number; endMs: number; text: string }
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

function deniedState(): { items: []; state: 'denied' } {
  return { items: [], state: 'denied' }
}

function shareFromQuery(meeting: MeetingQueryRecord, accountId: string): MeetingShareRecord {
  let record = emptyMeetingShare({
    meetingId: meeting.id,
    workspaceId: meeting.workspaceId,
    title: meeting.title,
    ownerId: accountId,
  })
  record = { ...record, transcript: meeting.transcript }
  if (meeting.manualNotes) {
    record = addLinkedNote(record, {
      id: `${meeting.id}-manual`,
      ownerId: accountId,
      audience: 'shared',
      text: meeting.manualNotes,
      revision: 1,
    })
  }
  for (const source of meeting.sources ?? []) {
    record = addLinkedNote(record, {
      id: source.id,
      ownerId: accountId,
      audience: source.private ? 'private' : 'shared',
      text: source.text,
      revision: 1,
    })
  }
  return record
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

  const scoped = (ctx: { workspaceId: string | null }, workspaceId: string, actor: MeetingQueryActor) => {
    const rpc = authorizeMeetingRpc(
      { workspaceId: ctx.workspaceId, accountId: actor.accountId },
      { workspaceId, accountId: actor.accountId },
    )
    if (!rpc.ok) {
      throw Object.assign(new Error(rpc.code), { code: rpc.code })
    }
    return actor
  }

  const load = async (workspaceId: string, actor: MeetingQueryActor): Promise<MeetingQueryRecord[]> => {
    if (!actor.allowed) return []
    return loadMeetingQueryIndex(dirFor(workspaceId))
  }

  server.handle(RPC_CHANNELS.meetings.LIST, async (ctx, workspaceId: string, opts?: MeetingsListOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed) return deniedState()
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

  server.handle(RPC_CHANNELS.meetings.SEARCH, async (ctx, workspaceId: string, query: string, opts?: Omit<MeetingsListOpts, 'query'>) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed) return deniedState()
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

  server.handle(RPC_CHANNELS.meetings.GET, async (ctx, workspaceId: string, id: string) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed) return { state: 'denied' as const }
    const meetings = await load(workspaceId, actor)
    return getMeeting(meetings, id, actor)
  })

  server.handle(RPC_CHANNELS.meetings.DELETE, async (ctx, workspaceId: string, id: string) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const meetings = await load(workspaceId, actor)
    const dir = dirFor(workspaceId)
    const shares = await loadMeetingShareIndex(dir)
    const found = shares.find((item) => item.meetingId === id)
    if (found) {
      const deleted = deleteMeetingWithRetention({ record: found, meetings, actor })
      await saveMeetingQueryIndex(dir, deleted.query)
      await saveMeetingShareIndex(dir, [
        ...shares.filter((item) => item.meetingId !== id),
        deleted.record,
      ])
      return {
        ...getMeeting(deleted.query, id, actor),
        cascade: deleted.cascade,
      }
    }
    const next = deleteMeeting(meetings, id, actor)
    await saveMeetingQueryIndex(dir, next)
    return getMeeting(next, id, actor)
  })

  server.handle(RPC_CHANNELS.meetings.EXPORT, async (ctx, workspaceId: string, id: string, opts?: MeetingsExportOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed || !actor.accountId) {
      throw Object.assign(new Error('denied'), { code: 'denied' })
    }
    const meetings = await load(workspaceId, actor)
    const meeting = getMeeting(meetings, id, actor).meeting
    if (!meeting) throw Object.assign(new Error('not-found'), { code: 'not-found' })
    const shares = await loadMeetingShareIndex(dirFor(workspaceId))
    const record = shares.find((item) => item.meetingId === id) ?? shareFromQuery(meeting, actor.accountId)
    const result = exportMeeting(record, { accountId: actor.accountId, workspaceId }, {
      format: opts?.format ?? 'json',
      audience: opts?.audience,
      clip: opts?.clip,
    })
    if (!result.ok) throw Object.assign(new Error(result.code), { code: result.code })
    return result.bundle
  })

  server.handle(RPC_CHANNELS.meetings.IMPORT, async (ctx, workspaceId: string, bundle: MeetingExportBundle) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed || !actor.accountId) {
      throw Object.assign(new Error('denied'), { code: 'denied' })
    }
    const result = importMeeting(bundle, { accountId: actor.accountId, workspaceId })
    if (!result.ok) throw Object.assign(new Error(result.code), { code: result.code })
    const dir = dirFor(workspaceId)
    const meetings = await load(workspaceId, actor)
    const nextMeetings = [
      ...meetings.filter((item) => item.id !== result.record.meetingId),
      {
        id: result.record.meetingId,
        workspaceId: result.record.workspaceId,
        title: result.record.title,
        updatedAt: Date.now(),
        transcript: result.record.transcript,
      },
    ]
    const shares = await loadMeetingShareIndex(dir)
    await saveMeetingQueryIndex(dir, nextMeetings)
    await saveMeetingShareIndex(dir, [
      ...shares.filter((item) => item.meetingId !== result.record.meetingId),
      result.record,
    ])
    return result.record
  })
}
