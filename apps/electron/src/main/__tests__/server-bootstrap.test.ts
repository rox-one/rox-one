import { describe, it, expect } from 'bun:test'
import {
  bootstrapRemoteServer,
  buildStartCommand,
  buildRestartCommand,
  buildWriteTokenCommand,
  CHECK_INSTALLED_COMMAND,
  IMPORT_LEGACY_INSTALL_COMMAND,
  KILL_MANAGED_SERVER_COMMAND,
  REMOTE_LOG_PATH,
  REMOTE_TOKEN_PATH,
  type ServerBootstrapDeps,
  type BootstrapProgress,
} from '../ssh-tunnel/server-bootstrap.ts'
import type { SshHostConfig } from '@rox/shared/config'

const HOST: SshHostConfig = {
  id: 'box',
  label: 'Box',
  host: '127.0.0.1',
  port: 2222,
  user: 'tester',
  remotePort: 9200,
}

interface Recorded {
  remoteCommands: string[]
  /** stdin payloads passed alongside remote commands (parallel to remoteCommands). */
  remoteStdins: Array<string | undefined>
  uploads: Array<{ local: string; remote: string }>
  stored: Record<string, string>
  progress: BootstrapProgress[]
}

function makeDeps(
  overrides: Partial<ServerBootstrapDeps> & {
    probeResults?: boolean[]
    initialToken?: string
  } = {},
): { deps: ServerBootstrapDeps; rec: Recorded; onProgress: (p: BootstrapProgress) => void } {
  const rec: Recorded = { remoteCommands: [], remoteStdins: [], uploads: [], stored: {}, progress: [] }
  if (overrides.initialToken) rec.stored[HOST.id] = overrides.initialToken
  const probeResults = overrides.probeResults ? [...overrides.probeResults] : []
  let probeIdx = 0

  const deps: ServerBootstrapDeps = {
    runRemote: async (_h, cmd, opts) => {
      rec.remoteCommands.push(cmd)
      rec.remoteStdins.push(opts?.stdin)
      if (cmd.includes('uname')) return 'Darwin arm64\n'
      if (cmd.includes('tail')) return 'boom: server crashed\n'
      return ''
    },
    uploadFile: async (_h, local, remote) => {
      rec.uploads.push({ local, remote })
    },
    detectTarget: () => ({ platform: 'darwin', arch: 'arm64' }),
    resolveArtifact: async () => ({
      archivePath: '/local/dist/craft-server-1.0.0-darwin-arm64.tar.gz',
      archiveName: 'craft-server-1.0.0-darwin-arm64.tar.gz',
      version: '1.0.0',
    }),
    probe: async () => {
      const r = probeResults[probeIdx] ?? false
      probeIdx++
      return r
    },
    generateToken: () => 'GENERATED_SECRET_TOKEN_abcdef0123456789',
    storeToken: async (hostId, token) => {
      rec.stored[hostId] = token
    },
    loadStoredToken: async (hostId) => rec.stored[hostId],
    sleep: async () => {},
    probeAttempts: 3,
    probeIntervalMs: 1,
    ...overrides,
  }
  const onProgress = (p: BootstrapProgress) => rec.progress.push(p)
  return { deps, rec, onProgress }
}

describe('buildWriteTokenCommand', () => {
  it('writes the token file from stdin with 0600 permissions', () => {
    const cmd = buildWriteTokenCommand()
    expect(cmd).toContain('umask 077')
    expect(cmd).toContain(`cat > ${REMOTE_TOKEN_PATH}`)
    expect(cmd).toContain(`chmod 600 ${REMOTE_TOKEN_PATH}`)
  })
})

describe('buildStartCommand', () => {
  it('extracts, reads token from file, detaches under nohup, logs to a file', () => {
    const cmd = buildStartCommand('~/.rox/x.tar.gz', 9200)
    expect(cmd).toContain('tar -xzf ~/.rox/x.tar.gz')
    expect(cmd).toContain(`ROX_SERVER_TOKEN="$(cat ${REMOTE_TOKEN_PATH})"`)
    expect(cmd).toContain('ROX_RPC_PORT=9200')
    expect(cmd).toContain('ROX_CONFIG_DIR=')
    expect(cmd).toContain('nohup')
    expect(cmd).toContain(REMOTE_LOG_PATH)
    expect(cmd).toContain('&')
  })

  it('detaches all fds so the ssh channel closes (no hang)', () => {
    const cmd = buildStartCommand('~/x.tgz', 9100)
    expect(cmd).toContain('< /dev/null')
    expect(cmd).toContain('sh -c')
  })
})

