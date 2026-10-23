import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')

function src(name: string) {
  return readFileSync(join(root, name), 'utf8')
}

describe('knowledge-map Docs skeleton loaders', () => {
  it('wires Skeleton into KnowledgeMapDocView page load', () => {
    const body = src('KnowledgeMapDocView.tsx')
    expect(body).toContain('Skeleton')
    expect(body).toContain("from '@rox/ui'")
    expect(body).toContain('aria-busy="true"')
    expect(body).toContain('data-testid="knowledge-map-doc-loading"')
    expect(body).not.toMatch(/\bSpinner\b/)
    expect(body).not.toMatch(/animate-spin/)
  })

  it('wires Skeleton into KnowledgeMapPanel map load (keeps refresh busy spin)', () => {
    const body = src('KnowledgeMapPanel.tsx')
    expect(body).toContain('Skeleton')
    expect(body).toContain('aria-busy="true"')
    expect(body).toContain('data-testid="knowledge-map-panel-loading"')
    expect(body).not.toMatch(/\bSpinner\b/)
    // RefreshCw busy indicator is intentional — not a page/panel load placeholder.
    expect(body).toMatch(/loading \? 'animate-spin'/)
    expect(body).not.toMatch(/if \(!dto\)[\s\S]{0,200}<Spinner/)
  })
})
