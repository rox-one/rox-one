import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_PAGES } from '../../../../shared/settings-registry.ts'
import { groupSettingsPages } from '../../../../shared/settings-presentation.ts'

const ROOT = join(import.meta.dir, '../../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PAGE_FILES: Record<'developers' | 'playbooks', string> = {
  developers: 'apps/electron/src/renderer/pages/settings/DeveloperSettingsPage.tsx',
  playbooks: 'apps/electron/src/renderer/pages/settings/PlaybooksSettingsPage.tsx',
}

describe('dev space and playbooks settings pages', () => {
  test('registry exposes developers and playbooks with literal i18n keys', () => {
    const page = (id: string) => SETTINGS_PAGES.find((entry) => entry.id === id)
    expect(page('developers')).toMatchObject({
      labelKey: 'settings.developers.title',
      descriptionKey: 'settings.developers.description',
    })
    expect(page('playbooks')).toMatchObject({
      labelKey: 'settings.playbooks.title',
      descriptionKey: 'settings.playbooks.description',
    })
  })

  test('both pages are assigned to a presentation group', () => {
    const grouped = groupSettingsPages(
      SETTINGS_PAGES.map((entry) => ({ id: entry.id })),
    ).flatMap(({ pages }) => pages.map((entry) => entry.id))
    expect(grouped).toContain('developers')
    expect(grouped).toContain('playbooks')
  })

  test('component registry and menu icons cover the new pages', () => {
    const pages = source('apps/electron/src/renderer/pages/settings/settings-pages.ts')
    expect(pages).toContain("lazy(() => import('./DeveloperSettingsPage'))")
    expect(pages).toContain("lazy(() => import('./PlaybooksSettingsPage'))")
    expect(pages).toContain('developers: DeveloperSettingsPage')
    expect(pages).toContain('playbooks: PlaybooksSettingsPage')

    const menu = source('apps/electron/src/shared/menu-schema.ts')
    expect(menu).toContain("developers: 'FolderGit2'")
    expect(menu).toContain("playbooks: 'NotebookPen'")

    const icons = source('apps/electron/src/renderer/components/icons/SettingsIcons.tsx')
    expect(icons).toContain('developers: DevelopersIcon')
    expect(icons).toContain('playbooks: PlaybooksIcon')
  })

  test('pages use PanelHeader chrome and write the frozen surface atoms', () => {
    const developers = source(PAGE_FILES.developers)
    expect(developers).toContain('<PanelHeader')
    expect(developers).toContain('h-full min-h-0')
    expect(developers).toContain('mask-fade-y')
    expect(developers).toContain('devSpaceEnabledAtom')
    expect(developers).toContain('listDevSpaceRepositories')
    expect(developers).toContain("t('settings.developers.toggle')")

    const playbooks = source(PAGE_FILES.playbooks)
    expect(playbooks).toContain('<PanelHeader')
    expect(playbooks).toContain('mask-fade-y')
    expect(playbooks).toContain('playbooksEnabledAtom')
    expect(playbooks).toContain("t('settings.playbooks.toggle')")
  })

  test('pages never build i18n keys dynamically', () => {
    for (const [id, rel] of Object.entries(PAGE_FILES)) {
      const text = source(rel)
      expect(text, id).not.toMatch(/t\(`/)
      expect(text, id).not.toMatch(/t\('[^']*'\s*\+/)
    }
  })
})