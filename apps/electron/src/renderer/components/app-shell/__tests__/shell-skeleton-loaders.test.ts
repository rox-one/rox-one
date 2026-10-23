import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')

function src(rel: string) {
  return readFileSync(join(root, rel), 'utf8')
}

describe('shell skeleton loaders', () => {
  const sites: Array<{ file: string; mustNot: RegExp; mustHave: string[] }> = [
    {
      file: 'AttachmentPreview.tsx',
      mustNot: /\bSpinner\b/,
      mustHave: ['Skeleton', 'aria-busy'],
    },
    {
      file: 'input/deck/AttachmentTray.tsx',
      mustNot: /\bSpinner\b/,
      mustHave: ['Skeleton', 'aria-busy'],
    },
    {
      file: 'SkillsListPanel.tsx',
      mustNot: /animate-spin/,
      mustHave: ['Skeleton', 'aria-busy', 'data-list-role="skills-syncing"', "t('common.loading')"],
    },
    {
      file: 'QuestProgressCard.tsx',
      mustNot: /quest-progress-card-loading[\s\S]{0,400}Loader2/,
      mustHave: ['Skeleton', 'aria-busy', 'quest-progress-card-loading', "t('quests.loading')"],
    },
    {
      file: 'DeviceStatusChip.tsx',
      mustNot: /Suspense fallback=\{<div role="status"[^>]*>\{t\('common\.loading'\)\}<\/div>\}/,
      mustHave: ['Skeleton', 'aria-busy'],
    },
    {
      file: 'AuxiliaryToolPanel.tsx',
      mustNot: /return <div role="status" className="p-4">\{t\('common\.loading'\)\}<\/div>/,
      mustHave: ['Skeleton', 'aria-busy'],
    },
    {
      file: 'MainContentPanel.tsx',
      mustNot: /pageFallback[\s\S]{0,200}<p className="text-sm">\{t\('common\.loading'\)\}<\/p>/,
      mustHave: ['Skeleton', 'aria-busy', 'route-session-loading', 'route-resource-'],
    },
  ]

  for (const site of sites) {
    it(`wires Skeleton into ${site.file}`, () => {
      const body = src(site.file)
      expect(body).toMatch(/from ['"]@rox\/ui['"]/)
      for (const needle of site.mustHave) expect(body).toContain(needle)
      expect(body).not.toMatch(site.mustNot)
    })
  }

  it('keeps Skeleton decorative (aria-hidden) in the shared primitive', () => {
    const skeleton = readFileSync(
      join(import.meta.dir, '../../../../../../../packages/ui/src/components/ui/Skeleton.tsx'),
      'utf8',
    )
    expect(skeleton).toContain('aria-hidden="true"')
  })
})
