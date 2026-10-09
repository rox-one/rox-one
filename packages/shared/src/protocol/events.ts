/**
 * Typed event map for server → client push channels.
 * Keys are channel string literals, values are argument tuples.
 */

import type { ThemeOverrides } from '../config/index'
import type { LoadedSource } from '../sources/types'
import type { LoadedSkill } from '../skills/types'
import type { LoadedProject } from '../projects/types'
import type { LoadedPage } from '../pages/types'
import type { KanbanBoardConfig } from '../kanban/types'
import type { CollectionDisplay } from '../sessions/collection-display-storage'
import type { CollectionFilters } from '../sessions/collection-types'

import type { ToolStatus } from '../toolchain/types'
import { RPC_CHANNELS } from './channels'
import type {
  SessionEvent,
  UnreadSummary,
  UpdateInfo,
  BrowserInstanceInfo,
  DeepLinkNavigation,
  TaskGenerateResult,
  NoteChangedPayload,
  KnowledgeChangedPayload,
  SiyuanSurfaceState,
  ExtensionSurfaceState,
  SessionsBulkChangedEvent,
} from './dto'
import type { ExtensionsChangedPayload } from '../extensions/types'
import type { CommandBusPushEvent } from '../commands/push'
import type { VoicePrefs } from '../voice/types.ts'
import type { MemoryDreamEvent, MemoryDreamRun } from '../memory/repo'
import type { OverlayState } from '../voice/overlay-types.ts'
import type { VoiceJob } from '../voice/job-machine.ts'
import type { TalkEvent } from '../voice/talk-events.ts'
import type { TtsStreamChunk } from '../voice/tts/streaming.ts'
import type { RealtimeTranscriptionEvent } from '../voice/realtime-transcription.ts'
import type { VoiceWakeChangedPayload, VoiceWakeTrigger } from '../voice/wake-list.ts'
import type { PodcastJob } from '../voice/podcast-job.ts'
import type { DevSpaceCloneProgress, DevSpaceRepositoryStatus, DevSpaceRunProgress } from '../dev-space/types.ts'
import type { EnvironmentPrefs } from '../environment'
import type { PrivacyDto } from '../privacy/types.ts'
import type { ServiceStatus, TrayStatus } from '../service-lifecycle.ts'
import type { ClipChangedPayload } from '../clipboard-history/types'

/** Payload of marketplace:CHANGED — pushed after an install/update/remove completes. */
export interface MarketplaceChangedPayload {
  id: string
  action: 'installed' | 'updated' | 'removed'
  /** Pinned source ref when known (absent for remove-what-we-never-installed). */
  ref?: string
}

/** Payload of marketplace:progress — live install/update phases. */
export interface MarketplaceProgressPayload {
  id: string
  phase: 'clone' | 'verify' | 'install' | 'fetch' | 'collision'
  detail?: string
}

export interface BroadcastEventMap {
  [RPC_CHANNELS.workspaceWork.CHANGED]: [workspaceId: string, revision: number]
  // Session events (workspace-scoped via broadcastToWorkspace)
  [RPC_CHANNELS.sessions.EVENT]: [event: SessionEvent]
  [RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED]: [summary: UnreadSummary]
  [RPC_CHANNELS.sessions.FILES_CHANGED]: [sessionId: string]
  [RPC_CHANNELS.sessions.BULK_CHANGED]: [event: SessionsBulkChangedEvent]

  // Domain change broadcasts (global via broadcastToAll)
  [RPC_CHANNELS.sources.CHANGED]: [workspaceId: string, sources: LoadedSource[]]
  [RPC_CHANNELS.sources.INDEX_CHANGED]: [
    workspaceId: string,
    payload: {
      indexed: number
      written?: number
      unchanged?: number
      truncated: boolean
    },
  ]
  [RPC_CHANNELS.labels.CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.statuses.CHANGED]: [workspaceId: string]
  // Entities (W1-02) — local link store changed for a workspace.
  [RPC_CHANNELS.entities.LINKS_CHANGED]: [workspaceId: string]
  // W1-03 (#1500) — command bus push (realtime event frames, bus status).
  [RPC_CHANNELS.commands.EVENT]: [workspaceId: string, event: CommandBusPushEvent]
  // Toolchain install progress (global, local toolchain)
  [RPC_CHANNELS.toolchain.STATUS_CHANGED]: [status: ToolStatus]
  [RPC_CHANNELS.automations.CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.skills.CHANGED]: [workspaceId: string, skills: LoadedSkill[]]
  [RPC_CHANNELS.skillsPending.CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.memory.CHANGED]: [workspaceId: string | null, scope: 'global' | 'workspace' | 'both']
  // Memory repository projection + dream (spec 2026-10-09 §7). Bank-scoped:
  // `memory:repoChanged[0]` is a bankId, dream payloads carry their own bankId.
  [RPC_CHANNELS.memory.REPO_CHANGED]: [bankId: string, reason: string]
  [RPC_CHANNELS.memory.DREAM_EVENT]: [event: MemoryDreamEvent]
  [RPC_CHANNELS.memory.DREAM_DONE]: [run: MemoryDreamRun]
  [RPC_CHANNELS.memory.REPO_IMPORT_READY]: [bankId: string, count: number]
  [RPC_CHANNELS.projects.CHANGED]: [workspaceId: string, projects: LoadedProject[]]
  [RPC_CHANNELS.pages.CHANGED]: [workspaceId: string, pages: LoadedPage[]]
  [RPC_CHANNELS.kanban.CHANGED]: [workspaceId: string, config: KanbanBoardConfig]
  [RPC_CHANNELS.personalTasks.CHANGED]: [payload: { at: number }]
  [RPC_CHANNELS.feed.CHANGED]: [payload: { at: number }]
  [RPC_CHANNELS.collection.CHANGED]: [workspaceId: string, display: CollectionDisplay]
  [RPC_CHANNELS.collection.FILTERS_CHANGED]: [workspaceId: string, filtersByKey: Record<string, CollectionFilters>]

