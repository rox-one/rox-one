import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const settingsRoot = join(import.meta.dir, '..')
const pagesRoot = join(import.meta.dir, '../../../pages/settings')

function read(rel: string, root = settingsRoot) {
  return readFileSync(join(root, rel), 'utf8')
}

describe('settings loading skeleton cluster', () => {
  it('shared SettingsLoadingSkeleton uses SE Skeleton + aria-busy', () => {
    const body = read('SettingsLoadingSkeleton.tsx')
    expect(body).toContain("from '@rox/ui'")
    expect(body).toContain('<Skeleton')
    expect(body).toContain('aria-busy="true"')
    expect(body).toContain("t('common.loading')")
    expect(body).toContain('data-testid="settings-loading-skeleton"')
    expect(body).not.toMatch(/import\s*\{[^}]*\bSpinner\b/)
    expect(body).not.toMatch(/import\s*\{[^}]*\bLoader2\b/)
    expect(body).not.toMatch(/animate-spin/)
    expect(body).not.toMatch(/<Spinner\b/)
  })

  const pages: Array<{ file: string; mustNot: RegExp }> = [
    {
      file: 'OrganizationsSettingsPage.tsx',
      mustNot: /\bif \(loading\)[\s\S]{0,200}\bSpinner\b/,
    },
    {
      file: 'WorkspaceSettingsPage.tsx',
      mustNot: /isLoadingWorkspace[\s\S]{0,300}<Spinner/,
    },
    {
      file: 'PermissionsSettingsPage.tsx',
      mustNot: /isLoading \?[\s\S]{0,200}Loader2/,
    },
    {
      file: 'LabelsSettingsPage.tsx',
      mustNot: /isLoading \?[\s\S]{0,200}Loader2/,
    },
    {
      file: 'ServerSettingsPage.tsx',
      mustNot: /isLoading \?[\s\S]{0,200}<Spinner\s*\/>/,
    },
    {
      file: 'PreferencesPage.tsx',
      mustNot: /\bif \(isLoading\)[\s\S]{0,200}\bSpinner\b/,
    },
  ]

  for (const site of pages) {
    it(`wires SettingsLoadingSkeleton into ${site.file}`, () => {
      const body = read(site.file, pagesRoot)
      expect(body).toContain('SettingsLoadingSkeleton')
      expect(body).not.toMatch(site.mustNot)
    })
  }

  it('keeps button/busy Spinner on Workspace icon upload and Server save', () => {
    const workspace = read('WorkspaceSettingsPage.tsx', pagesRoot)
    const server = read('ServerSettingsPage.tsx', pagesRoot)
    expect(workspace).toMatch(/isUploadingIcon[\s\S]{0,120}<Spinner/)
    expect(server).toMatch(/isSaving \? <Spinner/)
  })
})
