import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const host = readFileSync(join(__dirname, '../InspectorHost.tsx'), 'utf8')
const page = readFileSync(join(__dirname, '../../pages/ConnectionsPage.tsx'), 'utf8')

describe('CF-6.4 InspectorHost connections', () => {
  it('specializes the info section for the connections navigator', () => {
    expect(host).toContain('isConnectionsNavigation')
    expect(host).toContain('projectConnectionInspector')
    expect(host).toContain('selectedConnectionAtom')
    expect(host).toContain('inspector.field.provider')
    expect(host).toContain('inspector.field.storageMode')
    expect(host).toContain('inspector.field.credentialRef')
    expect(host).toContain('inspector.field.scopes')
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
    expect(host).toContain('testConnection')
    expect(host).toContain('repairConnection')
    expect(host).toContain('rotateConnection')
    expect(host).toContain('connections.test')
    expect(host).toContain('connections.repair')
    expect(host).toContain('connections.rotate')
    expect(host).toContain('connections.rotateConfirm')
    expect(host).toContain('workspaceId')
    expect(host.toLowerCase()).not.toContain('<iframe')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('surfaces inspector action errors and lists consumers before mutate', () => {
    expect(host).toContain('errorMessage')
    expect(host).toContain('connections-inspector-error')
    expect(host).toContain('listConnectionBindings')
    expect(host).toContain('sanitizeConnectionBindingRows')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('reloads inspector consumers when the selected row is refreshed after unbind', () => {
    expect(host).toContain('listConnectionBindings')
    expect(page).toContain('applySelectedRow(listed, binding.connectionId)')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('reloads inspector consumers when the selected row is refreshed after grant', () => {
    expect(host).toContain('listConnectionBindings')
    expect(page).toContain('confirmGrant')
    expect(page).toContain('applySelectedRow(listed, connectionId)')
    const start = page.indexOf('const confirmGrant = async () => {')
    const end = page.indexOf('const pathField =', start)
    const grant = page.slice(start, end)
    expect(grant.indexOf('setBindingRows')).toBeLessThan(grant.indexOf('applySelectedRow(listed, connectionId)'))
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('moves the selected connection after naming affected consumers', () => {
    expect(host).toContain('moveConnection')
    expect(host).toContain('connections.moveConfirm')
    expect(host).toContain('MOVE_BACKENDS')
    expect(host).toContain('connections-inspector-move-confirm-target')
    expect(host).toContain('formatConfirmLeases')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('binds inspector move backend picker props on the select, not as text children', () => {
    expect(host).toMatch(/<select\s+className="rounded border bg-transparent px-2 py-1 font-mono text-\[12px\]"/)
    expect(host).not.toMatch(/<select>\s+className=/)
    expect(host).toContain('value={moveTarget}')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('loads metadata-only health, expiry, and provenance for the selected connection', () => {
    expect(host).toContain('inspectConnection')
    expect(host).toContain('projectConnectionInspect')
    expect(host).toContain('inspector.field.health')
    expect(host).toContain('inspector.field.expiry')
    expect(host).toContain('inspector.field.provenance')
    expect(host).toContain('inspector.field.fingerprint')
    expect(host).toContain('connections-inspector-health')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('offers an in-place reconnect CTA for stale inspect without stealing focus', () => {
    expect(host).toContain('isStaleInspect')
    expect(host).toContain('reconnectConnection')
    expect(host).toContain('connections.reconnect')
    expect(host).toContain('connections.reconnectConfirm')
    expect(host).toContain('connections-inspector-reconnect')
    expect(host).toContain('connections-reconnect-confirm-target')
    expect(host).toContain('formatConfirmLeases')
    expect(host).not.toContain('autoFocus')
    expect(host).not.toContain('bringToFront')
    expect(host).not.toContain('bring_to_front')
    expect(host).not.toContain('window.focus')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('pre-lists active leases on inspector rotate and move confirm', () => {
    expect(host).toContain('previewActiveLeases')
    expect(host).toContain('formatConfirmLeases')
    expect(host).toContain('connections-inspector-rotate-confirm-target')
    expect(host).toContain('connections-inspector-move-confirm-target')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('pre-lists active leases on inspector reconnect confirm', () => {
    expect(host).toContain('listConnectionLeases')
    expect(host).toContain('sanitizeActiveLeases')
    expect(host).toContain('formatConfirmLeases')
    expect(host).toContain('previewReconnect')
    expect(host).toContain('connections-reconnect-confirm-target')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('names invalidated leases after reconnect without leaking secret fields', () => {
    expect(host).toContain('sanitizeReconnectLeases')
    expect(host).toContain('formatReconnectLeases')
    expect(host).toContain('connections-inspector-leases')
    expect(host).toContain('inspector.field.leases')
    expect(host).toContain('connections.reconnectDone')
    expect(host).toContain('result.leases')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('names invalidated leases after rotate and move without leaking secret fields', () => {
    expect(host).toContain('applyRevokedLeases')
    expect(host.split('applyRevokedLeases(result.leases)').length - 1).toBe(3)
    expect(host.split("next === '—' ? '' : next").length - 1).toBe(2)
    expect(host).toContain('rotateConnection')
    expect(host).toContain('moveConnection')
    expect(host).toContain('connections-inspector-leases')
    expect(host).toContain('connections.reconnectDone')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('refreshes inspect after rotate and move without leaking secret fields', () => {
    expect(host).toContain('applyInspect')
    expect(host.split('applyInspect(result.inspect)').length - 1).toBe(4)
    expect(host).toContain('projectConnectionInspect')
    expect(host).toContain('rotateConnection')
    expect(host).toContain('moveConnection')
    expect(host).toContain('connections-inspector-health')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('reads storageMode from the selected connection atom, not a stale copy', () => {
    expect(host).toContain('selectedConnectionAtom')
    expect(host).toContain('projectConnectionInspector')
    expect(host).toContain('inspector.field.storageMode')
    expect(page).toContain('applySelectedRow')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('refreshes inspect after repair without leaking secret fields', () => {
    expect(host).toContain('repairConnection')
    expect(host).toContain('applyInspect(result.inspect)')
    expect(host).toContain('connections-inspector-health')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('loads latest audit metadata for the selected connection without secret fields', () => {
    expect(host).toContain('listConnectionAudit')
    expect(host).toContain('sanitizeConnectionAuditRows')
    expect(host).toContain('latestConnectionAudit')
    expect(host).toContain('formatConnectionAudit')
    expect(host).toContain('connections-inspector-audit')
    expect(host).toContain('inspector.field.audit')
    expect(host).toContain('connectionId: selected.id')
    expect(host).not.toMatch(/\/token\//)
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows grant resources for inspector consumers without secret fields', () => {
    expect(host).toContain('connections-inspector-resources')
    expect(host).toContain('inspector.field.resources')
    expect(host).toContain('row.resources')
    expect(host).toContain('sanitizeConnectionBindingRows')
    expect(host).not.toMatch(/\/token\//)
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows grant actions for inspector consumers without secret fields', () => {
    expect(host).toContain('connections-inspector-actions')
    expect(host).toContain('inspector.field.actions')
    expect(host).toContain('row.actions')
    expect(host).toContain('sanitizeConnectionBindingRows')
    expect(host).not.toMatch(/\/token\//)
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('reloads inspector binding actions and resources after rotate, move, repair, and reconnect', () => {
    expect(host).toContain('applyConsumers')
    expect(host.split('void applyConsumers()').length - 1).toBe(4)
    expect(host).not.toContain('setConsumers(result.consumers)')
    expect(host).toContain('connections-inspector-actions')
    expect(host).toContain('connections-inspector-resources')
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows revalidation status after rotate, move, repair, and reconnect without leaking secret fields', () => {
    expect(host).toContain('applyRevalidated')
    expect(host.split('applyRevalidated(result.consumers)').length - 1).toBe(4)
    expect(host).toContain("setRevalidated('')")
    expect(host).toContain('connections-inspector-revalidated')
    expect(host).toContain('inspector.field.revalidated')
    expect(host).toContain('sanitizeReconnectLeases')
    expect(host).not.toContain('setConsumers(result.consumers)')
    expect(host).toContain("next === '—' ? '' : next")
    expect(host.toLowerCase()).not.toContain('infisical')
    expect(host).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })
})
