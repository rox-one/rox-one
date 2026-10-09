/**
 * Protocol catalog — the frozen, enumerable surface of the wire protocol.
 *
 * `flattenChannelCatalog()` lists every value in `RPC_CHANNELS` exactly once,
 * each with its direction (`rpc`) and its hybrid local/remote routing class.
 * The broadcast event set is derived from `BroadcastEventMap`; the runtime list
 * below is compile-time-checked against that interface so it can never drift.
 *
 * `buildProtocolCatalog()` bundles methods + events + capabilities + policy into
 * the block the handshake ack advertises as `features` / `policy`.
 */

import { getAllChannelValues, RPC_CHANNELS } from './channels'
import { LOCAL_ONLY_CHANNELS, REMOTE_ELIGIBLE_CHANNELS } from './routing'
import type { BroadcastEventMap } from './events'
import { PROTOCOL_CLIENT_CAPABILITIES } from './capabilities'
import type { ProtocolFeatures, ProtocolPolicy } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Hybrid routing class, mirroring `routing.ts`. */
export type ChannelRouting = 'local-only' | 'remote-eligible' | 'unclassified'

export interface ProtocolMethodEntry {
  channel: string
  direction: 'rpc'
  routing: ChannelRouting
}

export interface ProtocolEventEntry {
  channel: string
  direction: 'event'
  routing: ChannelRouting
}

export interface ProtocolCatalog {
  methods: ProtocolMethodEntry[]
  events: ProtocolEventEntry[]
  capabilities: string[]
  policy: ProtocolPolicy
}

/** Advertised max WS frame payload. Matches the `ws` default the transport uses. */
export const PROTOCOL_MAX_PAYLOAD_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// Broadcast events (runtime mirror of BroadcastEventMap)
// ---------------------------------------------------------------------------

/**
 * Runtime list of every `BroadcastEventMap` key, in declaration order.
 *
 * The two type-level assertions below make this list exhaustive and closed:
 * omitting a key (or adding a stray channel) fails compilation.
 */
export const BROADCAST_EVENT_CHANNELS = [
  RPC_CHANNELS.workspaceWork.CHANGED,
  RPC_CHANNELS.sessions.EVENT,
  RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED,
  RPC_CHANNELS.sessions.FILES_CHANGED,
  RPC_CHANNELS.sessions.BULK_CHANGED,
  RPC_CHANNELS.sources.CHANGED,
  RPC_CHANNELS.sources.INDEX_CHANGED,
  RPC_CHANNELS.labels.CHANGED,
  RPC_CHANNELS.statuses.CHANGED,
  RPC_CHANNELS.entities.LINKS_CHANGED,
  RPC_CHANNELS.commands.EVENT,
  RPC_CHANNELS.toolchain.STATUS_CHANGED,
  RPC_CHANNELS.automations.CHANGED,
  RPC_CHANNELS.skills.CHANGED,
  RPC_CHANNELS.skillsPending.CHANGED,
  RPC_CHANNELS.memory.CHANGED,
  RPC_CHANNELS.memory.REPO_CHANGED,
  RPC_CHANNELS.memory.DREAM_EVENT,
  RPC_CHANNELS.memory.DREAM_DONE,
  RPC_CHANNELS.memory.REPO_IMPORT_READY,
  RPC_CHANNELS.projects.CHANGED,
  RPC_CHANNELS.pages.CHANGED,
  RPC_CHANNELS.kanban.CHANGED,
  RPC_CHANNELS.workboard.CHANGED,
  RPC_CHANNELS.board.CHANGED,
  RPC_CHANNELS.personalTasks.CHANGED,
  RPC_CHANNELS.feed.CHANGED,
  RPC_CHANNELS.collection.CHANGED,
  RPC_CHANNELS.collection.FILTERS_CHANGED,
  RPC_CHANNELS.tasks.GENERATED,
  RPC_CHANNELS.notes.CHANGED,
  RPC_CHANNELS.knowledge.CHANGED,
  RPC_CHANNELS.llmConnections.CHANGED,
  RPC_CHANNELS.identity.CHANGED,
  RPC_CHANNELS.extensions.CHANGED,
  RPC_CHANNELS.permissions.DEFAULTS_CHANGED,
  RPC_CHANNELS.gamification.CHANGED,
  RPC_CHANNELS.privacy.CHANGED,
  RPC_CHANNELS.voice.CHANGED,
  RPC_CHANNELS.voice.JOB,
  RPC_CHANNELS.voice.OVERLAY,
  RPC_CHANNELS.voice.HOTKEY,
  RPC_CHANNELS.voice.TALK_EVENT,
  RPC_CHANNELS.voice.TTS_STREAM_CHUNK,
  RPC_CHANNELS.voice.STT_EVENT,
  RPC_CHANNELS.voice.WAKE_CHANGED,
  RPC_CHANNELS.voice.TRIGGER,
  RPC_CHANNELS.environment.CHANGED,
  RPC_CHANNELS.devSpace.CLONE_PROGRESS,
  RPC_CHANNELS.devSpace.CHANGED,
  RPC_CHANNELS.devSpace.RUN_PROGRESS,
  RPC_CHANNELS.devSpace.SOFT_SIGNAL,
  RPC_CHANNELS.podcast.JOB,
  RPC_CHANNELS.playbooks.CODEBOOK_JOB,
  RPC_CHANNELS.appearance.SHELL_CHANGED,
  RPC_CHANNELS.appearance.ACCENT_CHANGED,
  RPC_CHANNELS.theme.APP_CHANGED,
  RPC_CHANNELS.theme.SYSTEM_CHANGED,
  RPC_CHANNELS.theme.PREFERENCES_CHANGED,
  RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED,
  RPC_CHANNELS.update.AVAILABLE,
  RPC_CHANNELS.update.DOWNLOAD_PROGRESS,
  RPC_CHANNELS.badge.DRAW,
  RPC_CHANNELS.badge.DRAW_WINDOWS,
  RPC_CHANNELS.window.FOCUS_STATE,
  RPC_CHANNELS.window.CLOSE_REQUESTED,
  RPC_CHANNELS.browserPane.STATE_CHANGED,
  RPC_CHANNELS.browserPane.REMOVED,
  RPC_CHANNELS.browserPane.INTERACTED,
  RPC_CHANNELS.browserIntel.PROGRESS,
  RPC_CHANNELS.browserIntel.STATE_CHANGED,
  RPC_CHANNELS.siyuan.STATE_CHANGED,
  RPC_CHANNELS.siyuan.REMOVED,
  RPC_CHANNELS.extensionSurface.STATE_CHANGED,
  RPC_CHANNELS.extensionSurface.REMOVED,
  RPC_CHANNELS.notification.NAVIGATE,
  RPC_CHANNELS.deeplink.NAVIGATE,
  RPC_CHANNELS.copilot.DEVICE_CODE,
  RPC_CHANNELS.clipboard.CHANGED,
  RPC_CHANNELS.knowledgeMap.CHANGED,
  RPC_CHANNELS.contextDocs.CHANGED,
  RPC_CHANNELS.bundledSkills.CHANGED,
  RPC_CHANNELS.marketplace.PROGRESS,
  RPC_CHANNELS.marketplace.CHANGED,
  RPC_CHANNELS.menu.NEW_CHAT,
  RPC_CHANNELS.menu.OPEN_SETTINGS,
  RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS,
  RPC_CHANNELS.menu.TOGGLE_FOCUS_MODE,
  RPC_CHANNELS.menu.TOGGLE_SIDEBAR,
  RPC_CHANNELS.menu.TOGGLE_INSPECTOR,
  RPC_CHANNELS.menu.TOGGLE_CHAT_PICTURE_IN_PICTURE,
  RPC_CHANNELS.menu.OPEN_DASHBOARD,
  RPC_CHANNELS.menu.OPEN_NATIVE_CONSOLE,
  RPC_CHANNELS.menu.SHOW_SERVICE_STATUS,
  RPC_CHANNELS.menu.RUN_DOCTOR,
  RPC_CHANNELS.menu.TRAY_STATUS_CHANGED,
  RPC_CHANNELS.serviceLifecycle.STATUS_CHANGED,
  RPC_CHANNELS.messaging.BINDING_CHANGED,
  RPC_CHANNELS.messaging.PLATFORM_STATUS,
  RPC_CHANNELS.shell.ACTION,
] as const

