import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadEnvFile, parseEnvFile } from '../env-file'

describe('parseEnvFile', () => {
  test('ignores blank lines and # comments', () => {
    const text = [
      '# operator file',
      '',
      '   ',
      'FOO=bar',
      '  # trailing comment',
      'BAZ=qux',
    ].join('\n')
    expect(parseEnvFile(text)).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('strips one layer of matching single or double quotes', () => {
    expect(parseEnvFile(`A="double"\nB='single'`)).toEqual({ A: 'double', B: 'single' })
  })

  test('leaves mismatched or inner quotes intact', () => {
    expect(parseEnvFile(`A="mismatched'\nB="has 'inner' quotes"`)).toEqual({
      A: `"mismatched'`,
      B: `has 'inner' quotes`,
    })
  })

  test('tolerates a leading export', () => {
    expect(parseEnvFile('export FOO=bar')).toEqual({ FOO: 'bar' })
  })

  test('trims whitespace around key and value', () => {
    expect(parseEnvFile('   FOO   =   bar   ')).toEqual({ FOO: 'bar' })
  })

  test('later duplicate keys win', () => {
    expect(parseEnvFile('FOO=first\nFOO=second')).toEqual({ FOO: 'second' })
  })

  test('skips malformed lines without an =', () => {
    expect(parseEnvFile('FOO=bar\nthis line has no equals\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('keeps only the first = as the separator', () => {
    expect(parseEnvFile('URL=https://s3.rox.one/x?a=b')).toEqual({ URL: 'https://s3.rox.one/x?a=b' })
  })

  test('returns {} for empty text', () => {
    expect(parseEnvFile('')).toEqual({})
  })
})

describe('loadEnvFile', () => {
  test('returns {} for a nonexistent path', () => {
    const missing = join(tmpdir(), `rox-env-file-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    expect(loadEnvFile(missing)).toEqual({})
  })
})