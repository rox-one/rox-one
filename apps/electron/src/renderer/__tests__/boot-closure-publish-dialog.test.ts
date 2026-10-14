/**
 * Boot-closure split: AppShell statically imported `PublishSessionDialogHost`,
 * which pulled `PublishSessionDialog` → `@/components/markdown` → `rehype-raw`
 * → parse5 + hast-util (~361 KB of sources over 18 modules) plus react-markdown
 * and remark-gfm/math into index.html's preloaded startup closure. The dialog is
 * reachable only from SessionMenu / CompactSessionMenu / SessionPublishedChip via
 * `publishSessionDialogAtom`.
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

describe('publish dialog stays out of the boot closure', () => {
  it('AppShell keeps the host (765 B) but the dialog itself is a dynamic import', () => {
    const appShell = read('components/app-shell/AppShell.tsx')
    expect(appShell).toContain('import { PublishSessionDialogHost } from "@/components/knowledge/PublishSessionDialogHost"')

    const host = read('components/knowledge/PublishSessionDialogHost.tsx')
    expect(host).not.toMatch(/^import\s+\{\s*PublishSessionDialog\s*\}\s+from/m)
    expect(host).toContain("import('./PublishSessionDialog')")
    expect(host).toMatch(/if \(!state\.open\) return null/)
    expect(host).toContain('<React.Suspense fallback={null}>')
  })

  it('the heavy markdown pipeline is not reachable statically from the host', () => {
    const host = read('components/knowledge/PublishSessionDialogHost.tsx')
    // Match import statements only: the module doc comment names the pipeline
    // it is deliberately keeping out, and must not count as a static edge.
    const staticImports = host
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line) || /^\s*\}?\s*from\s+['"]/.test(line))
      .join('\n')
    expect(staticImports).not.toMatch(/from\s+['"][^'"]*components\/markdown['"]/)
    expect(staticImports).not.toMatch(/['"](?:rehype-raw|react-markdown|remark-gfm|remark-math)['"]/)
    expect(staticImports).not.toMatch(/from\s+['"][^'"]*lazy-motion['"]/)
  })

  it('the dialog owns the markdown dependency it defers', () => {
    // Documents the reason the split exists — if this import ever moves out,
    // the lazy edge is no longer buying anything and the test should change.
    const dialog = read('components/knowledge/PublishSessionDialog.tsx')
    expect(dialog).toContain("from '@/components/markdown'")
  })
})
