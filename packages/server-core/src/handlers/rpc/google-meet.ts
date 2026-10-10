/**
 * `meet:*` RPC — Google Meet artifacts (wave 5, row d2.6).
 *
 * Read-only client over the Google Meet REST API (v2) Developer-Preview
 * surface: `spaces.get` plus `conferenceRecords.{participants,recordings,
 * transcripts,smartNotes}.list`. It reuses the calendar connector's local OAuth
 * broker + credential manager, so the whole namespace is LOCAL_ONLY.
 *
 * The Meet API is a Developer Preview API gated on Workspace enrollment. The
 * host must explicitly acknowledge that (`GoogleMeetConfig.enrollmentAcknowledged`)
 * before any call; while unacknowledged every channel refuses with the typed
 * code `PREVIEW_NOT_ACKNOWLEDGED` and performs ZERO network I/O. Missing
 * credentials refuse with `MEET_NOT_CONNECTED`, and a host that never composed
 * the connector refuses with `MEET_NOT_CONFIGURED`.
 *
 * This module is pure transport + parsing: it never persists tokens and never
 * writes. Callers own the credential lifecycle via the host-composed service.
 */
import { CodedError, RPC_CHANNELS } from '@rox/shared/protocol'
import type { RequestContext, RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

/** Google Meet REST API v2 base. */
export const GOOGLE_MEET_API_BASE = 'https://meet.googleapis.com/v2'

/** Refusal codes surfaced to the renderer. Every refusal is `{ ok: false }`. */
export type GoogleMeetRefusalCode =
  | 'MEET_NOT_CONFIGURED'
  | 'PREVIEW_NOT_ACKNOWLEDGED'
  | 'MEET_NOT_CONNECTED'
  | 'MEET_FETCH_FAILED'
  | 'INVALID_PAYLOAD'

export interface GoogleMeetRefusal {
  ok: false
  code: GoogleMeetRefusalCode
  error: string
}

// ── Artifact shapes (the "rows") ────────────────────────────────────────────

/** `spaces.get` result. */
export interface MeetSpace {
  name: string
  meetingUri?: string
  meetingCode?: string
  config?: { accessType?: string; entryPointAccess?: string }
  activeConference?: { conferenceRecord?: string }
}

/** A single `conferenceRecords.*` record. */
export interface MeetConferenceRecord {
  name: string
  startTime?: string
  endTime?: string
  expireTime?: string
  space?: string
}

export type MeetParticipantKind = 'signedin' | 'anonymous' | 'phone' | 'unknown'

/** `conferenceRecords.participants.list` row. */
export interface MeetParticipant {
  name: string
  kind: MeetParticipantKind
  earliestStartTime?: string
  latestEndTime?: string
  /** Display name when the participant is a signed-in or phone user. */
  displayName?: string
  /** Signed-in user resource name (`users/{id}`), when present. */
  user?: string
}

/** `conferenceRecords.recordings.list` row; the recording lands in Drive. */
export interface MeetRecording {
  name: string
  state?: string
  startTime?: string
  endTime?: string
  driveDestination?: { file?: string; exportUri?: string }
}

/** `conferenceRecords.transcripts.list` row; the transcript lands in Docs. */
export interface MeetTranscript {
  name: string
  state?: string
  startTime?: string
  endTime?: string
  docsDestination?: { document?: string; exportUri?: string }
}

/** `conferenceRecords.smartNotes.list` row; smart notes land in Docs. */
export interface MeetSmartNote {
  name: string
  state?: string
  startTime?: string
  endTime?: string
  docsDestination?: { document?: string; exportUri?: string }
}

// ── Host composition ────────────────────────────────────────────────────────

/**
 * Host-resolved config for one workspace. The host owns the credential store;
 * `accessToken` is the freshly minted bearer token (or null when not connected).
 */
export interface GoogleMeetConfig {
  /** Developer-Preview enrollment acknowledgement. When false, all calls refuse. */
  enrollmentAcknowledged: boolean
  /** Bearer token for the Meet/GCP project, or null when the connector is not connected. */
  accessToken: string | null
  /** API base override (tests). Defaults to {@link GOOGLE_MEET_API_BASE}. */
  apiBase?: string
  /** Test seam; falls back to the global `fetch` at call time. */
  fetchImpl?: typeof fetch
}

/**
 * Host-composed Google Meet connector. The Electron main process composes this;
 * a host that never does answers `MEET_NOT_CONFIGURED`.
 */
export interface GoogleMeetService {
  getConfig: (workspaceId: string) => Promise<GoogleMeetConfig> | GoogleMeetConfig
}

// ── Refusals ────────────────────────────────────────────────────────────────

function notConfigured(): GoogleMeetRefusal {
  return {
    ok: false,
    code: 'MEET_NOT_CONFIGURED',
    error: 'Google Meet connector is not configured on this host',
  }
}

function previewNotAcknowledged(): GoogleMeetRefusal {
  return {
    ok: false,
    code: 'PREVIEW_NOT_ACKNOWLEDGED',
    error:
      'Google Meet artifacts require acknowledging Developer-Preview enrollment ' +
      '(the Meet REST API is a Developer Preview API)',
  }
}

function notConnected(): GoogleMeetRefusal {
  return {
    ok: false,
    code: 'MEET_NOT_CONNECTED',
    error: 'Google Meet connector is not connected (no stored credential)',
  }
}

function fetchFailed(status: number, detail?: string): GoogleMeetRefusal {
  return {
    ok: false,
    code: 'MEET_FETCH_FAILED',
    error: `Google Meet API request failed (${status})${detail ? `: ${detail}` : ''}`,
  }
}

function invalid(field: string): never {
  throw new CodedError('INVALID_PAYLOAD', `Invalid ${field}`)
}

// ── Resolution ──────────────────────────────────────────────────────────────

type Resolved = GoogleMeetConfig & { accessToken: string; apiBase: string; fetchImpl: typeof fetch }

/**
 * Resolve the connector for a workspace, enforcing the gates in order:
 * configured → Developer-Preview acknowledged → credential present. The
 * preview gate runs before any network I/O by construction.
 */
async function resolveMeet(deps: HandlerDeps, workspaceId: string): Promise<Resolved | GoogleMeetRefusal> {
  const service = deps.meet
  if (!service) return notConfigured()

  let config: GoogleMeetConfig
  try {
    config = await service.getConfig(workspaceId)
  } catch {
    return notConfigured()
  }
  if (!config || typeof config !== 'object') return notConfigured()
  if (!config.enrollmentAcknowledged) return previewNotAcknowledged()
  if (!config.accessToken) return notConnected()

  return {
    ...config,
    accessToken: config.accessToken,
    apiBase: config.apiBase ?? GOOGLE_MEET_API_BASE,
    fetchImpl: config.fetchImpl ?? globalThis.fetch,
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

const MAX_NAME_LENGTH = 512
const SPACE_NAME = /^spaces\/[A-Za-z0-9_-]+$/
const CONFERENCE_RECORD_NAME = /^conferenceRecords\/[A-Za-z0-9_-]+$/
// C0 controls, DEL and C1: the rule-clean spelling (`\p{Cc}`, u-flag) of the
// same refusal check — both call sites already reject any character outside
// [A-Za-z0-9_/-] with the same `invalid(...)` result, so the widened set cannot
// change observable behaviour.
const CONTROL_CHARS = /\p{Cc}/u

function requireSpaceName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAME_LENGTH) return invalid('space')
  if (CONTROL_CHARS.test(value)) return invalid('space')
  if (!SPACE_NAME.test(value)) return invalid('space')
  return value
}

function requireConferenceRecord(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NAME_LENGTH) return invalid('conferenceRecord')
  if (CONTROL_CHARS.test(value)) return invalid('conferenceRecord')
  if (!CONFERENCE_RECORD_NAME.test(value)) return invalid('conferenceRecord')
  return value
}