describe('bootstrapRemoteServer', () => {
  it('short-circuits when a server is already alive and a token is stored', async () => {
    const { deps, rec } = makeDeps({ probeResults: [true], initialToken: 'EXISTING_TOKEN' })
    const result = await bootstrapRemoteServer(HOST, deps, (p) => rec.progress.push(p))
    expect(result.token).toBe('EXISTING_TOKEN')
    expect(rec.uploads).toHaveLength(0)
    expect(rec.remoteCommands).toHaveLength(0)
    expect(rec.progress.map((p) => p.phase)).toEqual(['checking-server', 'ready'])
  })

  it('fails fast when a server is alive, no token is stored, and no install dir exists', async () => {
    const { deps, rec, onProgress } = makeDeps({ probeResults: [true] })
    await expect(bootstrapRemoteServer(HOST, deps, onProgress)).rejects.toThrow(
      /already running on port 9200.*not managed/s,
    )
    // Only the install-dir check ran — no upload, no start/restart.
    expect(rec.uploads).toHaveLength(0)
    expect(rec.remoteCommands).toEqual([CHECK_INSTALLED_COMMAND])
    // No token generated or stored for a server we don't manage.
    expect(rec.stored[HOST.id]).toBeUndefined()
    expect(rec.progress.at(-1)!.phase).toBe('error')
  })

  it('runs the full install path when no server exists', async () => {
    // First probe (initial check) false, then post-start probe true.
    const { deps, rec, onProgress } = makeDeps({ probeResults: [false, true] })
    const result = await bootstrapRemoteServer(HOST, deps, onProgress)

    expect(result.token).toBe('GENERATED_SECRET_TOKEN_abcdef0123456789')
    // Token was persisted.
    expect(rec.stored[HOST.id]).toBe('GENERATED_SECRET_TOKEN_abcdef0123456789')
    // Uploaded the artifact.
    expect(rec.uploads).toHaveLength(1)
    expect(rec.uploads[0]!.local).toContain('craft-server-1.0.0-darwin-arm64.tar.gz')
    // Detected OS, then started the server.
    expect(rec.remoteCommands.some((c) => c.includes('uname'))).toBe(true)
    expect(rec.remoteCommands.some((c) => c.includes('nohup'))).toBe(true)
    // Progress reached ready.
    expect(rec.progress.at(-1)!.phase).toBe('ready')
  })

  it('transfers the token via stdin only — never in any command argv', async () => {
    const { deps, rec, onProgress } = makeDeps({ probeResults: [false, true] })
    await bootstrapRemoteServer(HOST, deps, onProgress)

    // The token travels exactly once, as stdin to the write-token command.
    const stdinPayloads = rec.remoteStdins.filter((s) => s !== undefined)
    expect(stdinPayloads).toEqual(['GENERATED_SECRET_TOKEN_abcdef0123456789'])
    const writeIdx = rec.remoteStdins.findIndex((s) => s !== undefined)
    expect(rec.remoteCommands[writeIdx]).toContain(`cat > ${REMOTE_TOKEN_PATH}`)

    // No remote command string ever contains the literal token (ps-safe).
    for (const cmd of rec.remoteCommands) {
      expect(cmd).not.toContain('GENERATED_SECRET_TOKEN')
    }
  })

  it('never leaks the token into progress events', async () => {
    const { deps, rec, onProgress } = makeDeps({ probeResults: [false, true] })
    await bootstrapRemoteServer(HOST, deps, onProgress)
    const serialized = JSON.stringify(rec.progress)
    expect(serialized).not.toContain('GENERATED_SECRET_TOKEN')
  })

  it('reuses a stored token when the server needs (re)installing', async () => {
    const { deps, rec, onProgress } = makeDeps({
      probeResults: [false, true],
      initialToken: 'REUSED_TOKEN_0123456789abcdef',
    })
    const result = await bootstrapRemoteServer(HOST, deps, onProgress)
    expect(result.token).toBe('REUSED_TOKEN_0123456789abcdef')
    // The reused token was written to the remote token file via stdin.
    expect(rec.remoteStdins).toContain('REUSED_TOKEN_0123456789abcdef')
  })

  it('surfaces a remote log tail on start timeout', async () => {
    // Initial probe false, and all post-start probes false → timeout.
    const { deps, onProgress } = makeDeps({ probeResults: [false, false, false, false] })
    await expect(bootstrapRemoteServer(HOST, deps, onProgress)).rejects.toThrow(/server crashed/)
  })
})

