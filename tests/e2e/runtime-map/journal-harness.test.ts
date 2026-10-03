import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import type { RuntimeEvent, RuntimeTraceSnapshot } from '../../../packages/core/src/runtime-trace/types'

let processHandle: ReturnType<typeof spawn>
const origin = 'http://127.0.0.1:4177'
async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(origin + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error)
  return data as T
}
const query = { workspaceId: 'fixture-workspace', sessionId: 'fixture-session' }
beforeAll(async () => {
  processHandle = spawn(process.execPath, ['run', 'tests/e2e/runtime-map/server.ts'], { env: { ...process.env, ROX_RUNTIME_MAP_E2E: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let error = ''
  processHandle.stderr!.on('data', chunk => { error += String(chunk) })
  for (let n = 0; n < 100; n++) {
    if (processHandle.exitCode !== null) throw new Error(error || 'Test server exited')
    try { await call('/health'); return } catch { await Bun.sleep(20) }
  }
  throw new Error(error || 'Test server did not become ready')
})
afterAll(async () => {
  if (!processHandle) return
  await new Promise<void>(resolve => { processHandle.once('exit', () => resolve()); processHandle.kill('SIGTERM') })
})
test('persistent real collector and shell restore without repeating actions', async () => {
  await call('/reset', {})
  await call('/start', {})
  await expect(call('/start', {})).rejects.toThrow('already exists')
  for (let index = 2; index < 16; index++) await call('/step', {})
  const snapshot = await call<RuntimeTraceSnapshot>('/snapshot', query)
  expect(snapshot.events).toHaveLength(16)
  expect(snapshot.runs[0]?.status).toBe('succeeded')
  const terminal = snapshot.events.find(event => event.kind === 'terminal.completed')
  expect(terminal?.kind).toBe('terminal.completed')
  if (terminal?.kind === 'terminal.completed') {
    expect(terminal.payload.stdout?.text).toBe('fixture')
    expect(terminal.payload.stderr?.text).toBe('fixture stderr')
    expect(terminal.payload.exitCode).toEqual({ state: 'known', value: 0, source: 'real-test-shell', origin: 'observed' })
  }
  const before = await call('/stats')
  await call('/restart', {})
  const recovered = await call<RuntimeTraceSnapshot>('/snapshot', query)
  expect(recovered.events).toEqual(snapshot.events)
  expect(await call('/stats')).toEqual(before)
  await expect(call('/snapshot', { ...query, workspaceId: 'another-workspace' })).rejects.toThrow('access denied')
})
test('large payloads use confined references and bounded reads with redaction', async () => {
  await call('/reset', {}); await call('/start', {})
  const event = await call<RuntimeEvent>('/large', {})
  if (event.kind !== 'tool.completed') throw new Error('Wrong test event')
  expect(event.payload.result?.text?.length).toBeLessThanOrEqual(4096)
  expect(event.payload.result?.text).not.toContain('fixture-secret-value')
  expect(event.payload.modelContent?.text).toBe('Тестовое сокращение большого результата.')
  const rootRunId = event.rootRunId, payloadRef = event.payload.result?.payloadRef
  expect(payloadRef).toBeTruthy()
  const page = await call<{ text: string; nextOffset?: number }>('/read-payload', { ...query, rootRunId, payloadRef, offset: 0, limit: 1024 })
  expect(page.text.length).toBeLessThanOrEqual(1024)
  expect(page.text).not.toContain('fixture-secret-value')
  expect(page.nextOffset).toBe(1024)
  await expect(call('/read-payload', { ...query, rootRunId, payloadRef: '../outside' })).rejects.toThrow()
  await expect(call('/read-payload', { ...query, workspaceId: 'another-workspace', rootRunId, payloadRef })).rejects.toThrow()
  await expect(call('/read-events', { ...query, rootRunId, afterSeq: -1 })).rejects.toThrow('Invalid runtime cursor')
})
