import { expect, test, setDefaultTimeout } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fixture } from './wp-48-domain.test'
import { createLicenseAuditIntent } from '../../apps/electron/src/shared/license-evidence'

setDefaultTimeout(120000)
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object'); return Object.fromEntries(Object.entries(value)) }
function required<T>(value: T | undefined): T { if (value === undefined) throw new Error('Missing fixture'); return value }

test('actual encrypted license intent survives SIGKILL, offline new process and canonical service restart without another queue', async () => {
  const f = await fixture()
  try {
  const profile = join(f.root, 'native-profile'), emptyPath = join(f.root, 'empty-bin')
  mkdirSync(profile, { mode: 0o700 }); mkdirSync(emptyPath, { mode: 0o700 })
  const localId = randomUUID()
  const command = createLicenseAuditIntent(localId, await f.get())
  // A fresh real login is issued by the composed canonical authority; no token or Actor is synthesized here.
  const loginInput = { serviceUrl: `http://127.0.0.1:${f.current().server.port}`, workspaceId: f.workspaceId,
    workspaceName: 'Synthetic WP48 workspace', login: f.owner.login, password: f.password }
  function spawn(mode: string, extra: Record<string, unknown> = {}) {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'wp-48-native-child.ts')], {
      env: { ...process.env, PATH: emptyPath, ROX_CONFIG_DIR: profile }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    })
    child.stdin.write(JSON.stringify({ profile, localId, mode, ...extra })); child.stdin.end()
    return child
  }
  async function run(mode: string, extra: Record<string, unknown> = {}) {
    const child = spawn(mode, extra), stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    const errors = await stderr; expect(errors).not.toContain(f.password)
    const lines = (await stdout).trim().split('\n').filter(Boolean)
    const value: unknown = JSON.parse(required(lines.at(-1)))
    const result = object(value); expect(result.failed).not.toBe(true)
    return result
  }
  expect(object((await run('seed-login', { loginInput })).mutation).ok).toBe(true)
  await f.stop()
  const child = spawn('queue', { command, stopAt: 'queued-persisted' })
  const errors = new Response(child.stderr).text(), reader = child.stdout.getReader()
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
  let output = '', hit = false
  try {
    const decoder = new TextDecoder()
    for (;;) {
      const next = await reader.read(); if (next.done) break
      output += decoder.decode(next.value, { stream: true })
      if (output.includes('queued-persisted')) { hit = true; break }
    }
    expect(hit).toBe(true); child.kill('SIGKILL'); await child.exited; expect(child.signalCode).toBe('SIGKILL')
  } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill('SIGKILL'); await child.exited }; reader.releaseLock(); await errors }
  expect(await f.counts()).toEqual({ receipts: 0, events: 0, revision: '0' })
  const restored = await run('get', { secrets: [command.commandId, command.payload.artifactDigest, loginInput.password] })
  expect(restored.plaintextLeak).toBe(false)
  expect(object(restored.view).state).toBe('queued')
  expect(object(restored.view).command).toEqual({ ...command, workspaceId: f.workspaceId })
  const scopeRace = await run('get-scope-race')
  expect(scopeRace.scopeChanged).toBe(true); expect(scopeRace.preserved).toBe(true)
  expect(scopeRace.result).toEqual({ state: 'blocked', eligible: false, code: 'WORKSPACE_MISMATCH' })
  expect(JSON.stringify(scopeRace.result)).not.toContain(command.commandId)
  const codec = await run('mismatched-operation-codec')
  expect(codec.preserved).toBe(true);expect(object(codec.view)).toMatchObject({state:'blocked',code:'CAPABILITY_UNAVAILABLE'});expect(object(codec.cancel)).toMatchObject({state:'blocked',code:'CAPABILITY_UNAVAILABLE'})
  expect(object(restored.scope)).toMatchObject({ workspaceId: f.workspaceId, principalId: f.owner.principalId })
  expect(object((await run('project-conflict')).result)).toMatchObject({ state: 'blocked', code: 'IDEMPOTENCY_CONFLICT' })
  expect(object((await run('get')).view).command).toEqual({ ...command, workspaceId: f.workspaceId })
  const forged = await run('queue', { command: { ...command, actor: { principalId: f.owner.principalId } } })
  expect(object(forged.result)).toMatchObject({ state: 'blocked', code: 'INVALID_PAYLOAD' })
  // Explicitly bind the restart to the same listener address used by the stored authority.
  await f.start(f.registry)
  const actualUrl = `http://127.0.0.1:${f.current().server.port}`
  expect(actualUrl).toBe(loginInput.serviceUrl)
  // A real accepted command and GET cannot clear the encrypted intent when durable event replay is dropped.
  required(f.current().licenseRepository).events = async () => ({ events: [], nextCursor: randomUUID() })
  const dropped = await run('retry')
  expect(object(dropped.result).state).toBe('uncertain')
  expect(dropped.pendingPresent).toBe(true)
  expect(object(dropped.view).command).toEqual({ ...command, workspaceId: f.workspaceId })
  expect(await f.counts()).toEqual({ receipts: 1, events: 1, revision: '1' })
  await f.restart()
  const attempted = await run('retry')
  expect(object(attempted.result).state).toBe('applied')
  expect(object(object(attempted.result).result).data).toEqual(await f.get())
  expect(object(object(attempted.result).event).causationId).toBe(command.commandId)
  expect(object(object(attempted.result).event).correlationId).toBe(command.commandId)
  expect(await f.counts()).toEqual({ receipts: 1, events: 1, revision: '1' })
  expect(object((await run('get')).view).state).toBe('none')
  const unknown = await run('future-format', { command })
  expect(unknown.preserved).toBe(true)
  for (const entry of readdirSync(profile, { withFileTypes: true })) if (entry.isFile()) {
    expect(readFileSync(join(profile, entry.name)).includes(Buffer.from(command.commandId))).toBe(false)
  }
  } finally { await f.dispose() }
})