describe('bootstrapRemoteServer — alive server, lost token, our install dir', () => {
  // Host re-added with the same slug while the app-managed server kept running:
  // port answers, no token, but OUR install dir is there — restart, not throw.
  it('kills + restarts the managed server with a freshly generated token', async () => {
    const cmds: string[] = []
    const stdins: (string | undefined)[] = []
    const { deps, rec } = makeDeps({
      probeResults: [true, true], // alive on first check, up again after restart
      runRemote: (async (_h: unknown, cmd: string, opts?: { stdin?: string }) => {
        cmds.push(cmd)
        stdins.push(opts?.stdin)
        if (cmd === CHECK_INSTALLED_COMMAND) return 'INSTALLED\n'
        return ''
      }) as ServerBootstrapDeps['runRemote'],
    })
    const { token } = await bootstrapRemoteServer(HOST, deps, (p) => rec.progress.push(p))
    expect(token).toBe('GENERATED_SECRET_TOKEN_abcdef0123456789')
    expect(rec.stored[HOST.id]).toBe(token) // fresh token persisted
    expect(rec.uploads).toHaveLength(0) // no re-upload
    // Old server killed before the relaunch, token via stdin only.
    expect(cmds).toContain(KILL_MANAGED_SERVER_COMMAND)
    expect(cmds).toContain(buildRestartCommand(HOST.remotePort))
    expect(cmds.indexOf(KILL_MANAGED_SERVER_COMMAND)).toBeLessThan(
      cmds.indexOf(buildRestartCommand(HOST.remotePort)),
    )
    expect(stdins.filter(Boolean)).toEqual([token])
    expect(cmds.some((c) => c.includes('GENERATED_SECRET_TOKEN'))).toBe(false)
    expect(rec.progress.at(-1)!.phase).toBe('ready')
  })

  it('throws with an error phase when the restarted server never answers', async () => {
    const { deps, rec } = makeDeps({
      probeResults: [true, false, false, false], // alive, then never back up
      runRemote: (async (_h: unknown, cmd: string) =>
        cmd === CHECK_INSTALLED_COMMAND ? 'INSTALLED\n' : '') as ServerBootstrapDeps['runRemote'],
    })
    await expect(bootstrapRemoteServer(HOST, deps, (p) => rec.progress.push(p))).rejects.toThrow(
      /did not come back up/,
    )
    expect(rec.progress.at(-1)!.phase).toBe('error')
  })
})

describe('bootstrapRemoteServer — restart path (server died, install intact)', () => {
  const installedRunRemote =
    (rec: string[], stdins: (string | undefined)[]) =>
    async (_h: unknown, cmd: string, opts?: { stdin?: string }) => {
      rec.push(cmd)
      stdins.push(opts?.stdin)
      if (cmd === CHECK_INSTALLED_COMMAND) return 'INSTALLED\n'
      if (cmd.includes('uname')) return 'Darwin arm64\n'
      if (cmd.includes('tail')) return 'boom\n'
      return ''
    }

  it('restarts without re-uploading when installed and a token is stored', async () => {
    const cmds: string[] = []
    const stdins: (string | undefined)[] = []
    const uploads: unknown[] = []
    const { deps } = makeDeps({
      initialToken: 'STORED_TOKEN_0123456789abcdef',
      probeResults: [false, true], // dead on first check, up after restart
      runRemote: installedRunRemote(cmds, stdins) as ServerBootstrapDeps['runRemote'],
      uploadFile: async (_h, l, r) => { uploads.push({ l, r }) },
    })
    const { token } = await bootstrapRemoteServer(HOST, deps)
    expect(token).toBe('STORED_TOKEN_0123456789abcdef')
    expect(uploads).toHaveLength(0)
    expect(cmds).toContain(buildRestartCommand(HOST.remotePort))
    // Token still travels via stdin only.
    expect(stdins.filter(Boolean)).toEqual(['STORED_TOKEN_0123456789abcdef'])
    expect(cmds.some(c => c.includes('STORED_TOKEN'))).toBe(false)
  })

  it('falls back to full reinstall when the restart does not bring the server up', async () => {
    const cmds: string[] = []
    const stdins: (string | undefined)[] = []
    const uploads: unknown[] = []
    const { deps } = makeDeps({
      initialToken: 'STORED_TOKEN_0123456789abcdef',
      // dead check, restart probes all fail (3 attempts), then up after reinstall
      probeResults: [false, false, false, false, true],
      runRemote: installedRunRemote(cmds, stdins) as ServerBootstrapDeps['runRemote'],
      uploadFile: async (_h, l, r) => { uploads.push({ l, r }) },
    })
    const { token } = await bootstrapRemoteServer(HOST, deps)
    expect(token).toBe('STORED_TOKEN_0123456789abcdef')
    expect(uploads).toHaveLength(1)
  })

  it('skips the restart probe entirely when nothing is installed', async () => {
    const { deps, rec } = makeDeps({
      initialToken: 'STORED_TOKEN_0123456789abcdef',
      probeResults: [false, true],
    })
    await bootstrapRemoteServer(HOST, deps)
    // Default mock returns '' for the install check → straight to full install.
    expect(rec.uploads).toHaveLength(1)
    expect(rec.remoteCommands).not.toContain(buildRestartCommand(HOST.remotePort))
  })
})


