import { describe, expect, it, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EntityLinkStore, closeEntityLinkStores } from '../link-store.ts'

const roots: string[] = []
afterEach(() => {
  closeEntityLinkStores()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('EntityLinkStore location', () => {
  it('lives under <workspace>/.rox/entity-links.sqlite with a 0700 dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-entity-links-path-'))
    roots.push(root)
    const store = new EntityLinkStore({ workspaceRoot: root })
    try {
      expect(store.dbPath).toBe(join(root, '.rox', 'entity-links.sqlite'))
      const stat = statSync(join(root, '.rox'))
      expect(stat.isDirectory()).toBe(true)
      if (process.platform !== 'win32') {
        expect(stat.mode & 0o777).toBe(0o700)
      }
    } finally {
      store.close()
    }
  })
})
