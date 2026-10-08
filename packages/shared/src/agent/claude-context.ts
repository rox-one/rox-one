/**
 * Claude Context Factory
 *
 * Creates a SessionToolContext implementation for Claude with full access
 * to Electron internals, credential managers, MCP validation, etc.
 *
 * This enables the shared handlers in session-tools-core to work with
 * Claude's full feature set.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import type {
  SessionToolContext,
  SessionToolCallbacks,
  FileSystemInterface,
  CredentialManagerInterface,
  ValidatorInterface,
  LoadedSource,
  StdioMcpConfig,
  StdioValidationResult,
  HttpMcpConfig,
  McpValidationResult,
  ApiTestResult,
  SourceConfig,
  DeveloperFeedback,
} from '@rox/session-tools-core';
import {
  validateConfig,
  validateSource,
  validateAllSources,
  validateStatuses,
  validatePreferences,
  validateAll,
  validateSkill,
  validateWorkspacePermissions,
  validateSourcePermissions,
  validateAllPermissions,
  validateToolIcons,
} from '../config/validators.ts';
import { validateAutomations } from '../automations/validation.ts';
import {
  validateMcpConnection as validateMcpConnectionImpl,
  validateStdioMcpConnection as validateStdioMcpConnectionImpl,
} from '../mcp/validation.ts';
import {
  loadSourceConfig as loadSourceConfigImpl,
  saveSourceConfig as saveSourceConfigImpl,
  getSourcePath,
} from '../sources/storage.ts';
import type { FolderSourceConfig, LoadedSource as SharedLoadedSource } from '../sources/types.ts';
import { getSourceCredentialManager } from '../sources/index.ts';
import { isMultiHeaderCredential } from '../sources/credential-manager.ts';
import { getSourceServerBuilder } from '../sources/server-builder.ts';
import { buildRuntimeBuiltinMcpConfig, getBuiltinMcpReadiness, isManagedBuiltinMcpSource } from '../sources/builtin-mcp.ts';
import { createHostBashEnv, getToolchain, withToolchainPathPrefix } from '../toolchain-runtime.ts';
import {
  inferGoogleServiceFromUrl,
  inferSlackServiceFromUrl,
  inferMicrosoftServiceFromUrl,
  type GoogleService,
  type SlackService,
  type MicrosoftService,
} from '../sources/types.ts';
import { isGoogleOAuthConfigured as isGoogleOAuthConfiguredImpl } from '../auth/google-oauth.ts';
import { debug } from '../utils/debug.ts';
import { getSessionPlansPath, getSessionPath, getSessionDataPath } from '../sessions/storage.ts';
import { updatePreferences as updatePreferencesImpl } from '../config/preferences.ts';
import { resolveConfigDir } from "../config/paths.ts"

// Re-export types that may be needed by consumers
export type { SessionToolContext, SessionToolCallbacks } from '@rox/session-tools-core';

/**
 * Options for creating a Claude context
 */
export interface ClaudeContextOptions {
  sessionId: string;
  workspacePath: string;
  workspaceId: string;
  onPlanSubmitted: (planPath: string) => void;
  onAuthRequest: (request: unknown) => void;
}

/**
 * Create a SessionToolContext for Claude with full capabilities.
 *
 * This provides:
 * - Full file system access
 * - Full Zod validators
 * - Credential manager with keychain access
 * - MCP connection validation
 * - Icon management
 */
