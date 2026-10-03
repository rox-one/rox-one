import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const stub = readFileSync(join(import.meta.dir, '..', 'node-stub.ts'), 'utf8')

describe('renderer node builtin stub', () => {
  it('exports the fs copy helpers the playground graph can import', () => {
    expect(stub).toContain('export const copyFileSync')
    expect(stub).toContain('export const cpSync')
    expect(stub).toContain('export const cp =')
    expect(stub).toContain('export class X509Certificate')
  })
  it('rejects host-only skill link operations', async () => {
    const { readlinkSync, symlinkSync } = await import('../node-stub.ts')
    expect(() => readlinkSync('/skills/review')).toThrow('requires the host API')
    expect(() => symlinkSync('/skills/review', '/external/review')).toThrow('requires the host API')
  })
})
