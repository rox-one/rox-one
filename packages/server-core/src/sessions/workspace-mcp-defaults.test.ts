import './__test-config-isolation'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addWorkspace } from '@rox/shared/config'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '@rox/shared/workspaces'
import { SessionManager } from './SessionManager'

const roots: string[] = []
const managers: SessionManager[] = []
afterEach(() => {
  managers.splice(0).forEach(manager => manager.cleanup())
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }))
})

describe('workspace startup MCP default selection', () => {
  for (const selection of [[], ['notes', 'deepwiki']]) {
    it(`preserves the saved selection ${JSON.stringify(selection)} while provisioning missing servers`, () => {
      const root = mkdtempSync(join(tmpdir(), 'workspace-mcp-choice-'))
      roots.push(root)
      const workspace = addWorkspace({ name: 'MCP choices', rootPath: root })
      const config = loadWorkspaceConfig(root)!
      saveWorkspaceConfig(root, {
        ...config, defaults: { ...config.defaults, enabledSourceSlugs: selection },
        localMcpServers: { enabled: false },
      })
      // Reproduce adding a new catalog entry to an existing installation.
      rmSync(join(root, 'sources', 'context7'), { recursive: true, force: true })
      const manager = new SessionManager()
      managers.push(manager)
      manager.setupConfigWatcher(root, workspace.id)
      expect(loadWorkspaceConfig(root)!.defaults!.enabledSourceSlugs).toEqual(selection)
    })
  }
})
