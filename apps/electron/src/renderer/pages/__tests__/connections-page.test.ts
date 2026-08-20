import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(__dirname, '../ConnectionsPage.tsx'), 'utf8')

describe('CF-6.2 ConnectionsPage', () => {
  it('exposes the five native tabs and no iframe or secret fields', () => {
    expect(page).toContain("'services'")
    expect(page).toContain("'credentials'")
    expect(page).toContain("'imports'")
    expect(page).toContain("'policies'")
    expect(page).toContain("'audit'")
    expect(page.toLowerCase()).not.toContain('<iframe')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('loads the workgraph connection list for the active workspace', () => {
    expect(page).toContain('listConnections')
    expect(page).toContain('sanitizeConnectionRows')
  })

  it('exposes a masked GitHub env import on the Imports tab', () => {
    expect(page).toContain('previewGithubEnv')
    expect(page).toContain('importGithubEnv')
    expect(page).toContain('maskedSummary')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('exposes a masked git-credential-helper import on the Imports tab', () => {
    expect(page).toContain('previewGitHelper')
    expect(page).toContain('importGitHelper')
    expect(page).toContain('gitConfigPath')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('revokes a listed connection without exposing secret fields', () => {
    expect(page).toContain('revokeConnection')
    expect(page).toContain('connections.revoke')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('confirms before revoking a connection', () => {
    expect(page).toContain('connections.revokeConfirm')
    expect(page).toContain('connections.revokeCancel')
    expect(page).toContain('confirmingId')
  })

  it('renders credential and policy metadata from listed connections', () => {
    expect(page).toContain("tab === 'credentials'")
    expect(page).toContain("tab === 'policies'")
    expect(page).toContain('row.scopes')
    expect(page).toContain('row.credentialRefId')
  })

  it('selects a service row for the inspector host', () => {
    expect(page).toContain('selectedConnectionAtom')
    expect(page).toContain('aria-selected')
    expect(page).toContain('data-testid="connections-row"')
  })

  it('tests a listed GitHub connection without exposing secret fields', () => {
    expect(page).toContain('testConnection')
    expect(page).toContain('connections.test')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('rotates a listed connection with confirm', () => {
    expect(page).toContain('rotateConnection')
    expect(page).toContain('connections.rotateConfirm')
  })

  it('repairs a listed connection', () => {
    expect(page).toContain('repairConnection')
    expect(page).toContain('connections.repair')
  })

  it('exposes a native Connect control that lists import sources', () => {
    expect(page).toContain('connections.connect')
    expect(page).toContain('CONNECT_SOURCES')
    expect(page).toContain("'keychain'")
    expect(page).toContain("'adc'")
    expect(page).toContain("'ssh-agent'")
    expect(page.toLowerCase()).not.toContain('<iframe')
  })

  it('loads metadata-only connection audit on the Audit tab', () => {
    expect(page).toContain('listConnectionAudit')
    expect(page).toContain("tab === 'audit'")
    expect(page).toContain('payloadDigest')
    expect(page).toContain('sanitizeConnectionAuditRows')
    expect(page).toContain('occurredAt')
    expect(page).toContain('actorId')
    expect(page).toContain('row.action')
  })

  it('names Connection and CredentialRef on revoke confirm', () => {
    expect(page).toContain('connections-confirm-target')
    expect(page).toContain('row.credentialRefId')
  })

  it('converts a copy connection to reference with confirm', () => {
    expect(page).toContain('convertConnection')
    expect(page).toContain('connections.convertConfirm')
    expect(page).toContain("row.storageMode === 'copy'")
  })

  it('moves a copy connection to another local backend with confirm', () => {
    expect(page).toContain('moveConnection')
    expect(page).toContain('connections.moveConfirm')
    expect(page).toContain('MOVE_BACKENDS')
    expect(page).toContain('connections-move-confirm-target')
    expect(page).toContain('local-alt')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('lists and unbinds connection grants on the Policies tab', () => {
    expect(page).toContain('listConnectionBindings')
    expect(page).toContain('revokeConnectionBinding')
    expect(page).toContain('connections.unbind')
  })

  it('shows grant resources on policy binding rows without secret fields', () => {
    expect(page).toContain('connections-binding-resources')
    expect(page).toContain('row.resources.join')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows grant actions on policy binding rows without secret fields', () => {
    expect(page).toContain('connections-binding-actions')
    expect(page).toContain('row.actions.join')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('refreshes the selected row after unbind so inspector consumers update', () => {
    expect(page).toContain('confirmUnbind')
    expect(page).toContain('applySelectedRow(listed, binding.connectionId)')
    expect(page).toContain('importedConnectionFromList')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('refreshes the selected row after grant so inspector consumers update', () => {
    expect(page).toContain('confirmGrant')
    expect(page).toContain('grantConnection')
    expect(page).toContain('applySelectedRow(listed, connectionId)')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('calls applySelectedRow after bindingRows refresh inside confirmGrant', () => {
    const start = page.indexOf('const confirmGrant = async () => {')
    const end = page.indexOf('const pathField =', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const grant = page.slice(start, end)
    expect(grant).toContain('setBindingRows')
    expect(grant).toContain('listConnectionBindings')
    expect(grant).toContain('applySelectedRow(listed, connectionId)')
    expect(grant.indexOf('setBindingRows')).toBeLessThan(grant.indexOf('applySelectedRow(listed, connectionId)'))
    expect(grant.toLowerCase()).not.toContain('infisical')
    expect(grant).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('exposes masked docker, aws, keychain, adc, and ssh-agent imports', () => {
    expect(page).toContain('previewDockerHelper')
    expect(page).toContain('importDockerHelper')
    expect(page).toContain('dockerConfigPath')
    expect(page).toContain('previewAwsProfiles')
    expect(page).toContain('importAwsProfile')
    expect(page).toContain('previewKeychain')
    expect(page).toContain('importKeychain')
    expect(page).toContain('previewAdc')
    expect(page).toContain('importAdc')
    expect(page).toContain('previewSshAgent')
    expect(page).toContain('importSshAgent')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('keeps the five tab ids unchanged', () => {
    expect(page).toContain("const TABS = ['services', 'credentials', 'imports', 'policies', 'audit']")
    expect(page).toContain('t(`connections.tab.${id}`)')
  })

  it('surfaces import and list errors without secret fields', () => {
    expect(page).toContain('importError')
    expect(page).toContain('listError')
    expect(page).toContain('connections-import-error')
    expect(page).toContain('connections-list-error')
    expect(page).toContain('errorMessage')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows test outcome on the services list', () => {
    expect(page).toContain('testStatusFromResult')
    expect(page).toContain('testStatusFromError')
    expect(page).toContain('connections-test-status')
  })

  it('filters import previews from Connect source chips', () => {
    expect(page).toContain('activeSource')
    expect(page).toContain('matchesConnectSource')
    expect(page).toContain('connections-source-chip')
    expect(page).toContain('aria-pressed')
  })

  it('names affected consumers on revoke confirm', () => {
    expect(page).toContain('connections-confirm-target')
    expect(page).toContain('formatConfirmLeases')
    expect(page).toContain('previewActiveLeases')
  })

  it('fills import path placeholders', () => {
    expect(page).toContain('IMPORT_PLACEHOLDERS')
    expect(page).toContain('placeholder={placeholder}')
    expect(page).toContain('IMPORT_PLACEHOLDERS.env')
    expect(page).toContain('IMPORT_PLACEHOLDERS.gitConfig')
    expect(page).toContain('IMPORT_PLACEHOLDERS.dockerConfig')
    expect(page).toContain('IMPORT_PLACEHOLDERS.adc')
  })

  it('names affected consumers on rotate confirm', () => {
    expect(page).toContain('connections-rotate-confirm-target')
    expect(page).toContain('formatConfirmLeases')
    expect(page).toContain('previewActiveLeases')
  })

  it('scopes import forms to the active Connect chip', () => {
    expect(page).toContain('isImportPanelVisible')
    expect(page).toContain('connections-import-panel')
    expect(page).toContain('data-source')
  })

  it('picks an import path through the existing file dialog', () => {
    expect(page).toContain('openFileDialog')
    expect(page).toContain('firstPickedPath')
    expect(page).toContain('connections-pick-path')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('drops a committed import candidate from the preview list', () => {
    expect(page).toContain('removeCommittedPreview')
  })

  it('keeps audit load errors off the services empty state', () => {
    expect(page).toContain('auditError')
    expect(page).toContain('connections-audit-error')
    expect(page).toContain('setAuditError')
  })

  it('names the Audit empty state separately from the services empty copy', () => {
    expect(page).toContain("tab === 'audit'")
    expect(page).toContain('connections.audit.empty')
    expect(page).toContain('t(`connections.tab.${id}`)')
    expect(page).toContain("const TABS = ['services', 'credentials', 'imports', 'policies', 'audit']")
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('marks tab panels and cycles tabs with arrows', () => {
    expect(page).toContain('role="tabpanel"')
    expect(page).toContain('aria-controls')
    expect(page).toContain('tabFromKey')
    expect(page).toContain('ArrowRight')
    expect(page).toContain('ArrowLeft')
    expect(page).toContain("const TABS = ['services', 'credentials', 'imports', 'policies', 'audit']")
  })

  it('does not treat a pending list load as the empty state', () => {
    expect(page).toContain('connections-loading')
    expect(page).toContain('aria-busy')
  })

  it('renders audit time, actor, and action metadata', () => {
    expect(page).toContain('occurredAt')
    expect(page).toContain('actorId')
    expect(page).toContain('row.action')
  })

  it('creates a metadata-only connection from the Services tab', () => {
    expect(page).toContain('createConnection')
    expect(page).toContain('connections.create')
    expect(page).toContain('connections-create-form')
    expect(page).toContain('createCredentialRef')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('grants a named consumer on the Policies tab', () => {
    expect(page).toContain('grantConnection')
    expect(page).toContain('connections.grant')
    expect(page).toContain('connections-grant-form')
    expect(page).toContain('grantConsumer')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('blocks invalid create and grant drafts before RPC', () => {
    expect(page).toContain('createDraftError')
    expect(page).toContain('grantDraftError')
    expect(page).toContain('connections-form-error')
    expect(page).toContain('parseCsvList')
    expect(page.toLowerCase()).not.toContain('infisical')
  })

  it('selects a created connection into the inspector', () => {
    expect(page).toContain('sanitizeConnectionRows([created])')
  })

  it('selects the listed created row into the inspector after refresh', () => {
    expect(page).toContain('confirmCreate')
    expect(page).toContain('applySelectedRow(listed, row.id)')
    expect(page).toContain('importedConnectionFromList')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('cycles tabs with Home and End', () => {
    expect(page).toContain('tabFromKey')
    expect(page).toContain("'Home'")
    expect(page).toContain("'End'")
    expect(page).toContain("const TABS = ['services', 'credentials', 'imports', 'policies', 'audit']")
  })

  it('starts GitHub device login on Imports without exposing a bearer', () => {
    expect(page).toContain('github-oauth')
    expect(page).toContain('startGithubDeviceLogin')
    expect(page).toContain('pollGithubDeviceLogin')
    expect(page).toContain('sanitizeDeviceLoginStart')
    expect(page).toContain('sanitizeDevicePoll')
    expect(page).toContain('connections-github-device')
    expect(page).toContain('userCode')
    expect(page).toContain('verificationUri')
    expect(page).not.toContain('accessToken')
    expect(page).not.toContain('deviceCode')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('auto-polls GitHub device login on the start interval without a bearer', () => {
    expect(page).toContain('devicePollDelayMs')
    expect(page).toContain('setTimeout')
    expect(page).toContain('clearTimeout')
    expect(page).not.toContain('accessToken')
    expect(page).not.toContain('deviceCode')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('opens GitHub device verification via openUrl without a window or iframe', () => {
    expect(page).toContain('githubDeviceVerificationHref')
    expect(page).toContain('connections-github-device-open')
    expect(page).toContain('connections.import.githubOAuthOpen')
    expect(page).toContain('openUrl')
    expect(page).not.toContain('window.open')
    expect(page.toLowerCase()).not.toContain('<iframe')
    expect(page).not.toContain('accessToken')
    expect(page).not.toContain('deviceCode')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('opens GitHub device verification with the user code and without a window', () => {
    expect(page).toContain('githubDeviceVerificationHref(deviceLogin.verificationUri, deviceLogin.userCode)')
    expect(page).toContain('connections-github-device-open')
    expect(page).toContain('openUrl')
    expect(page).not.toContain('window.open')
    expect(page).not.toContain('accessToken')
    expect(page).not.toContain('deviceCode')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('cancels GitHub device login in place and selects the imported connection without opening a window', () => {
    expect(page).toContain('cancelGithubDeviceLogin')
    expect(page).toContain('cancelDeviceLogin')
    expect(page).toContain('importedConnectionFromList')
    expect(page).toContain('applyDevicePoll')
    expect(page).toContain('connections-github-device-cancel')
    expect(page).toContain('connections.import.githubOAuthCancel')
    expect(page).toContain('connections.import.githubOAuthStatus.')
    expect(page).toContain('setSelected(created)')
    expect(page).not.toContain('window.open')
    expect(page).not.toContain('autoFocus')
    expect(page).not.toContain('bringToFront')
    expect(page).not.toContain('bring_to_front')
    expect(page).not.toContain('window.focus')
    expect(page).not.toContain('accessToken')
    expect(page).not.toContain('deviceCode')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows inspect health on service rows without secret fields', () => {
    expect(page).toContain('inspectConnection')
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('connections-row-health')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows inspect expiry on service rows without secret fields', () => {
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('connections-row-expiry')
    expect(page).toContain('inspectById[row.id].expiry')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows inspect provenance on service rows without secret fields', () => {
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('connections-row-provenance')
    expect(page).toContain('inspectById[row.id].provenance')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows inspect fingerprint on service rows without secret fields', () => {
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('connections-row-fingerprint')
    expect(page).toContain('inspectById[row.id].fingerprint')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows inspect kind on service rows without secret fields', () => {
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('connections-row-kind')
    expect(page).toContain('inspectById[row.id].kind')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows inspect version on service rows without secret fields', () => {
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('connections-row-version')
    expect(page).toContain('inspectById[row.id].versionId')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows inspect expiry and provenance on credential rows without secret fields', () => {
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('connections-credential-expiry')
    expect(page).toContain('connections-credential-provenance')
    expect(page).toContain('connections-credential-kind')
    expect(page).toContain('connections-credential-fingerprint')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('selects credential rows and reconnects stale credentials without stealing focus', () => {
    expect(page).toContain('data-testid="connections-credential-row"')
    expect(page).toContain('connections-credential-health')
    expect(page).toContain('connections-credential-version')
    expect(page).toContain('renderReconnectControls')
    expect(page).toContain('setSelected(row)')
    expect(page).toContain('aria-selected')
    expect(page).toContain('connections.reconnect')
    expect(page).not.toContain('autoFocus')
    expect(page).not.toContain('bringToFront')
    expect(page).not.toContain('bring_to_front')
    expect(page).not.toContain('window.focus')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('offers a reconnect CTA on stale service rows without stealing focus', () => {
    expect(page).toContain('isStaleInspectSummary')
    expect(page).toContain('reconnectConnection')
    expect(page).toContain('connections.reconnect')
    expect(page).toContain('connections.reconnectConfirm')
    expect(page).toContain('connections.reconnectLeases')
    expect(page).toContain('connections-row-reconnect')
    expect(page).toContain('connections-row-reconnect-confirm-target')
    expect(page).toContain('formatConfirmLeases')
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain("const TABS = ['services', 'credentials', 'imports', 'policies', 'audit']")
    expect(page).not.toContain('autoFocus')
    expect(page).not.toContain('bringToFront')
    expect(page).not.toContain('bring_to_front')
    expect(page).not.toContain('window.focus')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('pre-lists active leases on reconnect confirm instead of only binding consumers', () => {
    expect(page).toContain('listConnectionLeases')
    expect(page).toContain('sanitizeActiveLeases')
    expect(page).toContain('formatConfirmLeases')
    expect(page).toContain('previewReconnect')
    expect(page).toContain('connections-row-reconnect-confirm-target')
    expect(page).toContain('connections.reconnectLeases')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('pre-lists active leases on revoke, rotate, convert, and move confirm', () => {
    expect(page).toContain('previewActiveLeases')
    expect(page).toContain('formatConfirmLeases')
    expect(page).toContain('connections-confirm-target')
    expect(page).toContain('connections-rotate-confirm-target')
    expect(page).toContain('connections-convert-confirm-target')
    expect(page).toContain('connections-move-confirm-target')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows invalidated leases after reconnect without leaking secret fields', () => {
    expect(page).toContain('sanitizeReconnectLeases')
    expect(page).toContain('formatReconnectLeases')
    expect(page).toContain('connections-row-leases')
    expect(page).toContain('connections.reconnectDone')
    expect(page).toContain('result.leases')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('shows invalidated leases after rotate, revoke, convert, and move without leaking secret fields', () => {
    expect(page).toContain('applyRevokedLeases')
    expect(page.split('applyRevokedLeases(connectionId, result.leases)').length - 1).toBe(5)
    expect(page).toContain('confirmRotate')
    expect(page).toContain('confirmRevoke')
    expect(page).toContain('confirmConvert')
    expect(page).toContain('confirmMove')
    expect(page).toContain('connections-row-leases')
    expect(page).toContain('connections.reconnectDone')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('refreshes inspect after rotate, revoke, convert, and move without leaking secret fields', () => {
    expect(page).toContain('applyInspect')
    expect(page.split('applyInspect(connectionId, result.inspect)').length - 1).toBe(6)
    expect(page).toContain('inspectSummaryFromRaw')
    expect(page).toContain('confirmRotate')
    expect(page).toContain('confirmRevoke')
    expect(page).toContain('confirmConvert')
    expect(page).toContain('confirmMove')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('refreshes the selected row after convert, move, rotate, and reconnect', () => {
    expect(page).toContain('applySelectedRow')
    expect(page.split('applySelectedRow(listed, connectionId)').length - 1).toBe(6)
    expect(page).toContain('importedConnectionFromList')
    expect(page).toContain('confirmConvert')
    expect(page).toContain('confirmMove')
    expect(page).toContain('confirmRotate')
    expect(page).toContain('confirmReconnect')
    expect(page).toContain('runRepair')
    expect(page).toContain('selectedConnectionAtom')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })

  it('refreshes inspect and selected row after repair without leaking secret fields', () => {
    expect(page).toContain('runRepair')
    expect(page).toContain('repairConnection')
    expect(page).toContain('applyInspect(connectionId, result.inspect)')
    expect(page).toContain('applySelectedRow(listed, connectionId)')
    expect(page.toLowerCase()).not.toContain('infisical')
    expect(page).not.toMatch(/\bpayload\b|\bsecret\b|\brefreshToken\b/)
  })
})



