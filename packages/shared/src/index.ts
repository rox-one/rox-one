/**
 * @rox/shared
 *
 * Shared business logic for ROX.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { CraftAgent } from '@rox/shared/agent';
 *   import { loadStoredConfig } from '@rox/shared/config';
 *   import { getCredentialManager } from '@rox/shared/credentials';
 *   import { CraftMcpClient } from '@rox/shared/mcp';
 *   import { debug } from '@rox/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@rox/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@rox/shared/workspaces';
 *
 * Available modules:
 *   - agent: CraftAgent SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
