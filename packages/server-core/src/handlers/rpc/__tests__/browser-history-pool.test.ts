import { describe, expect, it } from 'bun:test'
import { BrowserDataAutoImporter } from '../browser-data-auto-import'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('browser-history auto-import pool', () => {
  it('skips importData (0 index writes) when the pool returns 0 new rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-hist-pool-'))
    let poolRuns = 0
    let writes = 0
    try {
      const importer = new BrowserDataAutoImporter({
        workspace: () => ({ id: 'workspace', rootPath: root }),
        preferences: () => ['history'],
        importData: () => { writes++; return { history: 1, bookmarks: 0 } },
        readViaPool: async () => { poolRuns++; return { history: 0, bookmarks: 0 } },
      })
      importer.set('workspace', true, 'chromium:selected')
      writes = 0
      await importer.runAsync('workspace')
      expect(poolRuns).toBe(1)
      expect(writes).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
