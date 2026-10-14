/**
 * Boot-closure split: always-mounted shell files used a static
 * `from 'motion/react'`, which pulled motion-dom into index.html's preloaded
 * graph (the leftover `audio-transcript-actions-*.js` after #1957). The only
 * boot-reachable importer is now `lib/deferred-motion.tsx`, and it is a
 * dynamic import(). `boot-manifest.json` guards the built graph; this is the
 * source-level guard that fails in a plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

const BOOT_MOTION_FILES = [
  'components/SplashScreen.tsx',
  'components/app-menu/MobileAppMenu.tsx',
  'components/app-shell/AccountMenu.tsx',
  'components/app-shell/AppShell.tsx',
  'components/app-shell/CompactPanelTransition.tsx',
  'components/app-shell/CompactSessionMenu.tsx',
  'components/app-shell/HeaderStatusLane.tsx',
  'components/app-shell/LeftSidebar.tsx',
  'components/app-shell/PanelHeader.tsx',
  'components/app-shell/PanelStackContainer.tsx',
  'components/app-shell/SeChatPictureInPicture.tsx',
  'components/right-sidebar/SessionFilesSection.tsx',
  'components/ui/EditPopover.tsx',
  'components/ui/collapsible.tsx',
  'components/workspace/WorktreeHoverCard.tsx',
  'lib/render-profile-motion.tsx',
  'platform/LayoutDeck.tsx',
] as const

const STATIC_MOTION = /from ['"]motion\/react['"]/

describe('boot-reachable shell does not statically import motion/react', () => {
  it('each known boot importer uses deferred-motion or no motion', () => {
    const offenders: string[] = []
    for (const rel of BOOT_MOTION_FILES) {
      const src = read(rel)
      if (STATIC_MOTION.test(src) && !src.includes('import type')) {
        // type-only is erased; fail only on runtime imports
        const runtime = [...src.matchAll(/^import\s+(?!type)[\s\S]*?from ['"]motion\/react['"]/gm)]
        if (runtime.length) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the deferred host is the only boot module that loads motion, and it is dynamic', () => {
    const host = read('lib/deferred-motion.tsx')
    expect(host).toContain("from '../../../../../packages/ui/src/lib/lazy-motion'")
    expect(host).not.toMatch(/from ['"]motion\/react['"]/)
    expect(read('lib/idle-preload.ts')).toContain("import('@/lib/deferred-motion')")
    const ui = join(renderer, '../../../../packages/ui/src')
    const lazy = readFileSync(join(ui, 'lib/lazy-motion.tsx'), 'utf8')
    expect(lazy).toContain("import('motion/react')")
    expect(readFileSync(join(ui, 'components/ui/Island.tsx'), 'utf8')).toContain("from '../../lib/lazy-motion'")
    expect(readFileSync(join(ui, 'components/ui/BrowserControls.tsx'), 'utf8')).toContain("from '../../lib/lazy-motion'")
  })
})
