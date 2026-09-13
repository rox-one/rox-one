import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../AddWorkspaceStep_ConnectRemote.tsx'), 'utf8')

describe('ConnectRemote i18n chrome', () => {
  it('routes leftover English chrome through t() and PremiumMenuSelect', () => {
    expect(source).toContain('workspace.connectRemote')
    expect(source).toContain('workspace.reconnectHint')
    expect(source).toContain('workspace.serverUrl')
    expect(source).toContain('workspace.tokenLabel')
    expect(source).toContain('workspace.testConnection')
    expect(source).toContain('workspace.createOnServer')
    expect(source).toContain('workspace.createAndConnect')
    expect(source).toContain('common.back')
    expect(source).toContain('PremiumMenuSelect')
    expect(source).not.toContain('>Back<')
    expect(source).not.toContain('Connect to remote server')
    expect(source).not.toContain('Use existing workspace')
    expect(source).not.toContain('<Select')
  })
})
