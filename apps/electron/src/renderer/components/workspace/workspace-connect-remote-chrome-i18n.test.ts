import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(
  join(import.meta.dir, 'AddWorkspaceStep_ConnectRemote.tsx'),
  'utf8',
)

const KEYS = [
  "t('common.back')",
  "t('common.connect')",
  "t('common.connecting')",
  "t('common.failed')",
  "t('common.reconnect')",
  't("workspace.connectRemote")',
  "t('workspace.connected')",
  "t('workspace.createAndConnect')",
  "t('workspace.createOnServer')",
  "t('workspace.createOnServerHint')",
  "t('workspace.creating')",
  "t('workspace.nameLabel')",
  "t('workspace.noWorkspacesYet')",
  't("workspace.reconnectHint")',
  "t('workspace.reconnecting')",
  "t('workspace.serverUrl')",
  "t('workspace.testConnection')",
  "t('workspace.testing')",
  "t('workspace.tokenLabel')",
  "t('workspace.useExisting')",
  "t('workspace.workspaceLabel')",
] as const

describe('ConnectRemote form chrome is i18n', () => {
  it('uses t() for labels, actions, and status copy', () => {
    for (const fragment of KEYS) {
      expect(source).toContain(fragment)
    }
    expect(source).not.toContain("'Reconnect'")
    expect(source).not.toContain("'Create and Connect'")
    expect(source).not.toContain("'Connecting...'")
    expect(source).not.toContain("'Reconnecting...'")
    expect(source).not.toContain("'Testing...'")
    expect(source).not.toContain("'Test Connection'")
    expect(source).not.toContain("'Failed'")
    expect(source).not.toContain('"Connect to remote server"')
    expect(source).not.toContain('"Update the server URL or token to restore the connection."')
    expect(source).not.toContain('Create new workspace on server')
    expect(source).not.toContain('A workspace will be created on the remote server with this name.')
    expect(source).not.toContain('Use existing workspace')
    expect(source).not.toContain('no workspaces yet')
  })
})