function requireUsername(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return invalid('workspaceId')
  return value
}

// ── Transport ───────────────────────────────────────────────────────────────

type FetchOutcome<T> = { ok: true; raw: T } | GoogleMeetRefusal

async function meetGet<T>(config: Resolved, path: string): Promise<FetchOutcome<T>> {
  let response: Response
  try {
    response = await config.fetchImpl(`${config.apiBase}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: 'application/json',
      },
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, code: 'MEET_FETCH_FAILED', error: `Google Meet API request failed: ${detail}` }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return fetchFailed(response.status, detail.slice(0, 200) || undefined)
  }

  try {
    return { ok: true, raw: (await response.json()) as T }
  } catch {
    return fetchFailed(response.status, 'malformed JSON')
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function destination(raw: unknown): { document?: string; exportUri?: string; file?: string } | undefined {
  const record = asRecord(raw)
  if (!record) return undefined
  const destination: { document?: string; exportUri?: string; file?: string } = {}
  const document = str(record.document)
  const exportUri = str(record.exportUri)
  const file = str(record.file)
  if (document) destination.document = document
  if (exportUri) destination.exportUri = exportUri
  if (file) destination.file = file
  return Object.keys(destination).length > 0 ? destination : undefined
}

export function parseSpace(raw: unknown): MeetSpace | null {
  const record = asRecord(raw)
  const name = record ? str(record.name) : undefined
  if (!name) return null
  const space: MeetSpace = { name }
  const meetingUri = str(record!.meetingUri)
  const meetingCode = str(record!.meetingCode)
  if (meetingUri) space.meetingUri = meetingUri
  if (meetingCode) space.meetingCode = meetingCode
  const config = asRecord(record!.config)
  if (config) {
    const accessType = str(config.accessType)
    const entryPointAccess = str(config.entryPointAccess)
    if (accessType || entryPointAccess) {
      space.config = { ...(accessType && { accessType }), ...(entryPointAccess && { entryPointAccess }) }
    }
  }
  const activeConference = asRecord(record!.activeConference)
  const conferenceRecord = activeConference ? str(activeConference.conferenceRecord) : undefined
  if (conferenceRecord) space.activeConference = { conferenceRecord }
  return space
}

export function parseConferenceRecord(raw: unknown): MeetConferenceRecord | null {
  const record = asRecord(raw)
  const name = record ? str(record.name) : undefined
  if (!name) return null
  const parsed: MeetConferenceRecord = { name }
  const startTime = str(record!.startTime)
  const endTime = str(record!.endTime)
  const expireTime = str(record!.expireTime)
  const space = str(record!.space)
  if (startTime) parsed.startTime = startTime
  if (endTime) parsed.endTime = endTime
  if (expireTime) parsed.expireTime = expireTime
  if (space) parsed.space = space
  return parsed
}

export function parseParticipant(raw: unknown): MeetParticipant | null {
  const record = asRecord(raw)
  const name = record ? str(record.name) : undefined
  if (!name) return null
  const parsed: MeetParticipant = { name, kind: 'unknown' }
  const signedin = asRecord(record!.signedinUser)
  const anonymous = asRecord(record!.anonymousUser)
  const phone = asRecord(record!.phoneUser)
  if (signedin) {
    parsed.kind = 'signedin'
    parsed.displayName = str(signedin.displayName)
    parsed.user = str(signedin.user)
  } else if (anonymous) {
    parsed.kind = 'anonymous'
    parsed.displayName = str(anonymous.displayName)
  } else if (phone) {
    parsed.kind = 'phone'
    parsed.displayName = str(phone.displayName)
  }
  const earliestStartTime = str(record!.earliestStartTime)
  const latestEndTime = str(record!.latestEndTime)
  if (earliestStartTime) parsed.earliestStartTime = earliestStartTime
  if (latestEndTime) parsed.latestEndTime = latestEndTime
  return parsed
}

export function parseRecording(raw: unknown): MeetRecording | null {
  const record = asRecord(raw)
  const name = record ? str(record.name) : undefined
  if (!name) return null
  const parsed: MeetRecording = { name }
  const state = str(record!.state)
  const startTime = str(record!.startTime)
  const endTime = str(record!.endTime)
  if (state) parsed.state = state
  if (startTime) parsed.startTime = startTime
  if (endTime) parsed.endTime = endTime
  const driveDestination = destination(record!.driveDestination)
  if (driveDestination) parsed.driveDestination = driveDestination
  return parsed
}

export function parseTranscript(raw: unknown): MeetTranscript | null {
  const record = asRecord(raw)
  const name = record ? str(record.name) : undefined
  if (!name) return null
  const parsed: MeetTranscript = { name }
  const state = str(record!.state)
  const startTime = str(record!.startTime)
  const endTime = str(record!.endTime)
  if (state) parsed.state = state
  if (startTime) parsed.startTime = startTime
  if (endTime) parsed.endTime = endTime
  const docsDestination = destination(record!.docsDestination)
  if (docsDestination) parsed.docsDestination = docsDestination
  return parsed
}

export function parseSmartNote(raw: unknown): MeetSmartNote | null {
  const record = asRecord(raw)
  const name = record ? str(record.name) : undefined
  if (!name) return null
  const parsed: MeetSmartNote = { name }
  const state = str(record!.state)
  const startTime = str(record!.startTime)
  const endTime = str(record!.endTime)
  if (state) parsed.state = state
  if (startTime) parsed.startTime = startTime
  if (endTime) parsed.endTime = endTime
  const docsDestination = destination(record!.docsDestination)
  if (docsDestination) parsed.docsDestination = docsDestination
  return parsed
}

/** Extract the `spaces/{id}` resource id used in the `space.name` filter. */
function spaceId(space: string): string {
  return space.slice('spaces/'.length)
}

function parseList<T>(raw: unknown, key: string, parse: (item: unknown) => T | null): T[] {
  const record = asRecord(raw)
  const list = record && Array.isArray(record[key]) ? (record[key] as unknown[]) : []
  const out: T[] = []
  for (const item of list) {
    const parsed = parse(item)
    if (parsed) out.push(parsed)
  }
  return out
}

// ── Handler results ─────────────────────────────────────────────────────────

export type MeetSpaceResult = { ok: true; space: MeetSpace } | GoogleMeetRefusal
export type MeetConferenceRecordsResult = { ok: true; conferenceRecords: MeetConferenceRecord[] } | GoogleMeetRefusal
export type MeetParticipantsResult = { ok: true; participants: MeetParticipant[] } | GoogleMeetRefusal
export type MeetRecordingsResult = { ok: true; recordings: MeetRecording[] } | GoogleMeetRefusal
export type MeetTranscriptsResult = { ok: true; transcripts: MeetTranscript[] } | GoogleMeetRefusal
export type MeetSmartNotesResult = { ok: true; smartNotes: MeetSmartNote[] } | GoogleMeetRefusal

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.meet.SPACE,
  RPC_CHANNELS.meet.CONFERENCE_RECORDS,
  RPC_CHANNELS.meet.PARTICIPANTS,
  RPC_CHANNELS.meet.RECORDINGS,
  RPC_CHANNELS.meet.TRANSCRIPTS,
  RPC_CHANNELS.meet.SMART_NOTES,
] as const

export function registerGoogleMeetHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.meet.SPACE, async (ctx: RequestContext, args: {
    workspaceId?: string
    space?: string
  }): Promise<MeetSpaceResult> => {
    const workspaceId = requireUsername(args?.workspaceId ?? ctx.workspaceId)
    const space = requireSpaceName(args?.space)
    const config = await resolveMeet(deps, workspaceId)
    if ('ok' in config && config.ok === false) return config
    const resolved = config as Resolved
    const result = await meetGet<unknown>(resolved, `/${space}`)
    if (result.ok === false) return result
    const parsed = parseSpace(result.raw)
    if (!parsed) return fetchFailed(200, 'unexpected spaces.get payload')
    return { ok: true, space: parsed }
  })

  server.handle(RPC_CHANNELS.meet.CONFERENCE_RECORDS, async (ctx: RequestContext, args: {
    workspaceId?: string
    space?: string
  }): Promise<MeetConferenceRecordsResult> => {
    const workspaceId = requireUsername(args?.workspaceId ?? ctx.workspaceId)
    const space = requireSpaceName(args?.space)
    const config = await resolveMeet(deps, workspaceId)
    if ('ok' in config && config.ok === false) return config
    const resolved = config as Resolved
    const filter = encodeURIComponent(`space.name="spaces/${spaceId(space)}"`)
    const result = await meetGet<unknown>(resolved, `/conferenceRecords?filter=${filter}`)
    if (result.ok === false) return result
    return { ok: true, conferenceRecords: parseList(result.raw, 'conferenceRecords', parseConferenceRecord) }
  })

  server.handle(RPC_CHANNELS.meet.PARTICIPANTS, async (ctx: RequestContext, args: {
    workspaceId?: string
    conferenceRecord?: string
  }): Promise<MeetParticipantsResult> => {
    const workspaceId = requireUsername(args?.workspaceId ?? ctx.workspaceId)
    const conferenceRecord = requireConferenceRecord(args?.conferenceRecord)
    const config = await resolveMeet(deps, workspaceId)
    if ('ok' in config && config.ok === false) return config
    const resolved = config as Resolved
    const result = await meetGet<unknown>(resolved, `/${conferenceRecord}/participants`)
    if (result.ok === false) return result
    return { ok: true, participants: parseList(result.raw, 'participants', parseParticipant) }
  })

  server.handle(RPC_CHANNELS.meet.RECORDINGS, async (ctx: RequestContext, args: {
    workspaceId?: string
    conferenceRecord?: string
  }): Promise<MeetRecordingsResult> => {
    const workspaceId = requireUsername(args?.workspaceId ?? ctx.workspaceId)
    const conferenceRecord = requireConferenceRecord(args?.conferenceRecord)
    const config = await resolveMeet(deps, workspaceId)
    if ('ok' in config && config.ok === false) return config
    const resolved = config as Resolved
    const result = await meetGet<unknown>(resolved, `/${conferenceRecord}/recordings`)
    if (result.ok === false) return result
    return { ok: true, recordings: parseList(result.raw, 'recordings', parseRecording) }
  })

  server.handle(RPC_CHANNELS.meet.TRANSCRIPTS, async (ctx: RequestContext, args: {
    workspaceId?: string
    conferenceRecord?: string
  }): Promise<MeetTranscriptsResult> => {
    const workspaceId = requireUsername(args?.workspaceId ?? ctx.workspaceId)
    const conferenceRecord = requireConferenceRecord(args?.conferenceRecord)
    const config = await resolveMeet(deps, workspaceId)
    if ('ok' in config && config.ok === false) return config
    const resolved = config as Resolved
    const result = await meetGet<unknown>(resolved, `/${conferenceRecord}/transcripts`)
    if (result.ok === false) return result
    return { ok: true, transcripts: parseList(result.raw, 'transcripts', parseTranscript) }
  })

  server.handle(RPC_CHANNELS.meet.SMART_NOTES, async (ctx: RequestContext, args: {
    workspaceId?: string
    conferenceRecord?: string
  }): Promise<MeetSmartNotesResult> => {
    const workspaceId = requireUsername(args?.workspaceId ?? ctx.workspaceId)
    const conferenceRecord = requireConferenceRecord(args?.conferenceRecord)
    const config = await resolveMeet(deps, workspaceId)
    if ('ok' in config && config.ok === false) return config
    const resolved = config as Resolved
    const result = await meetGet<unknown>(resolved, `/${conferenceRecord}/smartNotes`)
    if (result.ok === false) return result
    return { ok: true, smartNotes: parseList(result.raw, 'smartNotes', parseSmartNote) }
  })
}