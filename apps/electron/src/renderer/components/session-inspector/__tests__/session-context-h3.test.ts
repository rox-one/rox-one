import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const panel = readFileSync(join(__dirname, '..', 'SessionContextPanel.tsx'), 'utf8')
const permission = readFileSync(
  join(__dirname, '..', '..', 'app-shell', 'input', 'structured', 'PermissionRequest.tsx'),
  'utf8',
)
const status = readFileSync(
  join(__dirname, '..', '..', '..', 'platform', 'StatusBarHost.tsx'),
  'utf8',
)

describe('H3 agent intel wiring', () => {
  it('renders a read-only context dashboard behind the agent-intel flag', () => {
    expect(panel).toContain('featureWorkbenchHarnessAgentIntelV1Atom')
    expect(panel).toContain('assembleContextShares')
    expect(panel).toContain('applyMcpLens')
    expect(panel).toContain('data-testid="session-context-dashboard"')
    expect(panel).not.toMatch(/onClick.*Allow/)
  })

  it('keeps Allow as a user click — shadow review cannot grant', () => {
    expect(permission).toContain('reviewPermissionShadow')
    expect(permission).toContain('data-testid="permission-shadow-review"')
    expect(permission).toContain('onClick={handleAllow}')
    const shadowStart = permission.indexOf('data-testid="permission-shadow-review"')
    const actionsStart = permission.indexOf('Action buttons')
    expect(shadowStart).toBeGreaterThan(0)
    expect(permission.slice(shadowStart, actionsStart)).not.toContain('onResponse')
    expect(permission).toContain("onResponse({ type: 'permission', allowed: true, alwaysAllow: false })")
  })

  it('does not invent a fallback model id', () => {
    expect(status).toContain('resolveModelFallbackStatus(null)')
    expect(status).toContain("t('workbench.status.fallbackUnverified')")
  })
})
