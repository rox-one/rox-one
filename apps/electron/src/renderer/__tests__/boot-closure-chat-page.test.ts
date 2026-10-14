/**
 * Boot-closure split: ChatPage was the last static page import in
 * MainContentPanel after #1675, and EditPopover (mounted in AppShell even when
 * closed) statically imported ChatDisplay. Together they kept the session
 * transcript graph (TurnCard, markdown, overlays) in index.html's preloaded
 * startup closure — paid on every launch, including when no session is open.
 *
 * App.tsx also imported the file-preview overlays eagerly; those render only
 * after a click. `boot-manifest.json` guards the route-level version of this
 * boundary on a real build; this is the source-level guard that fails in a
 * plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

describe('chat graph stays off the boot closure', () => {
  it('MainContentPanel does not statically import ChatPage', () => {
    const panel = read('components/app-shell/MainContentPanel.tsx')
    expect(panel).not.toMatch(/import\s+ChatPage\s+from/)
    expect(panel).toContain('lazyRoutePage(ROUTE_PAGE_LOADERS.chat)')
  })

  it('the route registry owns the ChatPage loader', () => {
    const registry = read('components/app-shell/route-pages.ts')
    expect(registry).toContain("chat: () => import('@/pages/ChatPage')")
  })

  it('EditPopover does not statically import ChatDisplay', () => {
    const popover = read('components/ui/EditPopover.tsx')
    expect(popover).not.toMatch(/import\s+\{\s*ChatDisplay/)
    expect(popover).toContain("import('../app-shell/ChatDisplay')")
  })

  it('App.tsx reaches file previews through one lazy host', () => {
    const app = read('App.tsx')
    expect(app).not.toMatch(/ImagePreviewOverlay|PDFPreviewOverlay|JSONPreviewOverlay|DocumentFormattedMarkdownOverlay|CodePreviewOverlay/)
    expect(app).toContain("React.lazy(() => import('./FilePreviewHost'))")
    expect(existsSync(join(renderer, 'FilePreviewHost.tsx'))).toBe(true)
  })

  it('App.tsx does not import the @rox/ui barrel', () => {
    const app = read('App.tsx')
    expect(app).not.toMatch(/from ['"]@rox\/ui['"]/)
    expect(app).toContain("from '@rox/ui/tooltip'")
    expect(app).toContain("from '@rox/ui/context'")
    expect(app).toContain("from '@rox/ui/chat/audio-transcript-actions'")
  })
})
