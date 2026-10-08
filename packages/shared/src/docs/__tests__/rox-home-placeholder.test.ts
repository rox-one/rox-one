/**
 * W1-13 (#1510): bundled docs carry a `{{ROX_HOME}}` placeholder that is
 * rendered when the docs are written to {configDir}/docs. With
 * `storage.visible-root.v1` OFF the rendered text is the legacy `~/.rox`
 * (exactly as before); with it ON it is the resolved config dir.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROX_HOME_DOC_PLACEHOLDER, renderBundledDoc, roxHomeDocDisplay } from '../index.ts'

const docsDir = join(import.meta.dir, '..', '..', '..', '..', '..', 'apps', 'electron', 'resources', 'docs')
const home = '/home/tester'

describe('roxHomeDocDisplay', () => {
  it('flag OFF → legacy text regardless of the resolved dir', () => {
    expect(roxHomeDocDisplay(`${home}/.rox`, { homeDir: home, visibleRootActive: false })).toBe('~/.rox')
    expect(roxHomeDocDisplay(`${home}/rox`, { homeDir: home, visibleRootActive: false })).toBe('~/.rox')
    expect(roxHomeDocDisplay('/custom/profile', { homeDir: home, visibleRootActive: false })).toBe('~/.rox')
  })

  it('flag ON → the actual config dir, ~-abbreviated', () => {
    expect(roxHomeDocDisplay(`${home}/rox`, { homeDir: home, visibleRootActive: true })).toBe('~/rox')
    // Deferred migration keeps the legacy dir — and the docs say so.
    expect(roxHomeDocDisplay(`${home}/.rox`, { homeDir: home, visibleRootActive: true })).toBe('~/.rox')
    expect(roxHomeDocDisplay('/elsewhere/rox', { homeDir: home, visibleRootActive: true })).toBe('/elsewhere/rox')
  })
})

describe('bundled docs placeholder', () => {
  const docs = readdirSync(docsDir).filter((name) => name.endsWith('.md'))

  it('no bundled doc hard-codes a Rox home path', () => {
    for (const name of docs) {
      const content = readFileSync(join(docsDir, name), 'utf8')
      expect({ name, hit: /~\/\.?rox\//.test(content) }).toEqual({ name, hit: false })
    }
  })

  it('flag OFF renders ~/.rox paths (unchanged from before W1-13)', () => {
    const skills = readFileSync(join(docsDir, 'skills.md'), 'utf8')
    expect(skills).toContain(ROX_HOME_DOC_PLACEHOLDER)
    const rendered = renderBundledDoc(skills, '~/.rox')
    expect(rendered).toContain('mkdir -p ~/.rox/workspaces/{ws}/skills/my-skill')
    expect(rendered).not.toContain(ROX_HOME_DOC_PLACEHOLDER)
    expect(rendered).not.toContain('~/rox/')
    for (const name of ['themes.md', 'permissions.md', 'sources.md']) {
      const out = renderBundledDoc(readFileSync(join(docsDir, name), 'utf8'), '~/.rox')
      expect(out).toContain('~/.rox/')
      expect(out).not.toContain('~/rox/')
    }
  })

  it('flag ON renders the visible home', () => {
    const rendered = renderBundledDoc(readFileSync(join(docsDir, 'themes.md'), 'utf8'), '~/rox')
    expect(rendered).toContain('~/rox/theme.json')
    expect(rendered).not.toContain('~/.rox')
  })
})
