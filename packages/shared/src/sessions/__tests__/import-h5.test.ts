import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverForeignSessions } from '../import-discover.ts'
import { convertClaudeJsonl, convertGrokCatalog, inferForeignKind, redactSecrets } from '../import-convert.ts'
import { isAllowedForeignSourcePath, isHomePath, isSensitiveAgentCwd } from '../import-home.ts'
import { listImportedSessionFiles, persistForeignSession, readImportedSession } from '../import-persist.ts'
import { loadForeignImportRegistry } from '../import-registry.ts'

const dirs: string[] = []

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeGrok(root: string, id: string, cwd: string, user: string, assistant: string): string {
  const dir = join(root, '.grok', 'sessions', encodeURIComponent(cwd), id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'summary.json'),
    JSON.stringify({
      info: { id, cwd },
      generated_title: 'Grok fixture',
      session_summary: 'Grok fixture',
    }),
  )
  writeFileSync(
    join(dir, 'chat_history.jsonl'),
    [
      JSON.stringify({ type: 'system', content: 'ignore' }),
      JSON.stringify({ type: 'user', content: [{ type: 'text', text: user }] }),
      JSON.stringify({ type: 'assistant', content: assistant }),
    ].join('\n') + '\n',
  )
  return dir
}

function writeClaude(root: string, name: string, user: string, assistant: string, cwd?: string): string {
  const dir = join(root, '.claude', 'projects', 'fixture')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.jsonl`)
  writeFileSync(
    path,
    [
      JSON.stringify({
        type: 'user',
        cwd,
        message: { role: 'user', content: [{ type: 'text', text: user }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: assistant }] },
      }),
    ].join('\n') + '\n',
  )
  return path
}

describe('H5 foreign import', () => {
  it('scan does not persist Rox sessions', async () => {
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    writeGrok(home, 'g1', join(home, 'proj'), 'hello grok', 'hi')
    writeClaude(home, 'c1', 'hello claude', 'ok')
    const discovered = discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    expect(discovered.entries.filter((e) => e.kind === 'grok' || e.kind === 'claude').length).toBe(2)
    expect(existsSync(discovered.cachePath)).toBe(true)
    expect(listImportedSessionFiles(workspace)).toEqual([])
  })

  it('persists one Claude JSONL and one Grok catalog as two Rox sessions', async () => {
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    const grokDir = writeGrok(home, 'g1', join(home, 'proj'), 'hello grok', 'hi from grok')
    const claudePath = writeClaude(home, 'c1', 'hello claude', 'hi from claude', join(home, 'proj'))
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const grok = await persistForeignSession({ workspaceRoot: workspace, sourcePath: grokDir, kind: 'grok', homeDir: home })
    const claude = await persistForeignSession({
      workspaceRoot: workspace,
      sourcePath: claudePath,
      kind: 'claude',
      homeDir: home,
    })
    expect(grok.action).toBe('created')
    expect(claude.action).toBe('created')
    expect(listImportedSessionFiles(workspace)).toHaveLength(2)
    const grokSession = readImportedSession(workspace, grok.sessionId!)
    const claudeSession = readImportedSession(workspace, claude.sessionId!)
    expect(grokSession?.messages.some((m) => m.content.includes('hello grok'))).toBe(true)
    expect(claudeSession?.messages.some((m) => m.content.includes('hello claude'))).toBe(true)
    expect(grokSession?.workingDirectory).not.toBe(home)
    const file = listImportedSessionFiles(workspace).find((p) => p.includes(grok.sessionId!))!
    expect(readFileSync(file, 'utf8')).not.toContain('zstd')
    expect(file.endsWith('session.jsonl')).toBe(true)
  })

  it('skips the same sourcePath on a second persist and skips empty sources', async () => {
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    const grokDir = writeGrok(home, 'g1', join(home, 'proj'), 'hello', 'hi')
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const first = await persistForeignSession({ workspaceRoot: workspace, sourcePath: grokDir, kind: 'grok', homeDir: home })
    const second = await persistForeignSession({ workspaceRoot: workspace, sourcePath: grokDir, kind: 'grok', homeDir: home })
    expect(first.action).toBe('created')
    expect(second.action).toBe('skipped')
    expect(second.reason).toBe('already-imported')
    expect(listImportedSessionFiles(workspace)).toHaveLength(1)
    expect(loadForeignImportRegistry(workspace)[grokDir]?.sessionId).toBe(first.sessionId)

    const emptyDir = join(home, '.grok', 'sessions', 'empty', 'e1')
    mkdirSync(emptyDir, { recursive: true })
    writeFileSync(join(emptyDir, 'summary.json'), JSON.stringify({ info: { cwd: join(home, 'proj') }, generated_title: 'empty' }))
    writeFileSync(join(emptyDir, 'chat_history.jsonl'), '')
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const empty = await persistForeignSession({ workspaceRoot: workspace, sourcePath: emptyDir, kind: 'grok', homeDir: home })
    expect(empty.action).toBe('skipped')
    expect(empty.reason).toBe('not-in-scan-cache')
    expect(convertGrokCatalog(emptyDir).userTurns).toBe(0)
  })

  it('attaches $HOME cwd to the current workspace and redacts secrets', async () => {
    expect(isHomePath('/tmp/not-home', '/Users/mark')).toBe(false)
    expect(isHomePath('/Users/mark', '/Users/mark')).toBe(true)
    expect(isSensitiveAgentCwd('/etc', '/Users/mark')).toBe(true)
    expect(isAllowedForeignSourcePath('/etc/passwd', '/Users/mark')).toBe(false)
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    const grokDir = writeGrok(home, 'g-home', home, 'token sk-ant-abcdefghijklmnopqrstuvwxyz123456', 'ok')
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const result = await persistForeignSession({ workspaceRoot: workspace, sourcePath: grokDir, kind: 'grok', homeDir: home })
    const session = readImportedSession(workspace, result.sessionId!)
    expect(session?.workingDirectory).toBe(workspace)
    expect(session?.messages.some((m) => m.content.includes('sk-ant-'))).toBe(false)
    expect(session?.messages.some((m) => m.content.includes('[redacted]'))).toBe(true)
    expect(redactSecrets('plain').hit).toBe(false)
    expect(redactSecrets('ghp_abcdefghijklmnopqrstuvwx').hit).toBe(true)
    expect(redactSecrets('xai-abcdefghijklmnopqrstuvwxyz123456').hit).toBe(true)
    expect(redactSecrets(`sk_live_${'abcdefghijklmnopqrstuvwxyz'}`).hit).toBe(true)
    expect(redactSecrets('-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----').hit).toBe(true)
    expect(convertClaudeJsonl(writeClaude(home, 'secret', 'hello', 'ok')).userTurns).toBe(1)
  })

  it('skips missing sources without throwing', async () => {
    const workspace = tmp('h5-ws-')
    const missing = join(workspace, 'no-such-source')
    const result = await persistForeignSession({
      workspaceRoot: workspace,
      sourcePath: missing,
      kind: 'claude',
    })
    expect(result.action).toBe('skipped')
    expect(result.reason).toBe('outside-p0-root')
  })

  it('does not mention ~/.dsh or zstd in the import pipeline', () => {
    const files = [
      'import-home.ts',
      'import-types.ts',
      'import-discover.ts',
      'import-convert.ts',
      'import-registry.ts',
      'import-persist.ts',
    ]
    for (const name of files) {
      const src = readFileSync(join(import.meta.dir, '..', name), 'utf8')
      expect(src).not.toContain('~/.dsh')
      expect(src).not.toContain('session.jsonl.zstd')
      expect(src).not.toContain('dsh-cordis')
      expect(src).not.toContain('127.0.0.1:43120')
    }
  })

  it('refuses persist unless the source was scanned', async () => {
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    const grokDir = writeGrok(home, 'g1', join(home, 'proj'), 'hello', 'hi')
    const result = await persistForeignSession({ workspaceRoot: workspace, sourcePath: grokDir, kind: 'grok', homeDir: home })
    expect(result.action).toBe('skipped')
    expect(result.reason).toBe('not-in-scan-cache')
    expect(listImportedSessionFiles(workspace)).toEqual([])
  })

  it('does not attach a foreign project cwd and ignores a symlink swapped in after scan', async () => {
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    const project = join(home, 'proj')
    mkdirSync(project, { recursive: true })
    const grokDir = writeGrok(home, 'g-cwd', project, 'hello cwd', 'ok')
    discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const created = await persistForeignSession({ workspaceRoot: workspace, sourcePath: grokDir, kind: 'grok', homeDir: home })
    expect(created.action).toBe('created')
    expect(readImportedSession(workspace, created.sessionId!)?.workingDirectory).toBe(workspace)

    const history = join(grokDir, 'chat_history.jsonl')
    const leaked = join(home, 'leaked.txt')
    writeFileSync(leaked, 'xai-abcdefghijklmnopqrstuvwxyz123456')
    rmSync(history)
    symlinkSync(leaked, history)
    const swapped = await persistForeignSession({
      workspaceRoot: workspace,
      sourcePath: grokDir,
      kind: 'grok',
      homeDir: home,
      mode: 'force',
    })
    expect(swapped.action).toBe('skipped')
    const file = listImportedSessionFiles(workspace)[0]!
    expect(readFileSync(file, 'utf8')).not.toContain('xai-')
  })

  it('infers kind from P0 roots only and redacts titles', async () => {
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    expect(inferForeignKind(join(home, 'Documents', 'opencode-notes.jsonl'), home)).toBeUndefined()
    const grokDir = writeGrok(
      home,
      'g-title',
      join(home, 'proj'),
      'hello',
      'ok',
    )
    writeFileSync(
      join(grokDir, 'summary.json'),
      JSON.stringify({
        info: { id: 'g-title', cwd: join(home, 'proj') },
        generated_title: 'token xai-abcdefghijklmnopqrstuvwxyz123456',
        session_summary: 'Grok fixture',
      }),
    )
    const discovered = discoverForeignSessions({ workspaceRoot: workspace, homeDir: home })
    const grok = discovered.entries.find((entry) => entry.sourcePath === grokDir)
    expect(inferForeignKind(grokDir, home)).toBe('grok')
    expect(grok?.title).not.toContain('xai-')
    expect(grok?.title).toContain('[redacted]')
  })

  it('does not let empty grok rows consume the scan cap before claude', async () => {
    const home = tmp('h5-home-')
    const workspace = tmp('h5-ws-')
    writeGrok(home, 'g-empty-a', join(home, 'proj'), '', '')
    writeGrok(home, 'g-empty-b', join(home, 'proj'), '', '')
    writeGrok(home, 'g-ok', join(home, 'proj'), 'hello grok', 'ok')
    writeClaude(home, 'c-ok', 'hello claude', 'ok')
    writeGrok(home, 'g-ok-2', join(home, 'proj'), 'second grok', 'ok')
    const discovered = discoverForeignSessions({
      workspaceRoot: workspace,
      homeDir: home,
      maxEntries: 2,
      maxPerKind: 1,
    })
    expect(discovered.entries.some((entry) => entry.kind === 'claude')).toBe(true)
    expect(discovered.entries.filter((entry) => entry.kind === 'grok')).toHaveLength(1)
    expect(discovered.entries.every((entry) => entry.userTurns > 0)).toBe(true)
    expect(discovered.truncated).toBe(true)
  })
})
