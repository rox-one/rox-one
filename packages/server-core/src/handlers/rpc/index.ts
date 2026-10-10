import type { RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAuthHandlers } from './auth'
import { registerCloudRunsHandlers } from './cloud-runs'
import { registerOpenClawHandlers } from './openclaw'
import { registerCommandGatewayHandlers } from './command-gateway'
import { registerNotesImportHandlers } from './notes-import'
import { registerIdentityHandlers } from './identity'
import { registerFabricHandlers } from './fabric'
import { registerExtensionsHandlers } from './extensions'
import { registerPluginBridgeHandlers } from './plugin-bridge'
import { registerAutomationsHandlers } from './automations'
import { registerContextDocsHandlers } from './context-docs'
import { registerBundledSkillsHandlers } from './bundled-skills'
import { registerMarketplaceHandlers } from './marketplace'
import { registerRoversHandlers } from './rovers'
import { registerMeetingHandlers } from './meetings.ts'
import { registerFilesHandlers } from './files'
import { registerLabelsHandlers } from './labels'
import { registerOrgsHandlers } from './orgs'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerCalendarGoogleHandlers } from './calendar-google'
import { registerCalendarAppleHandlers } from './calendar-apple'
import { registerGoogleMeetHandlers } from './google-meet'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { registerOnboardingSuggestHandlers } from './onboarding-suggest'
import { registerOnboardingPermissionsHandlers } from './onboarding-permissions'
import { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerRuntimeTraceHandlers } from './runtime-trace'
import { registerSessionForeignImportHandlers } from './session-foreign-import'
import { registerNotesHandlers, cleanupNotesWatchForClient } from './notes'
import { registerKnowledgeMapHandlers } from './knowledge-map'
import { registerNativeDataHandlers } from './native-data.ts'
import { registerTgLinkHandlers } from './tg-link.ts'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
export { cleanupNotesWatchForClient } from './notes'
import { registerKnowledgeHandlers, cleanupKnowledgeWatchForClient } from './knowledge'
import { registerMindmapHandlers } from './mindmap'
import { registerServerHandlers } from './server'
import type { ServerHandlerContext } from '../../bootstrap/headless-start'
export type { ServerHandlerContext } from '../../bootstrap/headless-start'
export { getHealthCheck } from './server'
import { registerSettingsHandlers } from './settings'
import { registerGamificationHandlers } from './gamification'
import { registerPrivacyHandlers } from './privacy'
import { registerVoiceHandlers } from './voice'
import { registerVoiceRealtimeHandlers } from './voice-realtime'
import { registerEnvironmentHandlers } from './environment'
import { registerProjectsHandlers } from './projects'
import { registerCodeIntelligenceHandlers } from './code-intelligence'
import { registerDevSpaceHandlers, DEFAULT_ENVIRONMENT as DEV_SPACE_DEFAULT_ENVIRONMENT, type HandlerEnvironment as DevSpaceHandlerEnvironment } from './dev-space'
import { registerPodcastHandlers, DEFAULT_ENVIRONMENT as PODCAST_DEFAULT_ENVIRONMENT, type HandlerEnvironment as PodcastHandlerEnvironment } from '../../playbooks/jobs.ts'
import { registerCodebookHandlers, DEFAULT_ENVIRONMENT as CODEBOOK_DEFAULT_ENVIRONMENT, type HandlerEnvironment as CodebookHandlerEnvironment } from '../../playbooks/codebook/index.ts'
import { registerPagesHandlers } from './pages'
import { registerKanbanHandlers } from './kanban'
import { registerPersonalTasksHandlers } from './personal-tasks'
import { registerWorkspaceWorkHandlers } from './workspace-work'
import { registerWorkboardHandlers } from './workboard'
import { registerBoardHandlers } from './board'
import { registerFeedHandlers } from './feed'
import { registerCollectionHandlers } from './collection'

