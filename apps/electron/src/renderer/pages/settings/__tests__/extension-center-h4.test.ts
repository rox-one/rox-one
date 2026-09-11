import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const page = readFileSync(join(__dirname, '..', 'ExtensionsSettingsPage.tsx'), 'utf8')
const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..', '..')
const pkg = readFileSync(join(repoRoot, 'package.json'), 'utf8')
const handler = readFileSync(
  join(repoRoot, 'packages', 'server-core', 'src', 'handlers', 'rpc', 'extensions.ts'),
  'utf8',
)

describe('H4 Extension Center', () => {
  it('puts skills, sources, automations and marketplace on one flagged screen', () => {
    expect(page).toContain('featureWorkbenchHarnessExtCenterV1Atom')
    expect(page).toContain('data-testid="extension-center"')
    expect(page).toContain('data-testid={`extension-center-${groupId}`}')
    expect(page).toContain('EXTENSION_CENTER_GROUPS')
    expect(page).toContain('extensionsSetEnabled')
    expect(page).toContain('renderRecordCard')
    expect(page).toContain('renderCatalogCard')
    expect(page).toContain('!unifiedCenter && section === \'permissions\'')
    expect(page).toContain('!unifiedCenter && section === \'developer\'')
    expect(page).toContain('!unifiedCenter && section === \'registries\'')
  })

  it('does not add a second catalog host or dsh-cordis runtime', () => {
    expect(existsSync(join(repoRoot, 'apps/electron/src/renderer/platform/ExtensionCenter.tsx'))).toBe(false)
    expect(pkg).not.toContain('dsh-cordis')
    expect(pkg).not.toContain('dsh-')
    expect(handler).toContain('does NOT rewrite entity stores')
  })
})