/** Compile-time guard: every `BroadcastEventMap` key is listed above. */
type MissingEventChannels = Exclude<keyof BroadcastEventMap & string, (typeof BROADCAST_EVENT_CHANNELS)[number]>
const _assertAllEventsListed: MissingEventChannels extends never ? true : { missing: MissingEventChannels } = true

/** Compile-time guard: the list contains no channel absent from `BroadcastEventMap`. */
type ExtraEventChannels = Exclude<(typeof BROADCAST_EVENT_CHANNELS)[number], keyof BroadcastEventMap & string>
const _assertNoExtraEvents: ExtraEventChannels extends never ? true : { extra: ExtraEventChannels } = true

// ---------------------------------------------------------------------------
// Flattening
// ---------------------------------------------------------------------------

function routingOf(channel: string): ChannelRouting {
  if (LOCAL_ONLY_CHANNELS.has(channel)) return 'local-only'
  if (REMOTE_ELIGIBLE_CHANNELS.has(channel)) return 'remote-eligible'
  return 'unclassified'
}

/**
 * Every `RPC_CHANNELS` value exactly once, in declaration order, each tagged
 * with its `rpc` direction and hybrid routing classification.
 */
export function flattenChannelCatalog(): ProtocolMethodEntry[] {
  return getAllChannelValues().map((channel) => ({
    channel,
    direction: 'rpc' as const,
    routing: routingOf(channel),
  }))
}

/** Every `BroadcastEventMap` key in declaration order, tagged as a push event. */
export function flattenEventCatalog(): ProtocolEventEntry[] {
  return BROADCAST_EVENT_CHANNELS.map((channel) => ({
    channel,
    direction: 'event' as const,
    routing: routingOf(channel),
  }))
}

/** The complete protocol catalog advertised in the handshake ack. */
export function buildProtocolCatalog(): ProtocolCatalog {
  return {
    methods: flattenChannelCatalog(),
    events: flattenEventCatalog(),
    capabilities: [...PROTOCOL_CLIENT_CAPABILITIES],
    policy: { maxPayloadBytes: PROTOCOL_MAX_PAYLOAD_BYTES },
  }
}

/** Wire-projected feature block (`features` in the handshake ack). */
export function buildProtocolFeatures(): ProtocolFeatures {
  const catalog = buildProtocolCatalog()
  return {
    methods: catalog.methods.map((entry) => entry.channel),
    events: catalog.events.map((entry) => entry.channel),
    capabilities: catalog.capabilities,
  }
}

/** Wire policy block (`policy` in the handshake ack). */
export function buildProtocolPolicy(): ProtocolPolicy {
  return { maxPayloadBytes: PROTOCOL_MAX_PAYLOAD_BYTES }
}