import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerSystemCoreHandlers } from './system'
import { registerTasksHandlers } from './tasks'
import { registerToolchainHandlers } from './toolchain'
import { registerTransferHandlers } from './transfer'
import { registerWorkspaceCoreHandlers } from './workspace'
import { registerMessagingHandlers } from './messaging'
import { registerMemoryHandlers } from './memory'
import { registerMemoryProposalHandlers } from './memory-proposals'
import { registerMemoryIoHandlers } from './memory-io'
import { registerMemoryInsightsHandlers } from './memory-insights'
import { registerMemoryRepoHandlers, startMemoryRepoRuntime } from './memory-repo'
import { registerSkillsPendingHandlers } from './skills-pending'
import { registerLearningHandlers } from './learning'
export function cleanupCoreClientResources(clientId: string): void {
  cleanupSessionFileWatchForClient(clientId)
  cleanupNotesWatchForClient(clientId)
  cleanupKnowledgeWatchForClient(clientId)
}
import { registerBrowserPaneHandlers } from './browser-pane'
import { registerBrowserProfileImportHandlers } from './browser-profile-import'
import { registerEntitiesHandlers, type EntitiesHandlerRuntime } from './entities.ts'
import { getEntitiesWorkbenchFlags } from '../../entities/workbench-flags.ts'
// W1-03 (#1500)
import { registerCommandsHandlers, type CommandsHandlerRuntime } from './commands.ts'
// W1-04 (#1501)
import { registerDirectoryHandlers } from './directory.ts'
// f.9 — node/device registry handlers (only when the host composes a registry).
import { registerNodeHandlers } from './nodes.ts'
export { registerNodeHandlers } from './nodes.ts'
// ROX Drive (wave 1)
import { registerDriveHandlers } from './drive.ts'

export interface CoreRpcRegistrationOptions {
  /**
   * Register browser-pane:* channels (standalone/headless server needs them
   * for the Web UI). Set to false when the host app registers its own
   * browser-pane handlers (electron GUI) — the RpcServer rejects duplicate
   * channel registrations and the app fails to boot.
   */
  browserPane?: boolean
  /**
   * Runtime for the entity handlers. Defaults to the process-wide live
   * workbench-flag source (Electron main publishes renderer toggles there);
   * pass an explicit runtime in tests. The flag is read live on every call —
   * never a registration-time snapshot — with `CRAFT_FEATURE_ENTITIES_LINKS`
   * as the env override.
   */
  entities?: EntitiesHandlerRuntime
  // W1-03 (#1500)
  /** Runtime for the command bus handlers (live `commands.bus.v1`, default OFF). */
  commands?: CommandsHandlerRuntime
  /**
   * Optional Dev Space environment. The host composes `resolveGithubToken` from
   * its credential fabric; without it dev-space stays a public-only host.
   */
  devSpace?: Partial<DevSpaceHandlerEnvironment>
  /**
   * Optional podcast environment. The host composes the scenario model connector
   * and may substitute the synthesizer; without a connector, `podcast:start`
   * honestly answers `connector-unavailable` instead of inventing a script.
   */
  podcast?: Partial<PodcastHandlerEnvironment>
  /**
   * Optional codebook environment (В5). The host composes the artifact
   * resolver/publisher and may substitute the agent runner; without an artifact
   * resolver an `artifact` cell answers `artifact-unavailable`, and without a
   * session mechanism an `agent` cell does the same — never invented output.
   */
  codebook?: Partial<CodebookHandlerEnvironment>
}

