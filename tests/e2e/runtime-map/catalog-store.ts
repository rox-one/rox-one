/**
 * Test-only catalog store. Every snapshot is loaded from an owned temporary
 * workspace using production storage readers. No provider, worker, credential
 * manager, account, source test endpoint, or network request is started here.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureBundledSkills, listBundledSkillPacks } from '../../../packages/shared/src/skills/bundled'
import { getDisabledBundledSkillSlugsFromDisk, loadWorkspaceSkills } from '../../../packages/shared/src/skills/storage'
import { loadWorkspaceSources, saveSourceConfig } from '../../../packages/shared/src/sources/storage'
import { validateSourceConfig } from '../../../packages/shared/src/config/validators'
import type { FolderSourceConfig } from '../../../packages/shared/src/sources/types'

export function createCatalogFixture(directory: string) {
  const workspaceId = 'catalog-workspace'
  const workspaceRootPath = join(directory, workspaceId)
  const bundleRoot = join(directory, 'catalog-bundle')
  const targetRoot = join(workspaceRootPath, 'skills')
  const disabledPath = join(directory, 'catalog-bundled-disabled.json')
  mkdirSync(workspaceRootPath, { recursive: true })
  mkdirSync(join(workspaceRootPath, 'documents'), { recursive: true })
  const writeSkill = (pack: string | undefined, slug: string, name: string, description: string, requiredSources?: string[]) => {
    const folder = pack ? join(bundleRoot, pack, slug) : join(targetRoot, slug)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${requiredSources ? `requiredSources: [${requiredSources.join(', ')}]\n` : ''}---\nFixture instructions loaded from this temporary SKILL.md.\n`)
  }
  writeSkill('superpowers', 'requesting-code-review', 'Fixture code review', 'Review code and verify implementation evidence.')
  writeSkill('superpowers', 'writing-plans', 'Fixture planning', 'Write a plan before a complex change.')
  writeSkill('impeccable', 'design-critique', 'Fixture design review', 'Review visual hierarchy and keyboard access.')
  writeSkill(undefined, 'workspace-note', 'Fixture workspace note', 'Custom workspace instructions with an explicit source dependency.', ['custom-source'])
  // No invented pinned commit or upstream origin is supplied. listBundledSkillPacks
  // reports those as null while actual installed files/counts are read back.
  const base = { enabled: true, createdAt: Date.now() }
  const configs: FolderSourceConfig[] = [
    { ...base, id: 'custom-source', slug: 'custom-source', name: 'Fixture custom warehouse', type: 'api', provider: 'custom-warehouse', tagline: 'Unknown provider is retained under Other.', api: { baseUrl: 'https://fixture.invalid/api', authType: 'none' }, connectionStatus: 'untested' },
    { ...base, id: 'github-source', slug: 'github-source', name: 'Fixture GitHub', type: 'api', provider: 'github', tagline: 'Stored failed test; no external request in this fixture.', api: { baseUrl: 'https://fixture.invalid/github', authType: 'none' }, connectionStatus: 'failed', connectionError: 'Recorded fixture failure' },
    { ...base, id: 'notion-source', slug: 'notion-source', name: 'Fixture Notion', type: 'mcp', provider: 'notion', tagline: 'Revoked authorization overrides an old Connected record.', mcp: { url: 'https://fixture.invalid/notion', authType: 'oauth' }, isAuthenticated: false, connectionStatus: 'connected' },
    { ...base, id: 'local-stdio', slug: 'local-stdio', name: 'Fixture local tool', type: 'mcp', provider: 'custom-local', tagline: 'Local MCP is disabled; command is never executed.', mcp: { transport: 'stdio', command: 'fixture-disabled-command', authType: 'none' } },
    { ...base, id: 'folder', slug: 'folder', name: 'Fixture documents folder', type: 'local', provider: 'filesystem', tagline: 'Temporary local folder; requires no remote authentication.', local: { path: join(workspaceRootPath, 'documents') } },
  ]
  for (const config of configs) {
    if (config.type === 'api' && config.api?.authType === 'none') {
      // saveSourceConfig(auth:none) performs ambient orphan-credential cleanup.
      // Seed its validated on-disk fixture form without touching any credential
      // authority. All browser reads still use the real production source loader.
      const validation = validateSourceConfig(config)
      if (!validation.valid) throw new Error(`Invalid catalog source fixture: ${JSON.stringify(validation.errors)}`)
      const folder = join(workspaceRootPath, 'sources', config.slug)
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'config.json'), JSON.stringify(config, null, 2))
    } else saveSourceConfig(workspaceRootPath, config)
  }
  const disabled = (): string[] => JSON.parse(readFileSync(disabledPath, 'utf8')) as string[]
  const options = () => ({ bundleRoot, targetRoot, linksRoot: null, disabled: disabled() })
  const setDisabled = (next: unknown) => {
    if (!Array.isArray(next) || next.some(slug => typeof slug !== 'string' || !['superpowers', 'impeccable'].includes(slug))) throw new Error('Invalid fixture pack selection')
    writeFileSync(disabledPath, JSON.stringify([...new Set(next)]))
    ensureBundledSkills(options())
  }
  const reset = () => { setDisabled([]) }
  reset()
  const getSkills = () => {
    const hidden = getDisabledBundledSkillSlugsFromDisk(targetRoot, disabled())
    return loadWorkspaceSkills(workspaceRootPath).filter(skill => !hidden.has(skill.slug))
  }
  const snapshot = () => ({
    workspaceId, workspaceRootPath, sources: loadWorkspaceSources(workspaceRootPath), skills: getSkills(),
    packs: listBundledSkillPacks(options()), usage: {}, connections: [],
  })
  const handle = (path: string, body?: unknown): unknown | undefined => {
    if (path === '/catalog/snapshot') return snapshot()
    if (path === '/catalog/skills') return getSkills()
    if (path === '/catalog/sources') return loadWorkspaceSources(workspaceRootPath)
    if (path === '/catalog/packs') return listBundledSkillPacks(options())
    if (path === '/catalog/usage') return {}
    if (path === '/catalog/models') return []
    if (path === '/catalog/set-bundled-disabled') { setDisabled(body); return { saved: true } }
    if (path === '/catalog/reset') { reset(); return { reset: true } }
    return undefined
  }
  return { snapshot, handle, reset }
}
