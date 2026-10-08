import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readZTokens } = require('../lib/ui-tokens.cjs') as {
  readZTokens: (file?: string) => { layers: Map<string, number>; aliases: Map<string, string> }
}

const dir = mkdtempSync(join(tmpdir(), 'rox-z-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('readZTokens cache', () => {
  it('re-reads z.css when its mtime changes (editor sessions pick up new layers)', () => {
    const file = join(dir, 'z.css')
    writeFileSync(file, ':root { --z-base: 0; --z-modal: 50; }')
    utimesSync(file, 1_000, 1_000)
    expect([...readZTokens(file).layers.keys()]).toEqual(['base', 'modal'])
    // Same size and mtime: served from the cache.
    expect(readZTokens(file)).toBe(readZTokens(file))

    writeFileSync(file, ':root { --z-base: 0; --z-modal: 51; }') // same size
    utimesSync(file, 2_000, 2_000)
    const reread = readZTokens(file)
    expect(reread.layers.get('modal')).toBe(51)

    writeFileSync(file, ':root { --z-base: 0; --z-modal: 51; --z-toast: 60; --z-dialog: var(--z-modal); }')
    const grown = readZTokens(file)
    expect(grown.layers.get('toast')).toBe(60)
    expect(grown.aliases.get('dialog')).toBe('modal')
  })
})
