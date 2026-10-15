/**
 * Boot-closure split: `TopBar` statically imported `NotificationCenter`, so the
 * bell, its popover, the row markup, `notification-sources.ts` and the
 * notification store all preloaded with index.html — see
 * `docs/perf/boot-closure-wave-2026-10-15.md`, "Arrived in the closure since the
 * last manifest".
 *
 * The sources subscription has to stay eager: it collects notifications while
 * the panel is closed. The split is therefore at the PANEL UI, not at the
 * subscription — `NotificationCenter` keeps `useNotificationSources` +
 * `useNotificationList` (the badge reads the store) and reaches the popover
 * body through `React.lazy`, mounted only while `open`. A closed Radix Popover
 * renders nothing, so the panel module does not belong in the preloaded graph.
 * Same gate as #2037's closed dialogs.
 *
 * `boot-manifest.json` guards the built graph; this is the source-level guard
 * that fails in a plain `bun test` run.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '..')

function read(rel: string): string {
  return readFileSync(join(renderer, rel), 'utf8')
}

function staticImportLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
    .join('\n')
}

describe('the notification panel stays out of the boot closure', () => {
  it('TopBar keeps the bell eager and never reaches the panel', () => {
    const topBar = read('components/app-shell/TopBar.tsx')
    expect(staticImportLines(topBar)).toMatch(/from\s+['"]\.\.\/shell\/NotificationCenter['"]/)
    expect(staticImportLines(topBar)).not.toMatch(/NotificationPanel/)
  })

  it('NotificationCenter lazy-loads the panel and mounts it only while open', () => {
    const src = read('components/shell/NotificationCenter.tsx')
    const staticImports = staticImportLines(src)
    // A static import (of either the panel or its loader's target) puts the
    // panel back in index.html's closure — the whole point of the split.
    expect(staticImports).not.toMatch(/from\s+['"][^'"]*NotificationPanel['"]/)
    expect(src).toContain('React.lazy(')
    expect(src).toContain('loadNotificationPanel()')
    expect(src).toContain('React.Suspense')
    expect(src).toContain('fallback={null}')
    // Closed on the first frame: the lazy element is behind `open &&`.
    expect(src).toMatch(/open\s*&&\s*\(/)
  })

  it('the panel loader is a leaf: one dynamic import, nothing else', () => {
    const src = read('components/shell/notification-panel-loader.ts')
    expect(src).toContain("import('./NotificationPanel')")
    const staticImports = staticImportLines(src)
    expect(staticImports).not.toMatch(/NotificationPanel|popover|lucide-react|i18next|react-dom/)
  })

  it('the panel module owns the popover body; the bell module does not', () => {
    const panel = read('components/shell/NotificationPanel.tsx')
    expect(panel).toContain('PopoverContent')
    expect(panel).toContain('data-testid="notification-center"')
    const center = read('components/shell/NotificationCenter.tsx')
    expect(center).not.toContain('PopoverContent')
    // The bell itself stays: icon + unread badge, no list markup.
    expect(center).toContain('data-notification-bell')
    expect(center).not.toContain('data-notification-id')
  })

  it('the sources subscription and the store stay eager', () => {
    const src = read('components/shell/NotificationCenter.tsx')
    const staticImports = staticImportLines(src)
    expect(staticImports).toMatch(/from\s+['"]\.\/notification-sources['"]/)
    expect(staticImports).toMatch(/from\s+['"]\.\/notifications['"]/)
    expect(src).toContain('useNotificationSources(workspaceId)')
    expect(src).toContain('useNotificationList(workspaceId)')
    // The subscription must run outside the lazy boundary, i.e. not inside the
    // module the panel loader pulls in.
    const panel = read('components/shell/NotificationPanel.tsx')
    expect(staticImportLines(panel)).not.toMatch(/from\s+['"]\.\/notification-sources['"]/)
  })
})