export function createClaudeContext(options: ClaudeContextOptions): SessionToolContext {
  const { sessionId, workspacePath, workspaceId, onPlanSubmitted, onAuthRequest } = options;

  // File system implementation
  const fs: FileSystemInterface = {
    exists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, 'utf-8'),
    readFileBuffer: (path: string) => readFileSync(path),
    writeFile: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
    isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
    readdir: (path: string) => readdirSync(path),
    stat: (path: string) => {
      const stats = statSync(path);
      return {
        size: stats.size,
        isDirectory: () => stats.isDirectory(),
      };
    },
  };

  // Callbacks implementation
  const callbacks: SessionToolCallbacks = {
    onPlanSubmitted,
    onAuthRequest: (request) => onAuthRequest(request),
  };

  // Validators implementation
  const validators: ValidatorInterface = {
    validateConfig: () => validateConfig(),
    validateSource: (wsPath: string, slug: string) => validateSource(wsPath, slug),
    validateAllSources: (wsPath: string) => validateAllSources(wsPath),
    validateStatuses: (wsPath: string) => validateStatuses(wsPath),
    validatePreferences: () => validatePreferences(),
    validatePermissions: (wsPath: string, sourceSlug?: string) => {
      if (sourceSlug) {
        return validateSourcePermissions(wsPath, sourceSlug);
      }
      return validateAllPermissions(wsPath);
    },
    validateAutomations: (wsPath: string) => validateAutomations(wsPath),
    validateToolIcons: () => validateToolIcons(),
    validateAll: (wsPath: string) => validateAll(wsPath),
    validateSkill: (wsPath: string, slug: string) => validateSkill(wsPath, slug),
  };

  // Credential manager adapter
  const credentialManager: CredentialManagerInterface = {
    hasValidCredentials: async (source: LoadedSource): Promise<boolean> => {
      const mgr = getSourceCredentialManager();
      // Convert to shared type (guide not needed for credential operations)
      const sharedSource: SharedLoadedSource = {
        config: source.config as unknown as FolderSourceConfig,
        guide: null,
        folderPath: source.folderPath,
        workspaceRootPath: source.workspaceRootPath,
        workspaceId: source.workspaceId,
      };
      const token = await mgr.getToken(sharedSource);
      return !!token;
    },
    getToken: async (source: LoadedSource): Promise<string | null> => {
      const mgr = getSourceCredentialManager();
      const sharedSource: SharedLoadedSource = {
        config: source.config as unknown as FolderSourceConfig,
        guide: null,
        folderPath: source.folderPath,
        workspaceRootPath: source.workspaceRootPath,
        workspaceId: source.workspaceId,
      };
      return mgr.getToken(sharedSource);
    },
    refresh: async (source: LoadedSource): Promise<string | null> => {
      const mgr = getSourceCredentialManager();
      const sharedSource: SharedLoadedSource = {
        config: source.config as unknown as FolderSourceConfig,
        guide: null,
        folderPath: source.folderPath,
        workspaceRootPath: source.workspaceRootPath,
        workspaceId: source.workspaceId,
      };
      return mgr.refresh(sharedSource);
    },
  };

  // MCP validation
  const resolveStdioMcpSourceConfig: NonNullable<SessionToolContext['resolveStdioMcpSourceConfig']> = async source => {
    const sharedSource: SharedLoadedSource = {
      // source_test may probe a disabled source before offering auto-enable.
      config: { ...source, enabled: true } as unknown as FolderSourceConfig,
      guide: null,
      folderPath: getSourcePath(workspacePath, source.slug),
      workspaceRootPath: workspacePath,
      workspaceId,
    };
    const managed = isManagedBuiltinMcpSource(sharedSource.config);
    const manager = getSourceCredentialManager();
    const [token, credential] = managed
      ? await Promise.all([manager.getToken(sharedSource), manager.getApiCredential(sharedSource)])
      : [null, null];
    const readiness = getBuiltinMcpReadiness(sharedSource.config, {
      token, credential: credential && isMultiHeaderCredential(credential) ? credential : undefined,
      workspaceRootPath: sharedSource.workspaceRootPath, sourceFolderPath: sharedSource.folderPath,
    });
    if (readiness.status !== 'ready') return { config: null, error: readiness.reason || 'MCP source setup is incomplete.' };
    const built = getSourceServerBuilder().buildMcpServer(sharedSource, token, credential);
    if (built?.type !== 'stdio') return { config: null, error: 'No stdio command configured for this MCP source.' };
    return { config: built };
  };

  const resolveHttpMcpSourceConfig: NonNullable<SessionToolContext['resolveHttpMcpSourceConfig']> = async source => {
    const config = { ...source, enabled: true } as unknown as FolderSourceConfig;
    if (config.type !== 'mcp' || config.mcp?.transport === 'stdio' || !isManagedBuiltinMcpSource(config)) return undefined;
    try {
      const sharedSource: SharedLoadedSource = {
        config, guide: null,
        folderPath: getSourcePath(workspacePath, source.slug),
        workspaceRootPath: workspacePath,
        workspaceId,
      };
      const manager = getSourceCredentialManager();
      const [token, credential] = await Promise.all([manager.getToken(sharedSource), manager.getApiCredential(sharedSource)]);
      const builtinOptions = {
        token, credential: credential && isMultiHeaderCredential(credential) ? credential : undefined,
        workspaceRootPath: sharedSource.workspaceRootPath, sourceFolderPath: sharedSource.folderPath,
      };
      const readiness = getBuiltinMcpReadiness(config, builtinOptions);
      if (readiness.status !== 'ready') return { config: null, error: readiness.reason || 'MCP source setup is incomplete.' };
      const built = getSourceServerBuilder().buildMcpServer(sharedSource, token, credential);
      if (!built || built.type === 'stdio') return { config: null, error: 'Could not resolve the remote MCP endpoint. Check source setup and credentials.' };
      const runtimeMcp = buildRuntimeBuiltinMcpConfig(config, builtinOptions).mcp;
      return {
        config: {
          url: built.url,
          transport: built.type,
          headers: built.headers,
          authType: runtimeMcp?.authType,
          accessToken: runtimeMcp?.authType === 'oauth' || runtimeMcp?.authType === 'bearer' ? token ?? undefined : undefined,
        },
      };
    } catch {
      return { config: null, error: 'Could not resolve MCP runtime configuration. Check source setup and credentials.' };
    }
  };

  const validateStdioMcpConnection = async (config: StdioMcpConfig): Promise<StdioValidationResult> => {
    try {
      const inherited = await withToolchainPathPrefix({ ...process.env });
      const env = { ...config.env };
      if (config.env?.PATH === undefined && inherited.PATH !== undefined) env.PATH = inherited.PATH;
      let command = config.command;
      if (/^(?:npx|bun|uvx)$/.test(command) && config.env?.PATH === undefined) {
        command = await getToolchain().resolver.findExecutable(command).catch(() => null) ?? command;
      }
      const result = await validateStdioMcpConnectionImpl({ ...config, command, env });
      return {
        success: result.success,
        error: result.error,
        toolCount: result.tools?.length,
        toolNames: result.tools,
        serverName: result.serverInfo?.name,
        serverVersion: result.serverInfo?.version,
      };
    } catch {
      return { success: false, error: 'MCP validation failed. Check source setup and credentials.' };
    }
  };

  const validateMcpConnection = async (config: HttpMcpConfig): Promise<McpValidationResult> => {
    try {
      const result = await validateMcpConnectionImpl({
        mcpUrl: config.url,
        mcpTransport: config.transport,
        mcpHeaders: config.headers,
        mcpAccessToken: config.accessToken,
      });
      return {
        success: result.success,
        error: result.error,
        needsAuth: result.errorType === 'needs-auth',
        toolCount: result.tools?.length,
        toolNames: result.tools,
        serverName: result.serverInfo?.name,
        serverVersion: result.serverInfo?.version,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }
  };

  // Build context
  const context: SessionToolContext = {
    sessionId,
    workspacePath,
    get sourcesPath() { return join(workspacePath, 'sources'); },
    get skillsPath() { return join(workspacePath, 'skills'); },
    plansFolderPath: getSessionPlansPath(workspacePath, sessionId),
    sessionPath: getSessionPath(workspacePath, sessionId),
    dataPath: getSessionDataPath(workspacePath, sessionId),
    callbacks,
    fs,
    validators,
    credentialManager,
    updatePreferences: (updates: Record<string, unknown>) => {
      updatePreferencesImpl(updates as any);
    },
    submitFeedback: (feedback: DeveloperFeedback) => {
      const feedbackDir = join(resolveConfigDir(), 'feedback');
      mkdirSync(feedbackDir, { recursive: true });
      const filePath = join(feedbackDir, `${feedback.id}.json`);
      writeFileSync(filePath, JSON.stringify(feedback, null, 2), 'utf-8');
      debug('claude-context', `Developer feedback written to ${filePath}`);
    },
    // Source management
    loadSourceConfig: (sourceSlug: string): SourceConfig | null => {
      const config = loadSourceConfigImpl(workspacePath, sourceSlug);
      return config as unknown as SourceConfig | null;
    },
    saveSourceConfig: (source: SourceConfig) => {
      saveSourceConfigImpl(workspacePath, source as unknown as FolderSourceConfig);
    },

    // Service inference
    inferGoogleService: (url?: string): GoogleService | undefined => {
      return inferGoogleServiceFromUrl(url);
    },
    inferSlackService: (url?: string): SlackService | undefined => {
      return inferSlackServiceFromUrl(url);
    },
    inferMicrosoftService: (url?: string): MicrosoftService | undefined => {
      return inferMicrosoftServiceFromUrl(url);
    },

    // OAuth config check
    isGoogleOAuthConfigured: (clientId?: string, clientSecret?: string): boolean => {
      return isGoogleOAuthConfiguredImpl(clientId, clientSecret);
    },

    // MCP validation
    resolveStdioMcpSourceConfig,
    resolveHttpMcpSourceConfig,
    validateStdioMcpConnection,
    validateMcpConnection,

    // Icon helpers (simplified - full implementation would use logo.ts)
    isIconUrl: (value: string): boolean => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },

    deriveServiceUrl: (source: SourceConfig): string | null => {
      if (source.type === 'api' && source.api?.baseUrl) {
        try {
          const url = new URL(source.api.baseUrl);
          return `${url.protocol}//${url.hostname}`;
        } catch {
          return null;
        }
      }
      if (source.type === 'mcp' && source.mcp?.url) {
        try {
          const url = new URL(source.mcp.url);
          return `${url.protocol}//${url.hostname}`;
        } catch {
          return null;
        }
      }
      return null;
    },

    // Session self-management bindings are attached externally via
    // attachSessionSelfManagementBindings() — not part of the factory.
  };

  return context;
}
