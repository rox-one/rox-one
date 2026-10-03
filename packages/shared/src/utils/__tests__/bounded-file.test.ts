import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBoundedRegularFile } from '../bounded-file.ts'

const directory = fs.mkdtempSync(join(tmpdir(), 'rox-bounded-file-'))
const cleanup: Array<() => void> = []
afterEach(() => { for (const restore of cleanup.splice(0)) restore() })

function fixture(name: string, content = 'original') {
  const path = join(directory, name)
  fs.writeFileSync(path, content, { mode: 0o600 })
  return path
}

describe('bounded opened-descriptor file reads', () => {
  test('reads a private regular file, enforces the byte limit and accepts empty files', () => {
    const path = fixture('regular')
    expect(readBoundedRegularFile(path, { maxBytes: 8, privateOwner: true }).toString()).toBe('original')
    expect(() => readBoundedRegularFile(path, { maxBytes: 7 })).toThrow('unsafe')
    expect(readBoundedRegularFile(fixture('empty', ''), { maxBytes: 0 }).length).toBe(0)
  })
  test('rejects a linked file without returning its target bytes, and rejects public credentials', () => {
    const target = fixture('private-target', 'sensitive-fixture')
    const link = join(directory, 'linked'); fs.symlinkSync(target, link)
    expect(() => readBoundedRegularFile(link, { maxBytes: 100 })).toThrow('unsafe')
    if (process.platform !== 'win32') {
      fs.chmodSync(target, 0o644)
      expect(() => readBoundedRegularFile(target, { maxBytes: 100, privateOwner: true })).toThrow('unsafe')
    }
  })
  test('rejects replacement after the pathname check before opening the descriptor', () => {
    const path = fixture('replaced')
    const realOpen = fs.openSync
    const mock = spyOn(fs, 'openSync').mockImplementation((name, flags, mode) => {
      if (name === path) { fs.renameSync(path, path + '.old'); fs.writeFileSync(path, 'replacement', { mode: 0o600 }) }
      return realOpen(name, flags, mode)
    })
    cleanup.push(() => mock.mockRestore())
    expect(() => readBoundedRegularFile(path, { maxBytes: 100 })).toThrow('changed')
    expect(fs.readFileSync(path + '.old', 'utf8')).toBe('original')
  })
  test('rejects growth while reading and closes the original descriptor', () => {
    const path = fixture('grows')
    const realRead = fs.readSync
    let mutated = false
    const mock = spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      if (!mutated) { mutated = true; fs.appendFileSync(path, 'more') }
      return realRead(...args)
    }) as typeof fs.readSync)
    cleanup.push(() => mock.mockRestore())
    expect(() => readBoundedRegularFile(path, { maxBytes: 100 })).toThrow('changed')
  })
})
process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }))
