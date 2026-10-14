import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Only the explicit «Открыть в браузере» click may wake a stopped cloud sandbox;
// mount/poll status reads must stay passive (review4 #1).
describe('CloudHandoffButton status calls', () => {
  const src = readFileSync(join(import.meta.dir, '..', 'CloudHandoffButton.tsx'), 'utf8')
  const calls = [...src.matchAll(/getCloudHandoffStatus\??\.?\(([^)]*)\)/g)].map((m) => m[1]!)
  it('passes open: true only from openSession', () => {
    const opening = calls.filter((c) => c.includes('open: true'))
    expect(opening).toHaveLength(1)
    const openFn = src.slice(src.indexOf('const openSession'), src.indexOf('const openSession') + 400)
    expect(openFn).toContain('open: true')
    expect(calls.length).toBeGreaterThan(1)
  })
})