  [RPC_CHANNELS.tasks.GENERATED]: [workspaceId: string, result: TaskGenerateResult]
  [RPC_CHANNELS.notes.CHANGED]: [payload: NoteChangedPayload]
  [RPC_CHANNELS.knowledge.CHANGED]: [payload: KnowledgeChangedPayload]
  [RPC_CHANNELS.llmConnections.CHANGED]: []
  [RPC_CHANNELS.identity.CHANGED]: []
  [RPC_CHANNELS.extensions.CHANGED]: [payload: ExtensionsChangedPayload]
  [RPC_CHANNELS.permissions.DEFAULTS_CHANGED]: [value: null]
  [RPC_CHANNELS.gamification.CHANGED]: [payload: {
    xp: number
    level: number
    balance: number | null
    progress: number
    xpIntoLevel: number
    xpForNext: number
    nextThreshold: number | null
  }]
  [RPC_CHANNELS.privacy.CHANGED]: [payload: PrivacyDto]
  [RPC_CHANNELS.voice.CHANGED]: [payload: VoicePrefs]
  [RPC_CHANNELS.voice.JOB]: [payload: VoiceJob]
  [RPC_CHANNELS.voice.OVERLAY]: [payload: OverlayState]
  [RPC_CHANNELS.voice.HOTKEY]: [payload: import('../voice/hotkey-types').VoiceHotkeyPayload]
  [RPC_CHANNELS.voice.TALK_EVENT]: [payload: TalkEvent]
  [RPC_CHANNELS.voice.TTS_STREAM_CHUNK]: [payload: TtsStreamChunk]
  [RPC_CHANNELS.voice.STT_EVENT]: [payload: RealtimeTranscriptionEvent]
  [RPC_CHANNELS.voice.WAKE_CHANGED]: [payload: VoiceWakeChangedPayload]
  [RPC_CHANNELS.voice.TRIGGER]: [payload: VoiceWakeTrigger]
  [RPC_CHANNELS.environment.CHANGED]: [payload: EnvironmentPrefs]

  // Developer Space (02-SPEC-foundations §5–§6) — repository + run push (local-only).
  [RPC_CHANNELS.devSpace.CLONE_PROGRESS]: [payload: DevSpaceCloneProgress]
  [RPC_CHANNELS.devSpace.CHANGED]: [payload: { repositoryId: string; status: DevSpaceRepositoryStatus }]
  [RPC_CHANNELS.devSpace.RUN_PROGRESS]: [payload: DevSpaceRunProgress]
  [RPC_CHANNELS.devSpace.SOFT_SIGNAL]: [payload: { kind: 'repo-link-pasted' | 'git-detected' }]
  // Podcast generation (D13) — replaces `voice:job` for the podcast flow.
  [RPC_CHANNELS.podcast.JOB]: [payload: PodcastJob]

  // Theme broadcasts (global)
  [RPC_CHANNELS.appearance.SHELL_CHANGED]: [snapshot: {
    flag: 'shell.zen.v1'
    enabled: boolean
    preference: 'system' | 'glass' | 'opaque'
    material: 'vibrancy' | 'mica' | 'solid'
    platform: 'darwin' | 'win32' | 'linux' | 'web'
    fallbackReason?: string
  }]
  [RPC_CHANNELS.theme.APP_CHANGED]: [theme: ThemeOverrides | null]
  [RPC_CHANNELS.theme.SYSTEM_CHANGED]: [isDark: boolean]
  [RPC_CHANNELS.theme.PREFERENCES_CHANGED]: [preferences: { mode: string; colorTheme: string; font: string }]
  [RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED]: [data: { workspaceId: string; themeId: string | null }]

  // Update broadcasts (global)
  [RPC_CHANNELS.update.AVAILABLE]: [info: UpdateInfo]
  [RPC_CHANNELS.update.DOWNLOAD_PROGRESS]: [progress: number]

  // Badge broadcasts (global)
  [RPC_CHANNELS.badge.DRAW]: [data: { count: number; iconDataUrl: string }]
  [RPC_CHANNELS.badge.DRAW_WINDOWS]: [data: { count: number }]

