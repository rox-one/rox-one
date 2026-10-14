import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { importCloudHandoffWorkspace } from '../cloud-handoff-import'

const IMPORT_URL = pathToFileURL(join(import.meta.dir, '..', 'cloud-handoff-import.ts')).href
const CONFIG_URL = pathToFileURL(join(import.meta.dir, '..', '..', '..', '..', 'shared', 'src', 'config', 'storage.ts')).href
const SESSIONS_URL = pathToFileURL(join(import.meta.dir, '..', '..', '..', '..', 'shared', 'src', 'sessions', 'index.ts')).href

const temps: string[] = []
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }) })

const SID = '260101-brave-otter'

/** Simulate what rox-handoff-start unpacks inside the sandbox. */
function makeLayout(): { home: string; ws: string; configDir: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'rox-handoff-home-')))
  temps.push(home)
  const ws = join(home, 'rox-workspace')
  const sessionDir = join(ws, 'sessions', SID)
  mkdirSync(join(sessionDir, 'attachments'), { recursive: true })
  mkdirSync(join(ws, 'project', 'src'), { recursive: true })
  writeFileSync(join(ws, 'project', 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(sessionDir, 'attachments', 'pic.png'), 'png')
  const header = {
    id: SID, name: 'Перенесённый чат', createdAt: 1, lastUsedAt: 2,
    workingDirectory: '/Users/mark/code/app', sdkCwd: '/Users/mark/.rox/x',
    sharedOwnerKey: 'owner-secret', sharedUrl: 'https://share', sharedId: 's1',
  }
  const msg = { id: 'm1', type: 'user', content: 'привет', timestamp: 3 }
  writeFileSync(join(sessionDir, 'session.jsonl'), `${JSON.stringify(header)}\n${JSON.stringify(msg)}\n`)
  const configDir = join(home, '.rox')
  mkdirSync(configDir)
  return { home, ws, configDir }
}

async function runImport(l: { home: string; ws: string; configDir: string }, extraEnv: Record<string, string> = {}) {
  const env = { ROX_HANDOFF_WORKSPACE_DIR: l.ws, ROX_HANDOFF_SESSION_ID: SID, ROX_HANDOFF_ALLOWED_ROOT: l.home, ...extraEnv }
  const proc = Bun.spawn({
    cmd: ['bun', '-e', `
process.env.ROX_CONFIG_DIR = ${JSON.stringify(l.configDir)};
process.env.CRAFT_CONFIG_DIR = ${JSON.stringify(l.configDir)};
const config = await import(${JSON.stringify(CONFIG_URL)});
const sessions = await import(${JSON.stringify(SESSIONS_URL)});
const { importCloudHandoffWorkspace } = await import(${JSON.stringify(IMPORT_URL)});
config.ensureConfigDir?.();
const r = await importCloudHandoffWorkspace({ createAndActivateLocalWorkspace: config.createAndActivateLocalWorkspace }, ${JSON.stringify(env)});
const ws = config.getWorkspaces();
const active = config.getActiveWorkspace?.();
const listed = sessions.listActiveSessions(r.rootPath);
console.log(JSON.stringify({ r, ws: ws.map(w => ({ id: w.id, rootPath: w.rootPath })), activeId: active?.id, listed: listed.map(s => s.id) }));
`],
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env },
  })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`import subprocess failed: ${err}`)
  return JSON.parse(out.trim().split('\n').pop()!)
}

describe('cloud handoff startup import', () => {
  it('is a no-op without ROX_HANDOFF_WORKSPACE_DIR', async () => {
    let called = false
    const r = await importCloudHandoffWorkspace({ createAndActivateLocalWorkspace: async () => { called = true; throw new Error('x') } }, {})
    expect(r).toBeNull()
    expect(called).toBe(false)
  })

  it('registers the unpacked workspace, activates it and lists the transferred session; idempotent', async () => {
    const l = makeLayout()
    const first = await runImport(l)
    expect(first.r.sessionId).toBe(SID)
    expect(first.r.rewritten).toBe(true)
    expect(first.ws.filter((w: { rootPath: string }) => w.rootPath === l.ws)).toHaveLength(1)
    expect(first.activeId).toBe(first.r.workspaceId)
    expect(first.listed).toContain(SID)

    const lines = readFileSync(join(l.ws, 'sessions', SID, 'session.jsonl'), 'utf8').split('\n')
    const header = JSON.parse(lines[0]!)
    expect(header.workingDirectory).toBe(join(l.ws, 'project'))
    expect(header.sharedOwnerKey).toBeUndefined()
    expect(header.sharedUrl).toBeUndefined()
    expect(JSON.parse(lines[1]!).content).toBe('привет')

    const second = await runImport(l)
    expect(second.r.workspaceId).toBe(first.r.workspaceId)
    expect(second.r.rewritten).toBe(false)
    expect(second.ws.filter((w: { rootPath: string }) => w.rootPath === l.ws)).toHaveLength(1)
    expect(second.listed).toContain(SID)
  })

  const noop = { createAndActivateLocalWorkspace: async () => { throw new Error('must not register') } }

  it('rejects a workspace dir outside the allowed root', async () => {
    const l = makeLayout()
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'rox-handoff-other-'))); temps.push(other)
    await expect(importCloudHandoffWorkspace(noop, { ROX_HANDOFF_WORKSPACE_DIR: l.ws, ROX_HANDOFF_SESSION_ID: SID, ROX_HANDOFF_ALLOWED_ROOT: other })).rejects.toThrow(/must live under/)
  })

  it('rejects relative paths and symlinked dirs', async () => {
    const l = makeLayout()
    await expect(importCloudHandoffWorkspace(noop, { ROX_HANDOFF_WORKSPACE_DIR: 'rox-workspace', ROX_HANDOFF_SESSION_ID: SID, ROX_HANDOFF_ALLOWED_ROOT: l.home })).rejects.toThrow(/absolute/)
    const link = join(l.home, 'link-ws'); symlinkSync(l.ws, link)
    await expect(importCloudHandoffWorkspace(noop, { ROX_HANDOFF_WORKSPACE_DIR: link, ROX_HANDOFF_SESSION_ID: SID, ROX_HANDOFF_ALLOWED_ROOT: l.home })).rejects.toThrow(/real directory/)
  })

  it('rejects traversal / unknown session ids and missing transcript', async () => {
    const l = makeLayout()
    for (const bad of ['', '..', '../x', 'a/b', 'x'.repeat(129)]) {
      await expect(importCloudHandoffWorkspace(noop, { ROX_HANDOFF_WORKSPACE_DIR: l.ws, ROX_HANDOFF_SESSION_ID: bad, ROX_HANDOFF_ALLOWED_ROOT: l.home })).rejects.toThrow(/invalid ROX_HANDOFF_SESSION_ID/)
    }
    await expect(importCloudHandoffWorkspace(noop, { ROX_HANDOFF_WORKSPACE_DIR: l.ws, ROX_HANDOFF_SESSION_ID: 'nope', ROX_HANDOFF_ALLOWED_ROOT: l.home })).rejects.toThrow()
  })
})
