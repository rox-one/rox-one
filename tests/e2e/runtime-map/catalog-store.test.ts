import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCatalogFixture } from './catalog-store'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
test('browser catalog snapshot and pack mutations use actual temporary-store readers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rox-catalog-browser-')); directories.push(directory)
  const fixture = createCatalogFixture(directory)
  const initial = fixture.snapshot()
  expect(initial.workspaceId).toBe('catalog-workspace')
  expect(initial.sources).toHaveLength(5)
  expect(initial.sources.every(source => source.workspaceId === initial.workspaceId)).toBe(true)
  expect(initial.skills.map(skill => skill.slug).sort()).toEqual(['design-critique', 'requesting-code-review', 'workspace-note', 'writing-plans'])
  expect(initial.packs.map(pack => [pack.slug, pack.disabled, pack.installed.length])).toEqual([['impeccable', false, 1], ['superpowers', false, 2]])
  expect(initial.usage).toEqual({})
  expect(initial.connections).toEqual([])
  fixture.handle('/catalog/set-bundled-disabled', ['superpowers'])
  expect(fixture.snapshot().skills.map(skill => skill.slug).sort()).toEqual(['design-critique', 'workspace-note'])
  expect(fixture.snapshot().packs.find(pack => pack.slug === 'superpowers')?.disabled).toBe(true)
  fixture.handle('/catalog/set-bundled-disabled', [])
  expect(fixture.snapshot().skills).toHaveLength(4)
  expect(fixture.snapshot().sources.find(source => source.config.slug === 'notion-source')?.config.isAuthenticated).toBe(false)
  expect(() => fixture.handle('/catalog/set-bundled-disabled', ['../../outside'])).toThrow('Invalid fixture pack selection')
  expect(fixture.handle('/outside')).toBeUndefined()
})