  // Window events (per-window)
  [RPC_CHANNELS.window.FOCUS_STATE]: [isFocused: boolean]
  [RPC_CHANNELS.window.CLOSE_REQUESTED]: []

  // Browser pane events (global)
  [RPC_CHANNELS.browserPane.STATE_CHANGED]: [info: BrowserInstanceInfo]
  [RPC_CHANNELS.browserPane.REMOVED]: [id: string]
  [RPC_CHANNELS.browserPane.INTERACTED]: [id: string]

  // Browser Intelligence Pipeline (global, local-only). Payload shapes mirror
  // `@rox/browser-intel` PipelineProgress / BrowserIntelState; they are declared
  // inline rather than imported because that package already depends on
  // @rox/shared, so a protocol-level import would create a dependency cycle.
  [RPC_CHANNELS.browserIntel.PROGRESS]: [progress: {
    stage: 'detect' | 'scan' | 'stage' | 'hindsight' | 'ingest' | 'unfurl' | 'aggregate' | 'synthesize'
    message: string
    current: number
    total: number
    startedAt: number
  }]
  [RPC_CHANNELS.browserIntel.STATE_CHANGED]: [state: {
    consent: boolean
    consentAt: number | null
    lastRunAt: number | null
    lastResult: {
      profiles: number
      visits: number
      urls: number
      slots: number
      errors: number
    } | null
    error: string | null
    revision: number
  }]

  // SiYuan engine surface events (global; workspace isolation renderer-side)
  [RPC_CHANNELS.siyuan.STATE_CHANGED]: [state: SiyuanSurfaceState]
  [RPC_CHANNELS.siyuan.REMOVED]: [id: string]

  // Extension UI surface events (global; workspace isolation renderer-side)
  [RPC_CHANNELS.extensionSurface.STATE_CHANGED]: [state: ExtensionSurfaceState]
  [RPC_CHANNELS.extensionSurface.REMOVED]: [id: string]

  // Navigation events (per-window)
  [RPC_CHANNELS.notification.NAVIGATE]: [data: { workspaceId: string; sessionId: string }]
  [RPC_CHANNELS.deeplink.NAVIGATE]: [navigation: DeepLinkNavigation]

  // Copilot device code event
  [RPC_CHANNELS.copilot.DEVICE_CODE]: [data: { userCode: string; verificationUri: string }]

  // Rox History — clipboard history changed (global, local-only store).
  [RPC_CHANNELS.clipboard.CHANGED]: [payload: ClipChangedPayload]
  // Knowledge map — rebuild signal pushed after a watcher-triggered re-scan;
// consumers re-fetch via knowledgeMap:get (mirrors contextDocs:CHANGED).
  [RPC_CHANNELS.knowledgeMap.CHANGED]: []
  // Context documents broadcasts (global)
  [RPC_CHANNELS.contextDocs.CHANGED]: []

  // Bundled skill packs (global) — disabled list changed
  [RPC_CHANNELS.bundledSkills.CHANGED]: [payload: { disabled: string[] }]

  // Marketplace broadcasts (global) — pushed after an install/update/remove completes
  [RPC_CHANNELS.marketplace.PROGRESS]: [payload: MarketplaceProgressPayload]
  [RPC_CHANNELS.marketplace.CHANGED]: [payload: MarketplaceChangedPayload]

  // Menu events (per-window, no payload)
  [RPC_CHANNELS.menu.NEW_CHAT]: []
  [RPC_CHANNELS.menu.OPEN_SETTINGS]: []
  [RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS]: []
  [RPC_CHANNELS.menu.TOGGLE_FOCUS_MODE]: []
  [RPC_CHANNELS.menu.TOGGLE_SIDEBAR]: []
  [RPC_CHANNELS.menu.TOGGLE_INSPECTOR]: []
  [RPC_CHANNELS.menu.TOGGLE_CHAT_PICTURE_IN_PICTURE]: []
  // Tray shell (e2.1) — navigation dispatch + live status indicator.
  [RPC_CHANNELS.menu.OPEN_DASHBOARD]: []
  [RPC_CHANNELS.menu.OPEN_NATIVE_CONSOLE]: []
  [RPC_CHANNELS.menu.SHOW_SERVICE_STATUS]: []
  [RPC_CHANNELS.menu.RUN_DOCTOR]: []
  [RPC_CHANNELS.menu.TRAY_STATUS_CHANGED]: [status: TrayStatus]
  // Service lifecycle (e1.4/e1.5) — status transitions pushed to the UI.
  [RPC_CHANNELS.serviceLifecycle.STATUS_CHANGED]: [status: ServiceStatus]

  // Messaging gateway broadcasts
  [RPC_CHANNELS.messaging.BINDING_CHANGED]: [workspaceId: string]
  [RPC_CHANNELS.messaging.PLATFORM_STATUS]: [workspaceId: string, platform: string, status: {
    platform: string
    configured: boolean
    connected: boolean
    state: 'disconnected' | 'connecting' | 'connected' | 'reconnect_required' | 'error'
    identity?: string
    lastError?: string
    updatedAt: number
  }]
}