export function registerCoreRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
  options?: CoreRpcRegistrationOptions,
): void {
  registerAuthHandlers(server, deps)
  registerCloudRunsHandlers(server, deps)
  registerIdentityHandlers(server, deps)
  registerOpenClawHandlers(server, deps)
  registerCommandGatewayHandlers(server, deps)
  registerNotesImportHandlers(server)
  registerFabricHandlers(server, deps)
  registerExtensionsHandlers(server, deps)
  registerPluginBridgeHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  registerContextDocsHandlers(server, deps)
  registerMarketplaceHandlers(server, deps)
  registerRoversHandlers(server, deps)
  registerMeetingHandlers(server, deps)
  registerBundledSkillsHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerOrgsHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerCalendarGoogleHandlers(server, deps)
  // Apple Calendar (R8, macOS EventKit) — read-only local sync via the host helper.
  registerCalendarAppleHandlers(server, deps)
  // Google Meet artifacts (wave 5, row d2.6) — read-only Developer-Preview surface.
  registerGoogleMeetHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
  registerOnboardingSuggestHandlers(server, deps)
  registerOnboardingPermissionsHandlers(server, deps)
  registerResourcesHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  registerRuntimeTraceHandlers(server, deps)
  registerSessionForeignImportHandlers(server, deps)
  if (serverCtx) registerServerHandlers(server, deps, serverCtx)
  registerSettingsHandlers(server, deps)
  registerGamificationHandlers(server, deps)
  registerPrivacyHandlers(server, deps)
  registerVoiceHandlers(server, deps)
  registerVoiceRealtimeHandlers(server, deps)
  registerEnvironmentHandlers(server, deps)
  registerProjectsHandlers(server, deps)
  registerCodeIntelligenceHandlers(server, deps)
  registerDevSpaceHandlers(server, deps, options?.devSpace
    ? { ...DEV_SPACE_DEFAULT_ENVIRONMENT, ...options.devSpace }
    : DEV_SPACE_DEFAULT_ENVIRONMENT)
  // Podcast (D13) — local render pipeline; the scenario connector is host-composed.
  registerPodcastHandlers(server, deps, { ...PODCAST_DEFAULT_ENVIRONMENT, ...options?.podcast })
  // Codebook (В5) — local notebook runs; agent/artifact seams are host-composed.
  registerCodebookHandlers(server, deps, { ...CODEBOOK_DEFAULT_ENVIRONMENT, ...options?.codebook })
  registerPagesHandlers(server, deps)
  registerKanbanHandlers(server, deps)
  registerPersonalTasksHandlers(server, deps)
  registerWorkspaceWorkHandlers(server, deps)
  registerWorkboardHandlers(server, deps)
  registerBoardHandlers(server, deps)
  registerFeedHandlers(server, deps)
  registerCollectionHandlers(server, deps)

  registerSkillsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
  registerTasksHandlers(server, deps)
  registerToolchainHandlers(server, deps)
  registerTransferHandlers(server)
  registerWorkspaceCoreHandlers(server, deps)
  registerMessagingHandlers(server, deps)
  registerMemoryHandlers(server, deps)
  registerMemoryProposalHandlers(server, deps)
  registerMemoryIoHandlers(server, deps)
  registerMemoryInsightsHandlers(server, deps)
  // Wave A: process-wide repo projection + dream runtime, then bind the RPC
  // bridge (registerMemoryRepoHandlers also wires A8's import handlers).
  startMemoryRepoRuntime({ server, deps })
  registerMemoryRepoHandlers(server, deps)
  registerSkillsPendingHandlers(server, deps)
  registerLearningHandlers(server, deps)
  registerNotesHandlers(server, deps)
  registerKnowledgeMapHandlers(server)
  if (deps.nativeData) registerNativeDataHandlers(server, deps)
  registerKnowledgeHandlers(server, deps)
  registerMindmapHandlers(server, deps)
  registerBrowserProfileImportHandlers(server, deps)
  registerEntitiesHandlers(server, deps, options?.entities ?? { enabledWorkbenchFlags: getEntitiesWorkbenchFlags })
  // R4: Telegram account linking (local rox-tg-linkd daemon).
  registerTgLinkHandlers(server)
  // W1-03 (#1500)
  registerCommandsHandlers(server, deps, options?.commands)
  // W1-04 (#1501): Dossier export IPC (flag contacts.dossier-export.v1, default OFF).
  registerDirectoryHandlers(server, deps, { enabledWorkbenchFlags: getEntitiesWorkbenchFlags })
  // f.9 — node/device registry. Registered only when the host composes a
  // registry (mirrors the nativeData gating) so hosts without device
  // connectivity do not advertise dead node channels.
  if (deps.nodes) registerNodeHandlers(server, deps)
  // ROX Drive (wave 1) — local-first storage surface.
  registerDriveHandlers(server, deps)
  if (options?.browserPane !== false) registerBrowserPaneHandlers(server, deps)
}
