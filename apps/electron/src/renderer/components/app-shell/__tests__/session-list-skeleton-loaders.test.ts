import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')

function src(name: string) {
  return readFileSync(join(root, name), 'utf8')
}

describe('session list skeleton loaders (P3.1)', () => {
  it('SessionListSkeleton uses SE Skeleton + aria-busy row placeholders', () => {
    const body = src('SessionListSkeleton.tsx')
    expect(body).toContain("from '@rox/ui'")
    expect(body).toContain('<Skeleton')
    expect(body).toContain('aria-busy="true"')
    expect(body).toContain('data-testid="session-list-loading"')
    expect(body).not.toMatch(/import\s*\{[^}]*\bSpinner\b/)
    expect(body).not.toMatch(/<Spinner\b/)
    expect(body).not.toMatch(/animate-spin/)
  })

  it('SessionList shows skeleton for !sessionsReady and content-search load', () => {
    const body = src('SessionList.tsx')
    expect(body).toContain('SessionListSkeleton')
    expect(body).toContain('sessionsReady')
    expect(body).toContain('if (!sessionsReady)')
    expect(body).toContain('isSearchingContent && flatRows.length === 0')
    expect(body).not.toMatch(/\bSpinner\b/)
  })

  it('SessionSearchHeader replaces search-load Spinner with Skeleton', () => {
    const body = src('SessionSearchHeader.tsx')
    expect(body).toContain('Skeleton')
    expect(body).not.toMatch(/\bSpinner\b/)
  })

  it('keeps live isProcessing Spinners on SessionItem and SessionLanes', () => {
    const item = src('SessionItem.tsx')
    const lanes = src('SessionLanes.tsx')
    expect(item).toMatch(/isProcessing && <Spinner/)
    expect(lanes).toMatch(/isProcessing[\s\S]{0,200}<Spinner/)
  })

  it('AppShell passes sessionsReady into SessionList', () => {
    const body = src('AppShell.tsx')
    expect(body).toContain('sessionsReady={!!isSessionsReady}')
  })
})
