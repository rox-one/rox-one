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
    expect(page).toContain('extensions.installed.countWithDisabled')
    expect(page).toContain('extensions.developer.hint')
    expect(page).toContain('extensions.registries.hint')
    expect(page).toContain('role="switch"')
    expect(page).toContain('craft:open-vps-browser')
  })

  it('does not add a second catalog host or dsh-cordis runtime', () => {
    expect(existsSync(join(repoRoot, 'apps/electron/src/renderer/platform/ExtensionCenter.tsx'))).toBe(false)
    expect(pkg).not.toContain('dsh-cordis')
    expect(pkg).not.toContain('dsh-')
    expect(handler).toContain('does NOT rewrite entity stores')
  })

  it('ships P35-06 i18n for developer/registries hints and grouped permissions', () => {
    const en = JSON.parse(
      readFileSync(join(repoRoot, 'packages/shared/src/i18n/locales/en.json'), 'utf8'),
    ) as Record<string, string>
    expect(en['extensions.developer.hint']).toMatch(/Inspect sandboxed extension hosts/i)
    expect(en['extensions.registries.hint']).toMatch(/catalog of installable extensions/i)
    expect(en['extensions.installed.countWithDisabled']).toContain('{{disabled}}')
    expect(en['extensions.registries.provider.craft-curated']).toBe('Rox Kiro')
    expect(en['extensions.permissionGroup.knowledge']).toBe('Knowledge')
    expect(en['extensions.status.enabled']).toBe('enabled')
    expect(en['extensions.status.disabled']).toBe('disabled')
    const blob = [
      en['extensions.developer.hint'],
      en['extensions.registries.hint'],
      en['extensions.registries.provider.craft-curated'],
    ].join('\n')
    expect(blob).not.toMatch(/oh-my-pi|OMP|Craft Agents/i)
  })
})
