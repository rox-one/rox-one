import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { publishVerifiedServiceKeys, verifyServiceKeys } from '../verify-service-keys.ts'

describe('service credential validation and private provisioning', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rox-verify-keys-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
  it('probes every supplied candidate, selects the first success and emits no credentials in diagnostics', async () => {
    const seen: string[] = []
    const request = (async (_url: unknown, options?: RequestInit) => {
      const key = new Headers(options?.headers).get('x-api-key')!
      seen.push(key)
      return key === 'rejected-fixture' ? Response.json({ error: key }, { status: 401 }) : Response.json({ results: [] })
    }) as typeof fetch
    const outcome = await verifyServiceKeys([
      { env: 'EXA_API_KEY', key: 'rejected-fixture' }, { env: 'EXA_API_KEY', key: 'first-valid-fixture' }, { env: 'EXA_API_KEY', key: 'second-valid-fixture' },
    ], request)
    expect(seen).toEqual(['rejected-fixture', 'first-valid-fixture', 'second-valid-fixture'])
    expect(outcome.selected).toEqual({ EXA_API_KEY: 'first-valid-fixture' })
    expect(outcome.results.map((result) => result.result)).toEqual(['rejected', 'verified', 'verified'])
    expect(JSON.stringify(outcome.results)).not.toContain('fixture')
  })
  it('distinguishes network policy blocking from rejected credentials and does not replace previous keys', async () => {
    const path = join(dir, 'private.env')
    writeFileSync(path, 'EXA_API_KEY=previous-fixture\n', { mode: 0o600 })
    const outcome = await verifyServiceKeys([{ env: 'EXA_API_KEY', key: 'candidate-fixture' }], (async () => {
      throw new Error('Proxy CONNECT 403: blocked by network policy, sensitive=candidate-fixture')
    }) as unknown as typeof fetch)
    expect(outcome.results).toEqual([{ service: 'EXA_API_KEY', candidate: 1, status: null, result: 'network-policy-blocked' }])
    expect(publishVerifiedServiceKeys(path, outcome.selected)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('EXA_API_KEY=previous-fixture\n')
  })
  it('skips quota-exhausted Firecrawl candidates and continues to the next key', async () => {
    let calls = 0
    const outcome = await verifyServiceKeys([
      { env: 'FIRECRAWL_API_KEY', key: 'first-fixture' }, { env: 'FIRECRAWL_API_KEY', key: 'second-fixture' },
    ], (async () => Response.json({ success: true, data: { remainingCredits: calls++ === 0 ? 0 : 10 } })) as unknown as typeof fetch)
    expect(outcome.results.map((result) => result.result)).toEqual(['quota-exhausted', 'verified'])
    expect(outcome.selected).toEqual({ FIRECRAWL_API_KEY: 'second-fixture' })
  })
  it('validates the latest prerecorded transcription and diarization contract with synthetic audio', async () => {
    const requests: { url: URL; options?: RequestInit }[] = []
    const outcome = await verifyServiceKeys([{ env: 'DEEPGRAM_API_KEY', key: 'deepgram-fixture' }], (async (input: unknown, options?: RequestInit) => {
      const url = new URL(String(input)); requests.push({ url, options })
      return url.pathname === '/v1/models' ? Response.json({ models: [] }) : Response.json({ metadata: {}, results: {} })
    }) as typeof fetch)
    expect(outcome.results[0]?.result).toBe('verified')
    const speech = requests.find(({ url }) => url.pathname === '/v1/listen')!
    expect(speech.url.searchParams.get('model')).toBe('nova-3')
    expect(speech.url.searchParams.get('version')).toBe('latest')
    expect(speech.url.searchParams.get('diarize_model')).toBe('latest')
    expect(speech.url.searchParams.has('diarize')).toBe(false)
    expect(speech.url.searchParams.get('paragraphs')).toBe('true')
    expect(speech.options?.method).toBe('POST')
    expect(new Headers(speech.options?.headers).get('Content-Type')).toBe('audio/wav')
    expect(Buffer.from(speech.options?.body as Buffer).subarray(0, 4).toString()).toBe('RIFF')
    expect(JSON.stringify(outcome.results)).not.toContain('deepgram-fixture')
  })
  it('publishes multiple keys with actual LF, mode 0600 and preserves unselected deployment keys', () => {
    const path = join(dir, 'private.env')
    writeFileSync(path, 'DEEPGRAM_API_KEY=existing-fixture\nEXA_API_KEY=old-fixture\n', { mode: 0o600 })
    expect(publishVerifiedServiceKeys(path, { EXA_API_KEY: 'new-fixture', BRAVE_API_KEY: 'brave-fixture' })).toBe(true)
    expect(readFileSync(path, 'utf8').split('\n')).toEqual(['DEEPGRAM_API_KEY=existing-fixture', 'EXA_API_KEY=new-fixture', 'BRAVE_API_KEY=brave-fixture', ''])
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  })
  it('rejects key injection, public existing files and symlinks without modifying their target', () => {
    const path = join(dir, 'private.env')
    expect(() => publishVerifiedServiceKeys(path, { EXA_API_KEY: 'fixture\nBRAVE_API_KEY=other' })).toThrow('format')
    writeFileSync(path, 'EXA_API_KEY=existing-fixture\n', { mode: 0o644 })
    if (process.platform !== 'win32') {
      chmodSync(path, 0o644)
      expect(() => publishVerifiedServiceKeys(path, { EXA_API_KEY: 'new-fixture' })).toThrow('private backend-owned')
      rmSync(path)
      writeFileSync(join(dir, 'target.env'), 'EXA_API_KEY=target-fixture\n', { mode: 0o600 })
      symlinkSync(join(dir, 'target.env'), path)
      expect(() => publishVerifiedServiceKeys(path, { EXA_API_KEY: 'new-fixture' })).toThrow('private backend-owned')
      expect(readFileSync(join(dir, 'target.env'), 'utf8')).toBe('EXA_API_KEY=target-fixture\n')
    }
  })
})
