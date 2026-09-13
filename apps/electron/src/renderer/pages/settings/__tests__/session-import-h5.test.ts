import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const page = readFileSync(join(__dirname, '..', 'ImportSettingsPage.tsx'), 'utf8')
const shell = readFileSync(
  join(repoRoot, 'apps/electron/src/renderer/components/app-shell/AppShell.tsx'),
  'utf8',
)
const handler = readFileSync(
  join(repoRoot, 'packages/server-core/src/handlers/rpc/session-foreign-import.ts'),
  'utf8',
)
const advisor = readFileSync(
  join(repoRoot, 'apps/electron/resources/skills/rox-harness/advisor/SKILL.md'),
  'utf8',
)
const simplify = readFileSync(
  join(repoRoot, 'apps/electron/resources/skills/rox-harness/simplify/SKILL.md'),
  'utf8',
)
const registry = readFileSync(join(repoRoot, 'apps/electron/src/shared/settings-registry.ts'), 'utf8')
const pkg = readFileSync(join(repoRoot, 'package.json'), 'utf8')

describe('H5 import and advisor wiring', () => {
  it('exposes scan vs persist on the import settings page', () => {
    expect(registry).toContain("id: 'import' as const")
    expect(page).toContain('foreignDiscoverSessions')
    expect(page).toContain('foreignPersistSessions')
    expect(page).toContain('data-testid="session-import"')
    expect(page).toContain("t('settings.import.truncated'")
    expect(page).not.toContain('spawn_session')
    expect(page).toContain('BrowserProfileImportPanel')
    expect(page).toContain('session-import-select-all')
    expect(page).toContain('filterForeignIndexEntries')
    expect(page).toContain('session-import-search')
    expect(page).toContain('PremiumMenuSelect')
    expect(page).not.toContain('<select')
  })

  it('wires privileged browser profile import with separate OS credential approval', () => {
    const panel = readFileSync(join(__dirname, '..', 'BrowserProfileImportPanel.tsx'), 'utf8')
    const types = readFileSync(join(repoRoot, 'apps/electron/src/shared/types.ts'), 'utf8')
    const handler = readFileSync(
      join(repoRoot, 'packages/server-core/src/handlers/rpc/browser-profile-import.ts'),
      'utf8',
    )
    expect(panel).toContain('data-testid="browser-profile-import"')
    expect(panel).toContain('data-testid="browser-profile-os-approved"')
    expect(panel).toContain('discoverBrowserProfiles')
    expect(panel).toContain('void discover()')
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*void discover\(\)/)
    expect(panel).toContain('importBrowserProfile')
    expect(panel).toContain('osCredentialsApproved')
    expect(types).toContain('discoverBrowserProfiles')
    expect(handler).not.toContain('COOKIE_SECRET')
    expect(handler).toContain('cookie-vault.json')
    expect(handler).toContain('never leave this process')
  })

  it('imports via command without a hidden second agent loop', () => {
    expect(shell).toContain("'sessions.import'")
    expect(shell).toContain("'session.advisor'")
    expect(shell).toContain("'session.simplify'")
    expect(shell).toContain("'session.workflow'")
    expect(shell).toContain("routes.view.settings('import')")
    expect(shell).toContain('craft:restore-input')
    expect(shell).not.toMatch(/session\.advisor[\s\S]{0,400}spawn_session/)
    expect(advisor).toContain('Do not call `spawn_session`')
    expect(simplify).toContain('Do not call `spawn_session`')
  })

  it('does not add dsh-cordis or a DSH store writer', () => {
    expect(existsSync(join(repoRoot, 'apps/electron/src/renderer/platform/ExtensionCenter.tsx'))).toBe(false)
    expect(pkg).not.toContain('dsh-cordis')
    expect(pkg).not.toContain('dsh-')
    expect(handler).not.toContain('~/.dsh')
    expect(handler).not.toContain('session.jsonl.zstd')
    expect(handler).toContain('ingestImportedSession')
    expect(handler).toContain('MAX_FOREIGN_PERSIST')
    expect(handler).toContain('notifySessionCreated')
  })
})
