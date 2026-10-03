import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const host = readFileSync(join(__dirname, '../InspectorHost.tsx'), 'utf8')
const consumer = readFileSync(join(__dirname, '../ConnectionInfoSection.tsx'), 'utf8')
  + readFileSync(join(__dirname, '../../pages/ConnectionLifecyclePanel.tsx'), 'utf8')
const page = readFileSync(join(__dirname, '../../pages/ConnectionsPage.tsx'), 'utf8')

describe('CF-6.4 InspectorHost connections', () => {
  it('specializes the info section for the connections navigator', () => {
    expect(host).toContain('isConnectionsNavigation')
    expect(host).toContain('ConnectionInfoSection')
    expect(consumer).toContain('projectConnectionInspector')
    expect(consumer).toContain('selectedConnectionAtom')
    expect(consumer).toContain('inspector.field.provider')
    expect(consumer).toContain('inspector.field.storageMode')
    expect(consumer).toContain('inspector.field.credentialRef')
    expect(consumer).toContain('inspector.field.scopes')
    expect(host.toLowerCase()).not.toContain('<iframe')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('lets the services list publish a selected connection into the inspector', () => {
    expect(page).toContain('selectedConnectionAtom')
    expect(page).toContain('aria-selected')
    expect(page).toContain('data-testid="connections-row"')
  })

  it('exposes test, repair, and confirmed rotate without secret fields', () => {
    expect(consumer).toContain('testConnection')
    expect(consumer).toContain('repairConnection')
    expect(consumer).toContain('rotateConnection')
    expect(consumer).toContain('connections.test')
    expect(consumer).toContain('connections.repair')
    expect(consumer).toContain('connections.rotate')
    expect(consumer).toContain('connections.rotateConfirm')
    expect(consumer).toContain('workspaceId')
    expect(host.toLowerCase()).not.toContain('<iframe')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })
})
