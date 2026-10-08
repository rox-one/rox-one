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
import { registerMeetingHandlers } from './meetings.ts'
import { registerFilesHandlers } from './files'
import { registerLabelsHandlers } from './labels'
import { registerOrgsHandlers } from './orgs'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerRuntimeTraceHandlers } from './runtime-trace'
import { registerSessionForeignImportHandlers } from './session-foreign-import'
import { registerNotesHandlers, cleanupNotesWatchForClient } from './notes'
import { registerNativeDataHandlers } from './native-data.ts'
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
import { registerEnvironmentHandlers } from './environment'
import { registerProjectsHandlers } from './projects'
import { registerCodeIntelligenceHandlers } from './code-intelligence'
import { registerPagesHandlers } from './pages'
import { registerKanbanHandlers } from './kanban'
import { registerPersonalTasksHandlers } from './personal-tasks'
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
import { registerSkillsPendingHandlers } from './skills-pending'
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
  registerMeetingHandlers(server, deps)
  registerBundledSkillsHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerOrgsHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
  registerResourcesHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  registerRuntimeTraceHandlers(server, deps)
  registerSessionForeignImportHandlers(server, deps)
  if (serverCtx) registerServerHandlers(server, deps, serverCtx)
  registerSettingsHandlers(server, deps)
  registerGamificationHandlers(server, deps)
  registerPrivacyHandlers(server, deps)
  registerVoiceHandlers(server, deps)
  registerEnvironmentHandlers(server, deps)
  registerProjectsHandlers(server, deps)
  registerCodeIntelligenceHandlers(server, deps)
  registerPagesHandlers(server, deps)
  registerKanbanHandlers(server, deps)
  registerPersonalTasksHandlers(server, deps)
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
  registerSkillsPendingHandlers(server, deps)
  registerNotesHandlers(server, deps)
  if (deps.nativeData) registerNativeDataHandlers(server, deps)
  registerKnowledgeHandlers(server, deps)
  registerMindmapHandlers(server, deps)
  registerBrowserProfileImportHandlers(server, deps)
  registerEntitiesHandlers(server, deps, options?.entities ?? { enabledWorkbenchFlags: getEntitiesWorkbenchFlags })
  // W1-03 (#1500)
  registerCommandsHandlers(server, deps, options?.commands)
  if (options?.browserPane !== false) registerBrowserPaneHandlers(server, deps)
}
