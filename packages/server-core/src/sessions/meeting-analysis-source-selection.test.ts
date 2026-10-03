import './__test-config-isolation'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addWorkspace } from '@rox/shared/config'
import { ensureBuiltinMcpSources, getEnabledBuiltinMcpSourceSlugs } from '@rox/shared/sources/builtin-mcp'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '@rox/shared/workspaces'
import { loadSession } from '@rox/shared/sessions'
import { SessionManager } from './SessionManager'
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
test('Meeting safe empty-source selection wins built-in workspace defaults and persists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meeting-analysis-sources-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const workspace = addWorkspace({ name: 'Meeting source isolation', rootPath: root })
  ensureBuiltinMcpSources(root)
  const config = loadWorkspaceConfig(root)!
  const defaults = getEnabledBuiltinMcpSourceSlugs(root)
  expect(defaults).toContain('deepwiki')
  expect(defaults).toContain('context7')
  saveWorkspaceConfig(root, { ...config, defaults: { ...config.defaults, enabledSourceSlugs: defaults }, localMcpServers: { enabled: false } })
  const manager = new SessionManager()
  cleanups.push(() => manager.cleanup())
  // Offline creation avoids a model request while exercising the real current
  // source/default resolver, managed session and persisted session header.
  const session = await manager.createSession(workspace.id, { name: 'Meeting analysis', permissionMode: 'safe', enabledSourceSlugs: [] },
    { emitCreatedEvent: false, initialAssistantMessage: 'Source selection fixture' })
  expect(session.enabledSourceSlugs).toEqual([])
  expect(session.permissionMode).toBe('safe')
  expect(manager.getSessionSources(session.id)).toEqual([])
  expect(loadSession(root, session.id)?.enabledSourceSlugs).toEqual([])
  expect(loadWorkspaceConfig(root)!.defaults!.enabledSourceSlugs).toEqual(defaults)
})
