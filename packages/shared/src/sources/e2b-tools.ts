/** Backend-only E2B execution. The API key never enters code, tool results or IPC. */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { createApiTool, type ApiCredentialSource, type SummarizeCallback } from './api-tools.ts'
import type { ApiConfig } from './types.ts'
import { guardLargeResult } from '../utils/large-response.ts'

const API_ORIGIN = 'https://api.e2b.dev'
const MAX_OUTPUT_BYTES = 1024 * 1024

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_OUTPUT_BYTES) throw new Error('E2B output exceeds the 1 MiB limit')
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export interface E2bExecutionInput {
  code: string
  language?: 'python' | 'javascript' | 'typescript' | 'r' | 'java' | 'bash'
  timeoutSeconds?: number
}

export async function executeE2bCode(credential: ApiCredentialSource, input: E2bExecutionInput) {
  const value = typeof credential === 'function' ? await credential() : credential
  if (typeof value !== 'string' || !value.trim()) throw new Error('E2B is not configured on this backend')
  if (!input.code.trim() || Buffer.byteLength(input.code) > 128 * 1024) throw new Error('Provide code within the 128 KiB limit')
  const timeout = input.timeoutSeconds ?? 60
  if (!Number.isInteger(timeout) || timeout < 5 || timeout > 120) throw new Error('E2B timeout must be 5–120 seconds')
  const headers = { 'X-API-Key': value, 'Content-Type': 'application/json' }
  const created = await fetch(`${API_ORIGIN}/v2/sandboxes`, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ templateID: 'code-interpreter-v1', timeout: timeout + 30, autoPause: false, metadata: { app: 'rox' } }),
  })
  if (!created.ok) throw new Error(`E2B sandbox creation failed (${created.status})`)
  const sandbox = JSON.parse(await readBoundedText(created)) as {
    sandboxID?: string; domain?: string; envdAccessToken?: string; trafficAccessToken?: string
  }
  const id = sandbox.sandboxID
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('E2B returned an invalid sandbox identity')
  try {
    // A provider-returned domain is never allowed to redirect the sandbox token elsewhere.
    const domain = sandbox.domain ?? 'e2b.app'
    if (domain !== 'e2b.app' && domain !== 'e2b.dev') throw new Error('E2B returned an unsupported sandbox domain')
    const executionHeaders: Record<string, string> = {
      'Content-Type': 'application/json', 'E2b-Sandbox-Id': id, 'E2b-Sandbox-Port': '49999',
    }
    if (sandbox.envdAccessToken) executionHeaders['X-Access-Token'] = sandbox.envdAccessToken
    if (sandbox.trafficAccessToken) executionHeaders['E2B-Traffic-Access-Token'] = sandbox.trafficAccessToken
    const executed = await fetch(`https://49999-${id}.${domain}/execute`, {
      method: 'POST', headers: executionHeaders, redirect: 'error', signal: AbortSignal.timeout(timeout * 1000),
      body: JSON.stringify({ code: input.code, language: input.language ?? 'python' }),
    })
    if (!executed.ok) throw new Error(`E2B execution failed (${executed.status})`)
    const result = { stdout: [] as string[], stderr: [] as string[], results: [] as unknown[], error: null as unknown }
    for (const line of (await readBoundedText(executed)).split(/\r?\n/)) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as Record<string, unknown>
      if (event.type === 'stdout' && typeof event.text === 'string') result.stdout.push(event.text)
      else if (event.type === 'stderr' && typeof event.text === 'string') result.stderr.push(event.text)
      else if (event.type === 'result') {
        const { type: _type, ...content } = event
        result.results.push(content)
      } else if (event.type === 'error') {
        result.error = { name: event.name, value: event.value, traceback: event.traceback }
      }
    }
    return result
  } finally {
    // The remote TTL is a second cleanup path if deletion cannot reach the provider.
    await fetch(`${API_ORIGIN}/sandboxes/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
    }).catch(() => {})
  }
}

export function createE2bApiServer(config: ApiConfig, credential: ApiCredentialSource, sessionPath?: string, summarize?: SummarizeCallback) {
  return createSdkMcpServer({
    name: 'api_e2b', version: '1.0.0', tools: [createApiTool(config, credential, sessionPath, summarize), tool(
      'execute_code',
      'Execute code in an isolated E2B sandbox. The host supplies authentication, returns output and cleans up the sandbox. Read sources/e2b/guide.md before use.',
      {
        code: z.string().min(1).max(128 * 1024),
        language: z.enum(['python', 'javascript', 'typescript', 'r', 'java', 'bash']).optional(),
        timeoutSeconds: z.number().int().min(5).max(120).optional(),
        _intent: z.string().optional(),
      },
      async (input) => {
        try {
          const result = await executeE2bCode(credential, input)
          const serialized = JSON.stringify(result)
          const guarded = sessionPath ? await guardLargeResult(Buffer.from(serialized), {
            sessionPath, toolName: 'execute_code', input, intent: input._intent, summarize,
          }) : null
          return { content: [{ type: 'text' as const, text: guarded ?? serialized }], ...(result.error ? { isError: true } : {}) }
        } catch (error) {
          // Transport errors may include headers; only our bounded diagnostic enters a tool result.
          const message = error instanceof Error && error.message.startsWith('E2B ')
            ? error.message : 'E2B request failed; check backend connectivity and configuration'
          return { content: [{ type: 'text' as const, text: message }], isError: true }
        }
      },
    )],
  })
}
