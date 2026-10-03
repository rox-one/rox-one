import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAutoImportFile } from '../session-foreign-auto-import-storage'

const temporaryRoots: string[] = []
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-auto-import-defaults-'))
  temporaryRoots.push(root)
  mkdirSync(join(root, '.rox'))
  return { root, path: join(root, '.rox', 'foreign-auto-import.json') }
}

describe('automatic local chat import defaults', () => {
  it('enables a new installation without reading any chat sources', () => {
    expect(readAutoImportFile(fixture().root).enabled).toBe(true)
  })

  it('keeps an explicit opt-out disabled on every subsequent startup', () => {
    const { root, path } = fixture()
    writeFileSync(path, JSON.stringify({ enabled: false }))
    expect(readAutoImportFile(root).enabled === true).toBe(false)
    expect(readAutoImportFile(root).enabled === true).toBe(false)
  })

  it('fails closed for unreadable or older stored configurations', () => {
    const { root, path } = fixture()
    writeFileSync(path, '{')
    expect(readAutoImportFile(root).enabled === true).toBe(false)
    writeFileSync(path, JSON.stringify({ status: { state: 'done' } }))
    expect(readAutoImportFile(root).enabled === true).toBe(false)
  })
})
