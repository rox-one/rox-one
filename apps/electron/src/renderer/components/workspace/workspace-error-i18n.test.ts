import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const picker = readFileSync(join(import.meta.dir, 'WorkspacePicker.tsx'), 'utf8')
const connectRemote = readFileSync(
  join(import.meta.dir, 'AddWorkspaceStep_ConnectRemote.tsx'),
  'utf8',
)

describe('workspace picker and remote-connect error copy is i18n', () => {
  it('WorkspacePicker uses i18n fallbacks instead of hardcoded English', () => {
    expect(picker).toContain("t('workspace.loadFailed')")
    expect(picker).toContain("t('toast.failedToCreateWorkspace')")
    expect(picker).not.toContain("'Failed to load workspaces'")
    expect(picker).not.toContain("'Failed to create workspace'")
  })

  it('ConnectRemote uses i18n fallbacks instead of hardcoded English', () => {
    expect(connectRemote).toContain("t('workspace.connectionFailed')")
    expect(connectRemote).toContain("t('workspace.reconnectFailed')")
    expect(connectRemote).toContain("t('workspace.createRemoteFailed')")
    expect(connectRemote).not.toContain("'Connection failed'")
    expect(connectRemote).not.toContain("'Failed to reconnect workspace'")
    expect(connectRemote).not.toContain("'Failed to create workspace on remote server'")
  })
})
