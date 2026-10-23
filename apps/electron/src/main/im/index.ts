/**
 * im — native chat-core messenger relay (deliverable 4).
 *
 * Public surface for the Electron main process: the RPC handler registration,
 * the shared relay service, the flag gate and the optional-module loader.
 */

export { registerImHandlers, HANDLED_CHANNELS } from './handlers'
export {
  ImService,
  getImService,
  setImServiceForTests,
  normalizeImStatus,
  resolveImChatCoreOptionsFromEnv,
  type ImPushSink,
  type ImServiceOptions,
} from './service'
export { loadImChatCore, isChatCoreUnavailableError, CHAT_CORE_MODULE_ID, type LoadImChatCoreInput } from './chat-core-loader'
export {
  isModeMessengerEnabled,
  setImEnabledWorkbenchFlags,
  resetImEnabledWorkbenchFlagsForTests,
  MODE_MESSENGER_ENV_KEY,
  MODE_MESSENGER_WORKBENCH_FLAG,
} from './flags'
export type * from './types'
