import { readBoundedRegularFile } from '../packages/shared/src/utils/bounded-file.ts'
/** Run on the backend host: bun scripts/verify-service-keys.ts candidates.json private.env */
import { closeSync, constants, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { SERVER_SERVICE_KEYS, type ServerServiceKey } from '../packages/shared/src/config/server-services.ts'
import { latestNovaModel } from '../packages/shared/src/voice/adapters/deepgram-transcription'

export type ServiceKeyCandidate = { env: string; key: string }
export type ServiceKeyProbeResult = { service: string; candidate: number; status: number | null; result: string }

function networkFailureResult(error: unknown): string {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : ''
  return /proxy|connect.*403|network policy|blocked|not allowed/i.test(message)
    ? 'network-policy-blocked' : 'network-unavailable'
}

export async function verifyServiceKeys(candidates: ServiceKeyCandidate[], request: typeof fetch = fetch) {
  const selected: Record<string, string> = {}
  const results: ServiceKeyProbeResult[] = []
  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate.key !== 'string' || !candidate.key.trim() || /[\r\n]/.test(candidate.key)) {
      results.push({ service: candidate.env, candidate: index + 1, status: null, result: 'invalid-candidate-format' })
      continue
    }
    let url: string
    let init: RequestInit
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    switch (candidate.env) {
      case 'DEEPGRAM_API_KEY': {
        // No real user audio: validate transcription scope/model on a short silent WAV.
        const wav = Buffer.alloc(44 + 3_200)
        wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
        wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28)
        wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(3_200, 40)
        headers.Authorization = `Token ${candidate.key}`
        let model = 'nova-3'
        try {
          const catalog = await request('https://api.deepgram.com/v1/models', { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) })
          if (catalog.ok) model = latestNovaModel(await catalog.json())
        } catch { /* speech request below records connectivity */ }
        url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&version=latest&diarize=true&paragraphs=true`
        init = { method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: wav }
        break
      }
      case 'EXA_API_KEY': url = 'https://api.exa.ai/search'; headers['x-api-key'] = candidate.key; init = { method: 'POST', headers, body: JSON.stringify({ query: 'Deepgram transcription documentation', numResults: 1 }) }; break
      case 'BRAVE_API_KEY': url = 'https://api.search.brave.com/res/v1/web/search?q=Rox&count=1'; headers['X-Subscription-Token'] = candidate.key; init = { headers }; break
      case 'FIRECRAWL_API_KEY': url = 'https://api.firecrawl.dev/v1/team/credit-usage'; headers.Authorization = `Bearer ${candidate.key}`; init = { headers }; break
      case 'E2B_API_KEY': url = 'https://api.e2b.dev/v2/sandboxes'; headers['X-API-Key'] = candidate.key; init = { headers }; break
      case 'TAVILY_API_KEY': url = 'https://api.tavily.com/search'; headers.Authorization = `Bearer ${candidate.key}`; init = { method: 'POST', headers, body: JSON.stringify({ query: 'Deepgram documentation', max_results: 1 }) }; break
      default: results.push({ service: candidate.env, candidate: index + 1, status: null, result: 'unsupported-service' }); continue
    }
    try {
      const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(25_000) })
      // Upstream bodies may echo credentials; never print or persist them in diagnostics.
      const body = await response.json() as { success?: boolean; data?: { remainingCredits?: number }; results?: unknown; metadata?: unknown }
      const exhausted = candidate.env === 'FIRECRAWL_API_KEY' && body.data?.remainingCredits === 0
      const valid = response.ok && body.success !== false && !exhausted
      // Probe all candidates, while selecting the first working credential deterministically.
      if (valid && !selected[candidate.env]) selected[candidate.env] = candidate.key.trim()
      results.push({ service: candidate.env, candidate: index + 1, status: response.status, result: valid ? 'verified' : exhausted ? 'quota-exhausted' : 'rejected' })
    } catch (error) {
      results.push({ service: candidate.env, candidate: index + 1, status: null, result: networkFailureResult(error) })
    }
  }
  return { selected, results }
}

/** Atomically install verified values; a failed probe never replaces previous credentials. */
export function publishVerifiedServiceKeys(output: string, selected: Record<string, string>): boolean {
  if (!Object.keys(selected).length) return false
  if (Object.entries(selected).some(([name, value]) => !SERVER_SERVICE_KEYS.includes(name as ServerServiceKey) || !value.trim() || /[\r\n]/.test(value))) {
    throw new Error('Invalid verified service credential format')
  }
  let existing: string[] = []
  if (existsSync(output)) {
    let previous: string
    try { previous = readBoundedRegularFile(output, { maxBytes: 64 * 1024, privateOwner: true }).toString('utf8') }
    catch { throw new Error('Existing service secrets must be a private backend-owned regular file') }
    existing = previous.split(/\r?\n/).filter((line) => {
      const name = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=/.exec(line)?.[1]
      return line.trim() && (!name || !Object.hasOwn(selected, name))
    })
  }
  const content = [...existing, ...Object.entries(selected).map(([name, value]) => `${name}=${value.trim()}`)].join('\n') + '\n'
  const temporary = `${output}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
    writeFileSync(fd, content)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, output)
    return true
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: verify-service-keys.ts candidates.json private.env')
  const candidates = JSON.parse(readFileSync(input, 'utf8')) as ServiceKeyCandidate[]
  const { selected, results } = await verifyServiceKeys(candidates)
  publishVerifiedServiceKeys(output, selected)
  console.log(JSON.stringify({ results, selectedServices: Object.keys(selected) }, null, 2))
  if (!Object.keys(selected).length) process.exitCode = 1
}
