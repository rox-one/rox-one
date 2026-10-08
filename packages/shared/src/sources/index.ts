/**
 * Sources Module
 *
 * Public exports for source management.
 */

// Types
export type {
  SourceType,
  SourceMcpAuthType,
  ApiAuthType,
  KnownProvider,
  ApiOAuthProvider,
  ApiOAuthConfig,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConnectionStatus,
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
  ApiRenewEndpoint,
} from './types.ts';

// Constants and helpers
export {
  API_OAUTH_PROVIDERS,
  isApiOAuthProvider,
  isGenericOAuthSource,
  hasRenewEndpoint,
  isRefreshableSource,
} from './types.ts';

// Storage functions
export {
  // Directory utilities
  ensureSourcesDir,
  getSourcePath,
  // Config operations
  loadSourceConfig,
  saveSourceConfig,
  markSourceAuthenticated,
  // Guide operations
  loadSourceGuide,
  saveSourceGuide,
  // Icon operations
  findSourceIcon,
  downloadSourceIcon,
  sourceNeedsIconDownload,
  isIconUrl,
  // Load operations
  loadSource,
  loadWorkspaceSources,
  loadAllSources,
  getEnabledSources,
  isSourceUsable,
  getLocalSourceFolderState,
  getSourcesBySlugs,
  // Create/Delete operations
  generateSourceSlug,
  createSource,
  deleteSource,
  sourceExists,
  // Parsing utilities
  parseGuideMarkdown,
} from './storage.ts';

// Credential Manager (unified credential operations)
export {
  SourceCredentialManager,
  getSourceCredentialManager,
  getSourcesNeedingAuth,
} from './credential-manager.ts';
export type {
  AuthResult,
  ApiCredential,
  BasicAuthCredential,
} from './credential-manager.ts';

// Server Builder (builds MCP/API servers from sources)
export {
  SourceServerBuilder,
  getSourceServerBuilder,
  normalizeMcpUrl,
  SERVER_BUILD_ERRORS,
} from './server-builder.ts';
export type {
  McpServerConfig,
  SourceWithCredential,
  BuiltServers,
} from './server-builder.ts';

// Built-in source templates and generated local source seeders
export {
  getDocsSource,
  getBuiltinSources,
  applyBuiltinSourceAvailability,
  isBuiltinSource,
  ensureBuiltinSources,
  ensureLocalNotesSource,
  hasExaKey,
  hasFirecrawlKey,
  estimateSourceGuideTokens,
  formatTokenEstimate,
  BUILTIN_SOURCE_SLUGS,
  type BuiltinSourceSlug,
} from './builtin-sources.ts';

export {
  collectDefaultEnabledSourceSlugs,
  ensureDefaultMicroserviceSources,
  DEFAULT_ENABLED_LOCAL_SOURCE_SLUGS,
  DEFAULT_ENABLED_MCP_SOURCE_SLUGS,
  DEFAULT_ENABLED_SOURCE_SLUGS,
} from './default-microservices.ts';
export type { MicroserviceSeedOptions } from './default-microservices.ts';

export {
  ensureBuiltinMcpInstalled,
  builtinMcpManagedCommand,
  BuiltinMcpInstallError,
  BUILTIN_WINDOWS_MCP_RELEASES,
  BUILTIN_EVERYTHING_CLI_RELEASE,
} from './builtin-mcp-installer.ts';
export type { BuiltinMcpInstallOptions, BuiltinMcpInstallResult } from './builtin-mcp-installer.ts';

export {
  BUILTIN_MCP_CATALOG,
  BUILTIN_AGENT_SKILL_PACKS,
  ensureBuiltinMcpSources,
  getDefaultMcpSourceSlugs,
  getEnabledBuiltinMcpSourceSlugs,
  getBuiltinMcpReadiness,
  isManagedBuiltinMcpSource,
  buildRuntimeBuiltinMcpConfig,
} from './builtin-mcp.ts';
export type { BuiltinMcpSpec, BuiltinMcpOptions, BuiltinMcpReadiness } from './builtin-mcp.ts';
export { ensureBuiltinQmdCollection, BUILTIN_QMD_PACKAGE, BUILTIN_QMD_INDEX } from './builtin-mcp-qmd.ts';
export type { BuiltinQmdCollectionResult } from './builtin-mcp-qmd.ts';

export {
  computeSourceTokenStats,
  type SourceFileStat,
  type SourceTokenStats,
} from './source-stats.ts';

// API Tools
export {
  executeApiRequest,
  ApiResponseTooLargeError,
} from './api-tools.ts';
export type {
  SummarizeCallback,
  ApiCredentialSource,
  ApiRequestInput,
  ExecuteApiRequestOptions,
  ApiRequestOutcome,
} from './api-tools.ts';

// Token Refresh Manager (handles OAuth token refresh with rate limiting)
export {
  TokenRefreshManager,
  createTokenGetter,
} from './token-refresh-manager.ts';
export type {
  TokenRefreshResult,
  RefreshManagerOptions,
} from './token-refresh-manager.ts';
