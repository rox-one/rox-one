import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync, lstatSync, readlinkSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveNumberedUserDataDir } from '../numbered-user-data'
import { IMPORT_LEGACY_INSTALL_COMMAND, buildRestartCommand, REMOTE_INSTALL_DIR, REMOTE_HOME_MOVE_COMMAND, REMOTE_LAYOUT_PROBE_COMMAND } from '../ssh-tunnel/server-bootstrap'
import { remoteTokenCandidatePaths, remoteReadTokenCommand, extractToken } from '../ssh-tunnel/ssh-tunnel-manager'

function temporary(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'rox-paths-'))
  try { run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('ROX path migration', () => {
  it('copies a legacy remote installation without overwriting or deleting files', () => temporary(root => {
    const legacy = join(root, '.craft-agent/remote-server')
    const canonical = join(root, '.rox/remote-server')
    mkdirSync(legacy, { recursive: true }); mkdirSync(canonical, { recursive: true })
    writeFileSync(join(legacy, 'start.sh'), '#!/bin/sh\n', { mode: 0o755 })
    mkdirSync(join(legacy, 'config')); writeFileSync(join(legacy, 'config/settings'), 'settings')
    writeFileSync(join(legacy, 'conflict'), 'legacy'); writeFileSync(join(canonical, 'conflict'), 'rox')
    const result = spawnSync('/bin/sh', ['-c', IMPORT_LEGACY_INSTALL_COMMAND], { env: { ...process.env, HOME: root } })
    expect(result.status).toBe(0)
    expect(existsSync(join(canonical, 'start.sh'))).toBe(true)
    expect(readFileSync(join(canonical, 'config/settings'), 'utf8')).toBe('settings')
    expect(readFileSync(join(canonical, 'conflict'), 'utf8')).toBe('rox')
    expect(readFileSync(join(legacy, 'conflict'), 'utf8')).toBe('legacy')
    expect(existsSync(join(canonical, '.legacy-env-compat'))).toBe(true)
  }))
  it('fails with an actionable error if a legacy installation disappeared', () => temporary(root => {
    const result = spawnSync('/bin/sh', ['-c', IMPORT_LEGACY_INSTALL_COMMAND], { env: { ...process.env, HOME: root } })
    expect(result.status).not.toBe(0)
    expect(result.stderr.toString()).toContain('reinstall the managed ROX server')
    expect(existsSync(join(root, '.rox'))).toBe(false)
  }))
  it('uses ROX only for new launchers and shared canonical state for imported ones', () => {
    expect(REMOTE_INSTALL_DIR).toBe('~/.rox/remote-server')
    expect(buildRestartCommand(9200)).not.toContain('CRAFT_')
    const imported = buildRestartCommand(9200, true)
    expect(imported).toContain('ROX_CONFIG_DIR=~/.rox/remote-server/config')
    expect(imported).toContain('CRAFT_CONFIG_DIR=~/.rox/remote-server/config')
  })
  it('reads canonical tokens first with explicit legacy fallback and safely quoted overrides', () => {
    const candidates = remoteTokenCandidatePaths()
    expect(candidates[0]).toBe('~/.rox/remote-server/.token')
    expect(candidates[3]).toBe('~/.craft-agent/remote-server/.token')
    expect(remoteTokenCandidatePaths('/custom/token')).toEqual(['/custom/token'])
    expect(remoteReadTokenCommand('~/token; echo bad')).toBe('cat "$HOME"/\'token; echo bad\' 2>/dev/null || true')
    expect(extractToken('ROX_SERVER_TOKEN=canonical_token_1234')).toBe('canonical_token_1234')
    expect(extractToken('CRAFT_SERVER_TOKEN=legacy_token_123456')).toBe('legacy_token_123456')
    expect(extractToken('CRAFT_SERVER_TOKEN=legacy_token_123456\nROX_SERVER_TOKEN=canonical_token_1234')).toBe('canonical_token_1234')
  })
  it('imports numbered profile data, preserves conflicts and skips Chromium locks', () => temporary(root => {
    const legacy = join(root, 'craft-agent-2'); const canonical = join(root, 'rox-2')
    mkdirSync(legacy); mkdirSync(canonical)
    writeFileSync(join(legacy, 'new'), 'old data'); writeFileSync(join(legacy, 'conflict'), 'old')
    writeFileSync(join(canonical, 'conflict'), 'new'); writeFileSync(join(legacy, 'SingletonCookie'), 'lock')
    expect(resolveNumberedUserDataDir(root, '2')).toBe(canonical)
    expect(readFileSync(join(canonical, 'new'), 'utf8')).toBe('old data')
    expect(readFileSync(join(canonical, 'conflict'), 'utf8')).toBe('new')
    expect(existsSync(join(canonical, 'SingletonCookie'))).toBe(false)
    expect(existsSync(join(legacy, 'new'))).toBe(true)
    expect(() => resolveNumberedUserDataDir(root, '../x')).toThrow('digits only')
  }))
  it('does not copy a profile held by a live legacy instance', () => temporary(root => {
    const legacy = join(root, 'craft-agent-3'); mkdirSync(legacy)
    symlinkSync(`localhost-${process.pid}`, join(legacy, 'SingletonLock'))
    expect(() => resolveNumberedUserDataDir(root, '3')).toThrow('Close legacy numbered')
    expect(existsSync(join(root, 'rox-3'))).toBe(false)
  }))
})

describe('W1-13 remote visible-home shell commands (flag ON only)', () => {
  const sh = (root: string, command: string) =>
    spawnSync('/bin/sh', ['-c', command], { env: { ...process.env, HOME: root } })
  const probe = (root: string) => sh(root, REMOTE_LAYOUT_PROBE_COMMAND).stdout.toString().trim()

  it('flag OFF token candidates are exactly main\'s', () => {
    expect(remoteTokenCandidatePaths()).toEqual([
      '~/.rox/remote-server/.token', '~/.rox/server-token', '~/.rox/.env',
      '~/.craft-agent/remote-server/.token', '~/.craft-agent/server-token', '~/.craft-agent/.env',
    ])
    const on = remoteTokenCandidatePaths(undefined, true)
    expect(on[0]).toBe('~/rox/remote-server/.token')
    expect(on.slice(3)).toEqual(remoteTokenCandidatePaths())
  })

  it('classifies fresh, legacy, movable, foreign and visible homes', () => {
    temporary(root => expect(probe(root)).toBe('FRESH'))
    temporary(root => { mkdirSync(join(root, '.rox')); expect(probe(root)).toBe('LEGACY') })
    temporary(root => {
      mkdirSync(join(root, '.rox/remote-server'), { recursive: true })
      writeFileSync(join(root, '.rox/remote-server/start.sh'), '#!/bin/sh\n', { mode: 0o755 })
      expect(probe(root)).toBe('MOVABLE')
      mkdirSync(join(root, 'rox')); writeFileSync(join(root, 'rox/notes.txt'), 'mine')
      expect(probe(root)).toBe('FOREIGN')
    })
    temporary(root => { mkdirSync(join(root, 'rox/remote-server'), { recursive: true }); expect(probe(root)).toBe('VISIBLE') })
    temporary(root => { mkdirSync(join(root, 'rox')); symlinkSync(join(root, 'rox'), join(root, '.rox')); expect(probe(root)).toBe('VISIBLE') })
  })

  it('moves a legacy home to a private ~/rox with a compat symlink', () => temporary(root => {
    mkdirSync(join(root, '.rox/remote-server'), { recursive: true })
    writeFileSync(join(root, '.rox/remote-server/start.sh'), '#!/bin/sh\n')
    const result = sh(root, REMOTE_HOME_MOVE_COMMAND)
    expect(result.stdout.toString().trim()).toBe('MOVED')
    expect(existsSync(join(root, 'rox/remote-server/start.sh'))).toBe(true)
    expect(lstatSync(join(root, '.rox')).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(root, '.rox'))).toBe(join(root, 'rox'))
    expect(statSync(join(root, 'rox')).mode & 0o777).toBe(0o700)
  }))

  it('never touches a foreign ~/rox', () => temporary(root => {
    mkdirSync(join(root, 'rox')); writeFileSync(join(root, 'rox/keep.txt'), 'keep')
    mkdirSync(join(root, '.rox/remote-server'), { recursive: true })
    writeFileSync(join(root, '.rox/remote-server/start.sh'), '#!/bin/sh\n')
    expect(sh(root, REMOTE_HOME_MOVE_COMMAND).stdout.toString().trim()).toBe('KEPT')
    expect(readdirSync(join(root, 'rox'))).toEqual(['keep.txt'])
    expect(lstatSync(join(root, '.rox')).isDirectory()).toBe(true)
  }))

  it('keeps the legacy home while a live writer holds its lock', () => temporary(root => {
    mkdirSync(join(root, '.rox'))
    writeFileSync(join(root, '.rox/.server.lock'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
    expect(sh(root, REMOTE_HOME_MOVE_COMMAND).stdout.toString().trim()).toBe('KEPT')
    expect(existsSync(join(root, 'rox'))).toBe(false)
  }))

  it('is a no-op without a legacy home', () => temporary(root => {
    expect(sh(root, REMOTE_HOME_MOVE_COMMAND).stdout.toString().trim()).toBe('KEPT')
    expect(existsSync(join(root, 'rox'))).toBe(false)
    expect(existsSync(join(root, '.rox'))).toBe(false)
  }))

  // Review 2 (finding 6): wait for the managed server, real lock path,
  // re-check before ln -s, never-nesting rollback.
  const realMv = spawnSync('/bin/sh', ['-c', 'command -v mv']).stdout.toString().trim()
  const moveIn = (root: string, extraEnv: Record<string, string> = {}) =>
    spawnSync('/bin/sh', ['-c', REMOTE_HOME_MOVE_COMMAND], { env: { ...process.env, HOME: root, ...extraEnv } })
  const plantManaged = (root: string, startScript = '#!/bin/sh\n') => {
    mkdirSync(join(root, '.rox/remote-server/config'), { recursive: true })
    writeFileSync(join(root, '.rox/remote-server/start.sh'), startScript, { mode: 0o755 })
    writeFileSync(join(root, '.rox/remote-server/config/settings.json'), '{}')
  }
  const fakeBin = (root: string, tools: Record<string, string>) => {
    const bin = join(root, 'fakebin')
    mkdirSync(bin)
    for (const [name, body] of Object.entries(tools)) writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    return { PATH: `${bin}:${process.env.PATH ?? ''}` }
  }
  // A "managed server": a shell running ~/.rox/remote-server/start.sh.
  const startFakeServer = (root: string, seconds: number) => {
    plantManaged(root, `#!/bin/sh\nsleep ${seconds} &\necho $! > "$HOME/sleep.pid"\nwait\n`)
    return Bun.spawn(['/bin/sh', join(root, '.rox/remote-server/start.sh')], { env: { ...process.env, HOME: root } })
  }
  const stopFakeServer = async (root: string, server: ReturnType<typeof Bun.spawn>) => {
    try { process.kill(Number(readFileSync(join(root, 'sleep.pid'), 'utf8').trim())) } catch { /* gone */ }
    server.kill()
    await server.exited
  }
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(20)
  }

  it('the move command never contains the literal server path (pgrep/ps self-match)', () => {
    expect(REMOTE_HOME_MOVE_COMMAND).not.toContain('.rox/remote-server')
    expect(REMOTE_HOME_MOVE_COMMAND).toContain('pgrep -u "$(id -u)" -f "[.]rox/$d"')
    expect(REMOTE_HOME_MOVE_COMMAND).toContain('~/.rox/$d/config/.server.lock')
    expect(REMOTE_HOME_MOVE_COMMAND).toContain('~/.rox/.app.lock')
    expect(REMOTE_HOME_MOVE_COMMAND).toContain('! test -e ~/.rox && ! test -L ~/.rox && ln -s "$HOME/rox" ~/.rox')
    expect(REMOTE_HOME_MOVE_COMMAND).toContain('! test -e ~/.rox && ! test -L ~/.rox && mv $T ~/rox ~/.rox')
    expect(REMOTE_HOME_MOVE_COMMAND).toContain('! test -e ~/rox && ! test -L ~/rox && mv $T ~/.rox ~/rox')
  })

  it('keeps the legacy layout while the managed server is still running after the wait', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-paths-'))
    const server = startFakeServer(root, 30)
    try {
      await waitFor(() => existsSync(join(root, 'sleep.pid')))
      const result = moveIn(root, { ROX_REMOTE_MOVE_WAIT: '1' })
      expect(result.stdout.toString().trim()).toBe('KEPT')
      expect(lstatSync(join(root, '.rox')).isDirectory()).toBe(true)
      expect(existsSync(join(root, 'rox'))).toBe(false)
    } finally {
      await stopFakeServer(root, server)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('moves once the managed server exits within the wait', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-paths-'))
    const server = startFakeServer(root, 1)
    try {
      await waitFor(() => existsSync(join(root, 'sleep.pid')))
      const result = moveIn(root, { ROX_REMOTE_MOVE_WAIT: '8' })
      expect(result.stdout.toString().trim()).toBe('MOVED')
      expect(lstatSync(join(root, '.rox')).isSymbolicLink()).toBe(true)
      expect(existsSync(join(root, 'rox/remote-server/config/settings.json'))).toBe(true)
    } finally {
      await stopFakeServer(root, server)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('honours the managed server\'s own config lock', () => temporary(root => {
    plantManaged(root)
    writeFileSync(join(root, '.rox/remote-server/config/.server.lock'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
    expect(moveIn(root).stdout.toString().trim()).toBe('KEPT')
    expect(existsSync(join(root, 'rox'))).toBe(false)
  }))

  it('a legacy dir that reappears before ln -s is never nested into: SPLIT, data in ~/rox', () => temporary(root => {
    plantManaged(root)
    const env = fakeBin(root, { mv: `${realMv} "$@" || exit $?\ncase "$*" in *"$HOME/.rox $HOME/rox"*) mkdir "$HOME/.rox" ;; esac` })
    expect(moveIn(root, env).stdout.toString().trim()).toBe('SPLIT')
    expect(existsSync(join(root, 'rox/remote-server/start.sh'))).toBe(true)
    expect(lstatSync(join(root, '.rox')).isDirectory()).toBe(true)
    expect(readdirSync(join(root, '.rox'))).toEqual([]) // no ~/.rox/rox link
    expect(statSync(join(root, 'rox')).mode & 0o777).toBe(0o700)
  }))

  // Review 4 (finding 4): ~/rox (or a moved legacy home) appearing during
  // the wait window is re-checked right before mv; mv -T where supported.
  const nested = (root: string) => existsSync(join(root, 'rox/.rox')) || existsSync(join(root, 'rox/rox'))

  it('~/rox appearing during the wait is never moved into: KEPT, nothing nested', () => temporary(root => {
    plantManaged(root)
    const env = fakeBin(root, { pgrep: 'mkdir -p "$HOME/rox" && echo mine > "$HOME/rox/notes.txt"; exit 1' })
    expect(moveIn(root, env).stdout.toString().trim()).toBe('KEPT')
    expect(readdirSync(join(root, 'rox'))).toEqual(['notes.txt'])
    expect(lstatSync(join(root, '.rox')).isDirectory()).toBe(true)
    expect(nested(root)).toBe(false)
  }))

  it('a second bootstrap that already moved and linked never produces a self-loop', () => temporary(root => {
    plantManaged(root)
    const env = fakeBin(root, {
      pgrep: `if ! test -L "$HOME/.rox"; then ${realMv} "$HOME/.rox" "$HOME/rox" && ln -s "$HOME/rox" "$HOME/.rox"; fi; exit 1`,
    })
    expect(moveIn(root, env).stdout.toString().trim()).toBe('KEPT')
    expect(lstatSync(join(root, '.rox')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(root, 'rox/remote-server/start.sh'))).toBe(true)
    expect(nested(root)).toBe(false)
  }))

  it('BSD mv without -T: the re-check still guards the race, and a clean move works', () => {
    const bsdMv = `if test "$1" = -T; then echo "mv: illegal option -- T" >&2; exit 64; fi; exec ${realMv} "$@"`
    temporary(root => {
      plantManaged(root)
      const env = fakeBin(root, { mv: bsdMv, pgrep: 'mkdir -p "$HOME/rox/x"; exit 1' })
      expect(moveIn(root, env).stdout.toString().trim()).toBe('KEPT')
      expect(nested(root)).toBe(false)
    })
    temporary(root => {
      plantManaged(root)
      expect(moveIn(root, fakeBin(root, { mv: bsdMv })).stdout.toString().trim()).toBe('MOVED')
      expect(lstatSync(join(root, '.rox')).isSymbolicLink()).toBe(true)
    })
  })

  it('mv -T refuses a ~/rox created between the re-check and mv', () => temporary(root => {
    plantManaged(root)
    const env = fakeBin(root, {
      mv: `if test "$2" = "$HOME/.rox" || test "$1" = "$HOME/.rox"; then mkdir -p "$HOME/rox" && echo late > "$HOME/rox/late.txt"; fi; exec ${realMv} "$@"`,
    })
    expect(moveIn(root, env).stdout.toString().trim()).toBe('KEPT')
    expect(readdirSync(join(root, 'rox'))).toEqual(['late.txt'])
    expect(lstatSync(join(root, '.rox')).isDirectory()).toBe(true)
    expect(nested(root)).toBe(false)
  }))

  it('ln -s failure rolls back into the absent legacy path: KEPT', () => temporary(root => {
    plantManaged(root)
    const env = fakeBin(root, { ln: 'exit 1' })
    expect(moveIn(root, env).stdout.toString().trim()).toBe('KEPT')
    expect(existsSync(join(root, '.rox/remote-server/config/settings.json'))).toBe(true)
    expect(lstatSync(join(root, '.rox')).isDirectory()).toBe(true)
    expect(existsSync(join(root, 'rox'))).toBe(false)
  }))
})