describe('legacy managed remote compatibility', () => {
  it('imports before writing canonical token and restarting with explicit aliases', async () => {
    const commands: string[] = []
    const { deps, rec } = makeDeps({
      initialToken: 'saved-token', probeResults: [false, true],
      runRemote: async (_host, command) => {
        commands.push(command)
        return command === CHECK_INSTALLED_COMMAND ? 'LEGACY_INSTALLED\n' : ''
      },
    })
    await bootstrapRemoteServer(HOST, deps)
    expect(commands.indexOf(IMPORT_LEGACY_INSTALL_COMMAND)).toBeLessThan(commands.indexOf(buildWriteTokenCommand()))
    expect(commands).toContain(buildRestartCommand(HOST.remotePort, true))
    expect(rec.uploads).toHaveLength(0)
  })
})

describe('W1-13 storage.visible-root.v1 remote layout', () => {
  async function load() {
    return import('../ssh-tunnel/server-bootstrap.ts')
  }
  function scripted(answers: Record<string, string>, commands: string[]): ServerBootstrapDeps['runRemote'] {
    return async (_host, command) => {
      commands.push(command)
      if (command.includes('uname')) return 'Darwin arm64\n'
      return answers[command] ?? ''
    }
  }

  it('flag OFF: no probe, no move, exactly main\'s legacy paths', async () => {
    const { REMOTE_LAYOUT_PROBE_COMMAND, REMOTE_HOME_MOVE_COMMAND } = await load()
    const { deps, rec } = makeDeps({ initialToken: 'saved', probeResults: [false, true] })
    await bootstrapRemoteServer(HOST, deps)
    expect(rec.remoteCommands).not.toContain(REMOTE_LAYOUT_PROBE_COMMAND)
    expect(rec.remoteCommands).not.toContain(REMOTE_HOME_MOVE_COMMAND)
    expect(rec.remoteCommands).toContain('mkdir -p ~/.rox')
    expect(rec.uploads[0]!.remote).toBe('~/.rox/craft-server-1.0.0-darwin-arm64.tar.gz')
    expect(rec.remoteCommands.join('\n')).not.toMatch(/~\/rox\b/)
    // main's exact strings
    expect(buildWriteTokenCommand()).toBe('mkdir -p ~/.rox/remote-server && umask 077 && cat > ~/.rox/remote-server/.token && chmod 600 ~/.rox/remote-server/.token')
    expect(KILL_MANAGED_SERVER_COMMAND).toBe(`pkill -f '[.](rox|craft-agent)/remote-server' 2>/dev/null || true`)
  })

  it('flag ON + managed legacy home: kills the server BEFORE moving, then restarts from ~/rox without CRAFT_ aliases', async () => {
    const m = await load()
    const commands: string[] = []
    const installedVisible = m.checkInstalledCommand(m.VISIBLE_REMOTE_LAYOUT)
    const { deps } = makeDeps({
      visibleRoot: true, initialToken: 'saved', probeResults: [false, true],
      runRemote: scripted({
        [m.REMOTE_LAYOUT_PROBE_COMMAND]: 'MOVABLE\n',
        [m.REMOTE_HOME_MOVE_COMMAND]: 'MOVED\n',
        [installedVisible]: 'INSTALLED\n',
      }, commands),
    })
    await bootstrapRemoteServer(HOST, deps)
    const kill = commands.indexOf(m.VISIBLE_KILL_MANAGED_SERVER_COMMAND)
    const move = commands.indexOf(m.REMOTE_HOME_MOVE_COMMAND)
    expect(kill).toBeGreaterThanOrEqual(0)
    expect(kill).toBeLessThan(move)
    const restart = m.buildRestartCommand(HOST.remotePort, false, m.VISIBLE_REMOTE_LAYOUT)
    expect(commands).toContain(restart)
    expect(restart).toContain('ROX_CONFIG_DIR=~/rox/remote-server/config')
    expect(restart).not.toContain('CRAFT_')
  })

  it('flag ON + SPLIT (data moved, a new legacy dir appeared): restarts from ~/rox', async () => {
    const m = await load()
    const commands: string[] = []
    const installedVisible = m.checkInstalledCommand(m.VISIBLE_REMOTE_LAYOUT)
    const { deps } = makeDeps({
      visibleRoot: true, initialToken: 'saved', probeResults: [false, true],
      runRemote: scripted({
        [m.REMOTE_LAYOUT_PROBE_COMMAND]: 'MOVABLE\n',
        [m.REMOTE_HOME_MOVE_COMMAND]: 'SPLIT\n',
        [installedVisible]: 'INSTALLED\n',
      }, commands),
    })
    await bootstrapRemoteServer(HOST, deps)
    expect(commands).toContain(m.buildRestartCommand(HOST.remotePort, false, m.VISIBLE_REMOTE_LAYOUT))
  })

  it('flag ON + move refused (KEPT): stays on the legacy layout', async () => {
    const m = await load()
    const commands: string[] = []
    const { deps } = makeDeps({
      visibleRoot: true, initialToken: 'saved', probeResults: [false, true],
      runRemote: scripted({
        [m.REMOTE_LAYOUT_PROBE_COMMAND]: 'MOVABLE\n',
        [m.REMOTE_HOME_MOVE_COMMAND]: 'KEPT\n',
        [CHECK_INSTALLED_COMMAND]: 'INSTALLED\n',
      }, commands),
    })
    await bootstrapRemoteServer(HOST, deps)
    expect(commands).toContain(buildRestartCommand(HOST.remotePort))
    expect(commands).toContain(buildWriteTokenCommand())
  })

  it('flag ON + foreign ~/rox: never moves or writes into it', async () => {
    const m = await load()
    const commands: string[] = []
    const { deps, rec } = makeDeps({
      visibleRoot: true, probeResults: [false, true],
      runRemote: scripted({ [m.REMOTE_LAYOUT_PROBE_COMMAND]: 'FOREIGN\n' }, commands),
    })
    await bootstrapRemoteServer(HOST, deps)
    expect(commands).not.toContain(m.REMOTE_HOME_MOVE_COMMAND)
    expect(commands).toContain('mkdir -p ~/.rox')
    expect(rec.uploads[0]!.remote.startsWith('~/.rox/')).toBe(true)
    const rest = commands.filter(c => c !== m.REMOTE_LAYOUT_PROBE_COMMAND && c !== m.VISIBLE_KILL_MANAGED_SERVER_COMMAND).join('\n')
    expect(rest).not.toMatch(/~\/rox\b/)
  })

  it('flag ON + legacy home without a managed install: keeps legacy (never an empty ~/rox)', async () => {
    const m = await load()
    const commands: string[] = []
    const { deps } = makeDeps({
      visibleRoot: true, probeResults: [false, true],
      runRemote: scripted({ [m.REMOTE_LAYOUT_PROBE_COMMAND]: 'LEGACY\n' }, commands),
    })
    await bootstrapRemoteServer(HOST, deps)
    expect(commands).toContain('mkdir -p ~/.rox')
    expect(commands.join('\n')).not.toContain('mkdir -p ~/rox')
  })

  it('flag ON + fresh host: installs into a private ~/rox', async () => {
    const m = await load()
    const commands: string[] = []
    const { deps, rec } = makeDeps({
      visibleRoot: true, probeResults: [false, true],
      runRemote: scripted({ [m.REMOTE_LAYOUT_PROBE_COMMAND]: 'FRESH\n' }, commands),
    })
    await bootstrapRemoteServer(HOST, deps)
    expect(commands).toContain('mkdir -p ~/rox && chmod 700 ~/rox')
    expect(rec.uploads[0]!.remote).toBe('~/rox/craft-server-1.0.0-darwin-arm64.tar.gz')
    expect(commands).toContain(m.buildStartCommand('~/rox/craft-server-1.0.0-darwin-arm64.tar.gz', HOST.remotePort, m.VISIBLE_REMOTE_LAYOUT))
    expect(commands.join('\n')).not.toContain('CRAFT_')
  })
})
