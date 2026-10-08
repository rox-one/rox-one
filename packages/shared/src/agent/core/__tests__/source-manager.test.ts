/**
 * Tests for SourceManager
 *
 * Tests the centralized source state management used by both
 * ClaudeAgent and PiAgent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SourceManager } from '../source-manager.ts';
import type { LoadedSource } from '../../../sources/types.ts';

// Helper to create mock LoadedSource objects
function createMockSource(
  slug: string,
  overrides: Partial<LoadedSource['config']> = {}
): LoadedSource {
  return {
    config: {
      id: `${slug}-id`,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      slug,
      enabled: true,
      provider: 'test',
      type: 'mcp',
      tagline: `${slug} tagline`,
      ...overrides,
    },
    guide: null,
    folderPath: `/test/sources/${slug}`,
    workspaceRootPath: '/test/workspace',
    workspaceId: 'test-workspace',
  };
}

describe('SourceManager', () => {
  let sourceManager: SourceManager;
  let debugMessages: string[];

  beforeEach(() => {
    debugMessages = [];
    sourceManager = new SourceManager({
      onDebug: (msg) => debugMessages.push(msg),
    });
  });

  describe('State Management', () => {
    it('should start with no active sources', () => {
      expect(sourceManager.getActiveSlugs().size).toBe(0);
      expect(sourceManager.getIntendedSlugs().size).toBe(0);
    });

    it('should update active state from MCP and API servers', () => {
      sourceManager.updateActiveState(['github', 'slack'], ['gmail'], ['github', 'slack', 'gmail']);

      const activeSlugs = sourceManager.getActiveSlugs();
      expect(activeSlugs.has('github')).toBe(true);
      expect(activeSlugs.has('slack')).toBe(true);
      expect(activeSlugs.has('gmail')).toBe(true);
    });

    it('should track intended slugs separately from active slugs', () => {
      // Intended slugs include sources that UI shows as active, even if build failed
      sourceManager.updateActiveState(['github'], [], ['github', 'failing-source']);

      expect(sourceManager.isSourceActive('github')).toBe(true);
      expect(sourceManager.isSourceActive('failing-source')).toBe(false);

      expect(sourceManager.isSourceIntendedActive('github')).toBe(true);
      expect(sourceManager.isSourceIntendedActive('failing-source')).toBe(true);
    });

    it('should log debug messages about source state', () => {
      sourceManager.setAllSources([createMockSource('github'), createMockSource('failing-source')]);
      sourceManager.updateActiveState(['github'], [], ['github', 'failing-source']);

      expect(debugMessages.some(m => m.includes('Active sources'))).toBe(true);
      expect(debugMessages.some(m => m.includes('failed builds'))).toBe(true);
    });
  });

  describe('Local folder sources', () => {
    let workspace: string;
    beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'source-manager-')); });
    afterEach(() => { rmSync(workspace, { recursive: true, force: true }); });

    function local(slug: string, path: string, enabled = true): LoadedSource {
      return { ...createMockSource(slug, {
        type: 'local', enabled, local: { path }, connectionStatus: 'failed',
        connectionError: 'stale server error',
      }), workspaceRootPath: workspace, folderPath: join(workspace, 'sources', slug), guide: { raw: '# Local guide' } };
    }

    for (const order of ['sources-first', 'servers-first']) {
      it(`counts selected readable folders without failed builds (${order})`, () => {
        const sources = [local('notes', workspace), local('missing', join(workspace, 'absent')),
          local('disabled', workspace, false), local('unselected', workspace), createMockSource('broken-mcp')];
        const selected = ['notes', 'missing', 'disabled', 'broken-mcp'];
        const before = JSON.stringify(sources);
        if (order === 'sources-first') sourceManager.setAllSources(sources);
        sourceManager.updateActiveState([], [], selected);
        if (order === 'servers-first') sourceManager.setAllSources(sources);

        expect([...sourceManager.getActiveSlugs()]).toEqual(['notes']);
        expect(sourceManager.isSourceActive('notes')).toBe(true);
        expect(sourceManager.isSourceActive('missing')).toBe(false);
        expect(sourceManager.isSourceActive('disabled')).toBe(false);
        expect(sourceManager.isSourceActive('unselected')).toBe(false);
        const failed = debugMessages.filter(m => m.includes('failed builds'));
        expect(failed).toEqual(['Sources with failed builds: broken-mcp']);
        const context = sourceManager.formatSourceState();
        expect(context).toContain('notes (local files)');
        expect(context).toContain('missing (folder unavailable)');
        expect(context).toContain('disabled (disabled)');
        expect(context).toContain('broken-mcp (no tools)');
        expect(context).toContain(`Local folder notes: ${workspace}`);
        expect(context).not.toContain('notes (no tools)');
        expect(context).not.toContain('stale server error');
        expect(context).not.toContain('server is unreachable');
        expect(context).not.toContain('calls are blocked');
        expect(context).not.toContain('WILL BE REJECTED');
        expect(context).toContain('filesystem tools');
        // Paths and filesystem instructions must persist after introductions.
        expect(sourceManager.formatSourceState()).toContain(`Local folder notes: ${workspace}`);
        expect(JSON.stringify(sources)).toBe(before);
      });
    }

    it('refreshes folder evidence and source replacement without another server update', () => {
      const folder = join(workspace, 'notes');
      sourceManager.updateActiveState([], [], ['notes']);
      sourceManager.setAllSources([local('notes', folder)]);
      expect(sourceManager.isSourceActive('notes')).toBe(false);
      mkdirSync(folder);
      expect(sourceManager.isSourceActive('notes')).toBe(true);
      expect(sourceManager.formatSourceState()).not.toContain('<source_issue');
      rmSync(folder, { recursive: true });
      writeFileSync(folder, 'not a directory');
      expect(sourceManager.getActiveSlugs().has('notes')).toBe(false);
      expect(sourceManager.formatSourceState()).toContain('folder unavailable');
      sourceManager.setAllSources([local('notes', workspace)]);
      expect(sourceManager.isSourceActive('notes')).toBe(true);
      sourceManager.setAllSources([]);
      expect(sourceManager.isSourceActive('notes')).toBe(false);
    });

    it('resolves folder paths against the workspace and source folder, not cwd', () => {
      const data = join(workspace, 'sources', 'notes', 'data');
      mkdirSync(data, { recursive: true });
      for (const path of ['sources/notes/data', '${WORKSPACE}/sources/notes/data', '${SOURCE_DIR}/data']) {
        sourceManager.setAllSources([local('notes', path)]);
        sourceManager.updateActiveState([], [], ['notes']);
        expect(sourceManager.isSourceActive('notes')).toBe(true);
        expect(sourceManager.formatSourceState()).toContain(`Local folder notes: ${data}`);
      }
    });

    it('handles omitted selection and explicit deselection in either setter order', () => {
      sourceManager.updateActiveState(['mcp'], []);
      sourceManager.setAllSources([local('notes', workspace), local('disabled', workspace, false)]);
      expect(sourceManager.getIntendedSlugs().has('notes')).toBe(true);
      expect(sourceManager.getActiveSlugs().has('notes')).toBe(true);
      expect(sourceManager.getIntendedSlugs().has('disabled')).toBe(false);
      sourceManager.updateActiveState([], [], []);
      expect(sourceManager.getActiveSlugs().size).toBe(0);
    });

    it('never auto-activates fictional MCP tools for local folders, including missing folders', () => {
      sourceManager.setAllSources([local('notes', workspace), local('missing', join(workspace, 'missing'))]);
      sourceManager.updateActiveState([], [], []);
      for (const slug of ['notes', 'missing']) {
        expect(sourceManager.detectInactiveSourceToolError(`mcp__${slug}__read`, 'No such tool available')).toBeNull();
      }
    });

    it('classifies an all-local selection by filesystem evidence, including missing configuration', () => {
      const unconfigured = local('unconfigured', '');
      sourceManager.setAllSources([local('notes', workspace), unconfigured]);
      sourceManager.updateActiveState([], [], ['notes', 'unconfigured']);
      expect(debugMessages.some(m => m.includes('failed builds'))).toBe(false);
      const context = sourceManager.formatSourceState();
      expect(context).toContain('notes (local files)');
      expect(context).toContain('Local folder path is not configured');
      expect(context).not.toContain('no tools');
      expect(context).not.toContain('server is unreachable');
    });
  });

  describe('Source Collection Management', () => {
    it('should store and retrieve all sources', () => {
      const sources = [
        createMockSource('github'),
        createMockSource('slack'),
        createMockSource('gmail'),
      ];

      sourceManager.setAllSources(sources);

      const retrieved = sourceManager.getAllSources();
      expect(retrieved.length).toBe(3);
      expect(retrieved[0]?.config.slug).toBe('github');
    });
  });

  describe('Source Visibility Tracking', () => {
    it('should track which sources have been seen', () => {
      sourceManager.markSourceSeen('github');

      // This is internal state, verified through formatSourceState behavior
      // When sources are "seen", they won't show introduction text again
    });

    it('should mark sources as unseen', () => {
      sourceManager.markSourceSeen('github');
      sourceManager.markSourceUnseen('github');

      // Source will show introduction text again
    });

    it('should reset all seen sources', () => {
      sourceManager.markSourceSeen('github');
      sourceManager.markSourceSeen('slack');
      sourceManager.resetSeenSources();

      // All sources will show introduction text again
    });
  });

  describe('Inactive Source Detection', () => {
    beforeEach(() => {
      // Set up sources where github is active but slack is inactive
      sourceManager.setAllSources([
        createMockSource('github'),
        createMockSource('slack'),
      ]);
      sourceManager.updateActiveState(['github'], [], ['github']);
    });

    it('should detect inactive source tool errors', () => {
      const result = sourceManager.detectInactiveSourceToolError(
        'mcp__slack__api_slack',
        'No such tool available: mcp__slack__api_slack'
      );

      expect(result).not.toBeNull();
      expect(result?.sourceSlug).toBe('slack');
      expect(result?.toolName).toBe('mcp__slack__api_slack');
    });

    it('should not detect errors for active sources', () => {
      const result = sourceManager.detectInactiveSourceToolError(
        'mcp__github__api_github',
        'No such tool available: mcp__github__api_github'
      );

      // github is active, so this shouldn't be detected as inactive source error
      expect(result).toBeNull();
    });

    it('should not detect errors for non-MCP tools', () => {
      const result = sourceManager.detectInactiveSourceToolError(
        'Bash',
        'Command failed: ls'
      );

      expect(result).toBeNull();
    });

    it('should handle "Tool not found" error pattern', () => {
      const result = sourceManager.detectInactiveSourceToolError(
        'mcp__slack__post_message',
        "Tool 'mcp__slack__post_message' not found"
      );

      expect(result).not.toBeNull();
      expect(result?.sourceSlug).toBe('slack');
    });
  });

  describe('Source State Formatting', () => {
    beforeEach(() => {
      sourceManager.setAllSources([
        createMockSource('github', { enabled: true, tagline: 'GitHub integration' }),
        createMockSource('slack', { enabled: true, tagline: 'Slack messaging' }),
        createMockSource('disabled-source', { enabled: false, tagline: 'Disabled' }),
      ]);
    });

    it('should format source state with active and inactive sources', () => {
      sourceManager.updateActiveState(['github'], [], ['github']);

      const formatted = sourceManager.formatSourceState();

      expect(formatted).toContain('<sources>');
      expect(formatted).toContain('</sources>');
      expect(formatted).toContain('Active: github');
      expect(formatted).toContain('slack (inactive)');
    });

    it('should show "Active: none" when no sources are active', () => {
      sourceManager.updateActiveState([], [], []);

      const formatted = sourceManager.formatSourceState();

      expect(formatted).toContain('Active: none');
    });

    it('should include taglines for new sources', () => {
      sourceManager.updateActiveState(['github'], [], ['github']);

      const formatted = sourceManager.formatSourceState();

      // First call should include taglines for unseen sources
      expect(formatted).toContain('github');
      expect(formatted).toContain('GitHub integration');
    });

    it('should mark sources with failed builds', () => {
      // github is intended but not actually active (build failed)
      sourceManager.updateActiveState([], [], ['github']);

      const formatted = sourceManager.formatSourceState();

      expect(formatted).toContain('github (no tools)');
    });

    it('keeps relevant source usage and availability guidance after introductions', () => {
      sourceManager.updateActiveState(['github'], [], ['github', 'slack']);

      sourceManager.formatSourceState();
      const nextTurn = sourceManager.formatSourceState();

      expect(nextTurn).toContain('Use connected source tools whenever relevant to the task');
      expect(nextTurn).toContain('Call only tools present in the live tool definitions');
      expect(nextTurn).toContain('slack (no tools)');
      expect(nextTurn).not.toContain('GitHub integration');
    });

    it('keeps missing Weaviate setup visible on later turns without calling it a failed server', () => {
      const source = createMockSource('weaviate', {
        id: 'builtin-mcp-weaviate', connectionStatus: 'untested',
        connectionError: 'Set WEAVIATE_URL to a running database with MCP enabled.',
        mcp: { transport: 'http', url: 'https://weaviate.invalid/v1/mcp', authType: 'none' },
      });
      sourceManager.setAllSources([source]);
      sourceManager.updateActiveState([], [], ['weaviate']);
      sourceManager.formatSourceState();
      const nextTurn = sourceManager.formatSourceState();
      expect(nextTurn).toContain('weaviate (no tools)');
      expect(nextTurn).toContain('Set WEAVIATE_URL');
      expect(nextTurn).toContain('awaiting setup');
      expect(nextTurn).not.toContain("server is unreachable");
      expect(nextTurn).not.toContain('Re-authenticate');
    });

    it('describes a network outage on an authenticated source without asking for another credential', () => {
      sourceManager.setAllSources([createMockSource('mem0', {
        connectionStatus: 'failed', connectionError: 'HTTP 503: service unavailable', isAuthenticated: true,
        mcp: { transport: 'http', url: 'https://mcp.mem0.ai/mcp', authType: 'bearer' },
      })]);
      sourceManager.updateActiveState([], [], ['mem0']);
      sourceManager.formatSourceState();
      const nextTurn = sourceManager.formatSourceState();
      expect(nextTurn).toContain('mem0 (no tools)');
      expect(nextTurn).toContain('HTTP 503');
      expect(nextTurn).toContain('server is unreachable');
      expect(nextTurn).not.toContain('Re-authenticate');
      expect(nextTurn).not.toContain('source_credential_prompt');
    });
  });

  describe('Authentication Utilities', () => {
    it('offers credentials for a managed Telegram stdio source missing account setup', () => {
      const keys = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION_STRING', 'TELEGRAM_SESSION_NAME'];
      const saved = keys.map(key => process.env[key]);
      try {
        keys.forEach(key => delete process.env[key]);
        const source = createMockSource('telegram-mcp', {
          id: 'builtin-mcp-telegram-mcp',
          provider: 'telegram-mcp',
          connectionStatus: 'needs_auth',
          mcp: { transport: 'stdio', command: 'uvx', authType: 'none' },
        });
        expect(sourceManager.getAuthToolName(source)).toBe('source_credential_prompt');
        sourceManager.setAllSources([source]);
        sourceManager.updateActiveState([], [], ['telegram-mcp']);
        expect(sourceManager.formatSourceState()).toContain('Re-authenticate using source_credential_prompt');
      } finally {
        keys.forEach((key, index) => {
          if (saved[index] === undefined) delete process.env[key];
          else process.env[key] = saved[index];
        });
      }
    });

    it('does not ask for credentials for an ordinary public stdio server', () => {
      const source = createMockSource('public-local', {
        mcp: { transport: 'stdio', command: 'node', authType: 'none' },
      });
      expect(sourceManager.getAuthToolName(source)).toBeNull();
    });

    it('should return correct auth tool for OAuth MCP sources', () => {
      const source = createMockSource('oauth-source', {
        type: 'mcp',
        mcp: { url: 'https://example.com/mcp', authType: 'oauth' },
      });

      const authTool = sourceManager.getAuthToolName(source);
      expect(authTool).toBe('source_oauth_trigger');
    });

    it('should return correct auth tool for bearer MCP sources', () => {
      const source = createMockSource('bearer-source', {
        type: 'mcp',
        mcp: { url: 'https://example.com/mcp', authType: 'bearer' },
      });

      const authTool = sourceManager.getAuthToolName(source);
      expect(authTool).toBe('source_credential_prompt');
    });

    it('should return correct auth tool for Google API sources', () => {
      const source = createMockSource('google-source', {
        type: 'api',
        provider: 'google',
        api: { baseUrl: 'https://www.googleapis.com', authType: 'oauth' },
      });

      const authTool = sourceManager.getAuthToolName(source);
      expect(authTool).toBe('source_google_oauth_trigger');
    });

    it('should return correct auth tool for Slack API sources', () => {
      const source = createMockSource('slack-source', {
        type: 'api',
        provider: 'slack',
        api: { baseUrl: 'https://slack.com/api', authType: 'oauth' },
      });

      const authTool = sourceManager.getAuthToolName(source);
      expect(authTool).toBe('source_slack_oauth_trigger');
    });

    it('should return null for sources without auth', () => {
      const source = createMockSource('no-auth-source', {
        type: 'mcp',
        mcp: { url: 'https://example.com/mcp', authType: 'none' },
      });

      const authTool = sourceManager.getAuthToolName(source);
      expect(authTool).toBeNull();
    });
  });
});
