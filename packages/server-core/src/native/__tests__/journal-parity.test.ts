import { afterEach, describe, expect, it } from 'bun:test'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NativeSupervisor, resolveNativeBin } from '../supervisor.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../')
const bin = resolveNativeBin(repoRoot) ?? (existsSync(process.env.CRAFT_NATIVE_BIN ?? '')
  ? process.env.CRAFT_NATIVE_BIN!
  : null)

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} }
}

describe.skipIf(!bin)('craft-journal shadow file', () => {
  const dirs: string[] = []
  let supervisor: NativeSupervisor | null = null

  afterEach(async () => {
    await supervisor?.stop()
    supervisor = null
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes session.native.jsonl and skips a truncated tail', async () => {
    const sockDir = mkdtempSync(join(tmpdir(), 'craft-native-journal-'))
    dirs.push(sockDir)
    const sessionDir = mkdtempSync(join(tmpdir(), 'craft-journal-sess-'))
    dirs.push(sessionDir)
    supervisor = new NativeSupervisor({
      enabled: true,
      resolveBin: () => bin,
      logger: silentLogger(),
      connectTimeoutMs: 8_000,
      cwd: repoRoot,
      socketPath: join(sockDir, 'n.sock'),
    })
    await supervisor.start()
    const client = supervisor.getClient()
    expect(client).not.toBeNull()

    const lines = [
      JSON.stringify({ id: 's1', workspaceRootPath: '/tmp/ws' }),
      JSON.stringify({ id: 'm1', type: 'user', content: 'first' }),
      JSON.stringify({ id: 'm2', type: 'user', content: 'second' }),
    ]
    const written = await client!.invoke<{ valid: number; path: string }>(
      'journal:write',
      sessionDir,
      lines,
    )
    expect(written.valid).toBe(3)
    expect(written.path.endsWith('session.native.jsonl')).toBe(true)
    expect(existsSync(join(sessionDir, 'session.jsonl'))).toBe(false)
    expect(readFileSync(join(sessionDir, 'session.native.jsonl'), 'utf8')).toContain('first')

    appendFileSync(join(sessionDir, 'session.native.jsonl'), '{"id":"m3","type":"user","content":"cut')

    const read = await client!.invoke<{ lines: Array<{ id: string }>; skipped: number }>(
      'journal:read',
      sessionDir,
    )
    expect(read.skipped).toBe(1)
    expect(read.lines.map((l) => l.id)).toEqual(['s1', 'm1', 'm2'])
  })

  it('writePrimary writes session.jsonl', async () => {
    const sockDir = mkdtempSync(join(tmpdir(), 'craft-native-journal-p-'))
    dirs.push(sockDir)
    const sessionDir = mkdtempSync(join(tmpdir(), 'craft-journal-primary-'))
    dirs.push(sessionDir)
    supervisor = new NativeSupervisor({
      enabled: true,
      resolveBin: () => bin,
      logger: silentLogger(),
      connectTimeoutMs: 8_000,
      cwd: repoRoot,
      socketPath: join(sockDir, 'n.sock'),
    })
    await supervisor.start()
    const client = supervisor.getClient()
    expect(client).not.toBeNull()

    const lines = [
      JSON.stringify({ id: 's1', workspaceRootPath: '/tmp/ws' }),
      JSON.stringify({ id: 'm1', type: 'user', content: 'primary' }),
    ]
    const written = await client!.invoke<{ valid: number; path: string }>(
      'journal:writePrimary',
      sessionDir,
      lines,
    )
    expect(written.valid).toBe(2)
    expect(written.path.endsWith('session.jsonl')).toBe(true)
    expect(existsSync(join(sessionDir, 'session.jsonl'))).toBe(true)
    expect(existsSync(join(sessionDir, 'session.native.jsonl'))).toBe(false)
    expect(readFileSync(join(sessionDir, 'session.jsonl'), 'utf8')).toContain('primary')
  })
})
