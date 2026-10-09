/**
 * Browser Intelligence Pipeline — public surface.
 *
 * Consumers outside the package (Electron main, tests, scripts) import from
 * here only; the subpath exports exist for modules that want a narrower
 * dependency (the unfurl worker entry, for example).
 */

export * from './types.ts'
export { describeUrl, deriveSearchQuery, SEARCH_QUERY_MAX_LENGTH, type UrlParts } from './url.ts'
export {
  BROWSER_INTEL_STATE_BASENAME,
  BROWSER_STAGING_DIR_NAME,
  CACHE_DIR_NAME,
  INTELLIGENCE_DB_BASENAME,
  INTELLIGENCE_DIR_NAME,
  resolveBrowserIntelPaths,
  stagingDirForProfile,
  stagingDirNameForProfile,
  type BrowserIntelPaths,
} from './paths.ts'
export {
  defaultBrowserIntelState,
  browserIntelStatePath,
  isBrowserIntelConsentGranted,
  readBrowserIntelState,
  recordBrowserIntelError,
  recordBrowserIntelRun,
  setBrowserIntelConsent,
  writeBrowserIntelState,
} from './state.ts'

export * from './db/index.ts'
export * from './acquisition/index.ts'
export * from './hindsight/index.ts'
export * from './insights/index.ts'
export {
  handleUnfurlWorkerMessage,
  runUnfurlBatches,
  startUnfurlWorker,
  unfurlUrl,
  UNFURL_WORKER_ENTRY_ARG,
} from './workers/unfurlWorker.ts'
export { buildUnfurlGraph, DEFAULT_UNFURL_LIMITS, decodeUrlTokens, type UnfurlLimits } from './workers/unfurlCore.ts'
export { runIntelligencePipeline, type PipelineDeps } from './pipeline.ts'