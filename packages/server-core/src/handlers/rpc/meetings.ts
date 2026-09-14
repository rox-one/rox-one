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
  addManualNote,
  createMeeting,
  correctSegment,
  deleteMeeting,
  getMeeting,
  listMeetings,
  meetingSegments,
  setMeetingLifecycle,
  type MeetingLifecycleStatus,
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
  RPC_CHANNELS.meetings.READ,
  RPC_CHANNELS.meetings.GET,
  RPC_CHANNELS.meetings.CREATE,
  RPC_CHANNELS.meetings.START,
  RPC_CHANNELS.meetings.PAUSE,
  RPC_CHANNELS.meetings.RESUME,
  RPC_CHANNELS.meetings.STOP,
  RPC_CHANNELS.meetings.SEARCH,
  RPC_CHANNELS.meetings.SEGMENTS,
  RPC_CHANNELS.meetings.SUBSCRIBE,
  RPC_CHANNELS.meetings.CORRECT_SEGMENT,
  RPC_CHANNELS.meetings.ADD_MANUAL_NOTE,
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

export type MeetingsWriteOpts = {
  commandId?: string
  expectedRevision?: number
  title?: string
  id?: string
  note?: string
  streamId?: string
  segmentId?: string
  revision?: number
  text?: string
  capture?: MeetingQueryRecord['capture']
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

  const readMeeting = async (ctx: { workspaceId: string | null }, workspaceId: string, id: string) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed) return { state: 'denied' as const }
    const meetings = await load(workspaceId, actor)
    return getMeeting(meetings, id, actor)
  }

  server.handle(RPC_CHANNELS.meetings.GET, readMeeting)
  server.handle(RPC_CHANNELS.meetings.READ, readMeeting)

  server.handle(RPC_CHANNELS.meetings.CREATE, async (ctx, workspaceId: string, opts?: MeetingsWriteOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed) throw Object.assign(new Error('denied'), { code: 'denied' })
    const dir = dirFor(workspaceId)
    const meetings = await load(workspaceId, actor)
    const id = opts?.id || opts?.commandId || `mtg-${Date.now()}`
    const next = createMeeting(meetings, {
      id,
      workspaceId,
      title: opts?.title ?? 'Meeting',
      updatedAt: Date.now(),
      commandId: opts?.commandId,
    }, actor)
    await saveMeetingQueryIndex(dir, next)
    return getMeeting(next, id, actor)
  })

  const mutateLifecycle = async (
    ctx: { workspaceId: string | null },
    workspaceId: string,
    id: string,
    status: MeetingLifecycleStatus,
    capture?: MeetingQueryRecord['capture'],
  ) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const dir = dirFor(workspaceId)
    let meetings = await load(workspaceId, actor)
    if (!getMeeting(meetings, id, actor).meeting) {
      meetings = createMeeting(meetings, {
        id,
        workspaceId,
        title: id,
        updatedAt: Date.now(),
      }, actor)
    }
    const next = setMeetingLifecycle(meetings, id, status, actor, Date.now(), capture ?? 'device-required')
    await saveMeetingQueryIndex(dir, next)
    return getMeeting(next, id, actor)
  }

  server.handle(RPC_CHANNELS.meetings.START, async (ctx, workspaceId: string, id: string, opts?: MeetingsWriteOpts) => {
    return mutateLifecycle(ctx, workspaceId, id, 'capturing', opts?.capture ?? 'device-required')
  })
  server.handle(RPC_CHANNELS.meetings.PAUSE, async (ctx, workspaceId: string, id: string) => {
    return mutateLifecycle(ctx, workspaceId, id, 'paused')
  })
  server.handle(RPC_CHANNELS.meetings.RESUME, async (ctx, workspaceId: string, id: string) => {
    return mutateLifecycle(ctx, workspaceId, id, 'capturing')
  })
  server.handle(RPC_CHANNELS.meetings.STOP, async (ctx, workspaceId: string, id: string) => {
    return mutateLifecycle(ctx, workspaceId, id, 'finalizing')
  })

  server.handle(RPC_CHANNELS.meetings.SEGMENTS, async (ctx, workspaceId: string, id: string) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed) return { state: 'denied' as const, items: [] }
    const meetings = await load(workspaceId, actor)
    const found = getMeeting(meetings, id, actor)
    return { state: found.state, items: meetingSegments(found.meeting) }
  })

  server.handle(RPC_CHANNELS.meetings.SUBSCRIBE, async (ctx, workspaceId: string, id: string) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!actor.allowed) return { state: 'denied' as const, cursor: null, items: [] }
    const meetings = await load(workspaceId, actor)
    const found = getMeeting(meetings, id, actor)
    const items = meetingSegments(found.meeting)
    const last = items.at(-1)
    return {
      state: found.state,
      cursor: last ? `${last.streamId}:${last.id}:${last.revision}` : null,
      items,
    }
  })

  server.handle(RPC_CHANNELS.meetings.CORRECT_SEGMENT, async (ctx, workspaceId: string, id: string, opts: MeetingsWriteOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    if (!opts.streamId || !opts.segmentId || typeof opts.revision !== 'number' || typeof opts.text !== 'string') {
      throw Object.assign(new Error('invalid-segment'), { code: 'invalid-segment' })
    }
    const dir = dirFor(workspaceId)
    const meetings = await load(workspaceId, actor)
    const next = correctSegment(meetings, id, {
      streamId: opts.streamId,
      segmentId: opts.segmentId,
      revision: opts.revision,
      text: opts.text,
    }, actor, Date.now())
    await saveMeetingQueryIndex(dir, next)
    return getMeeting(next, id, actor)
  })

  server.handle(RPC_CHANNELS.meetings.ADD_MANUAL_NOTE, async (ctx, workspaceId: string, id: string, opts: MeetingsWriteOpts) => {
    const actor = scoped(ctx, workspaceId, await actorFor(workspaceId))
    const dir = dirFor(workspaceId)
    const meetings = await load(workspaceId, actor)
    const next = addManualNote(meetings, id, opts.note ?? '', actor, Date.now())
    await saveMeetingQueryIndex(dir, next)
    return getMeeting(next, id, actor)
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
