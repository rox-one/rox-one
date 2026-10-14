import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RoversError } from '../../errors.ts'
import { ROVERS_LABEL_RUN, ROVERS_LABEL_SERVICE } from '../../types.ts'
import {
  assertRoversEndpointPinned,
  authorizeRoversAction,
  isRoversToolName,
  pinRoversDockerEndpoint,
  requiresConfirmation,
  ROVERS_TOOL_ACCESS,
  roversToolAccess,
  toolAllowsAction,
} from '../gate.ts'

/* ─────────────────────────────── fixtures ─────────────────────────────── */

const READ_TOOLS = ['rovers_list', 'rovers_status', 'rovers_logs', 'rovers_monitor'] as const
const WRITE_TOOLS = [
  'rovers_deploy',
  'rovers_stop',
  'rovers_backup',
  'rovers_init_backup',
  'rovers_backup_scope',
  'rovers_schedule',
  'rovers_offsite_sync',
] as const
const DESTRUCTIVE_TOOLS = ['rovers_restore'] as const

/** A correctly Rox-labelled target (both ownership labels, non-empty). */
const ROX_LABELS: Record<string, string> = {
  [ROVERS_LABEL_SERVICE]: 'qdrant',
  [ROVERS_LABEL_RUN]: 'run-1',
}

const tmpDirs: string[] = []
const servers: Server[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-rovers-gate-'))
  tmpDirs.push(dir)
  return dir
}

/** Bind a REAL Unix socket file (exercises `lstat`/`stat`/`{dev, ino}` for real). */
function listenSocket(path: string): Promise<Server> {
  return new Promise<Server>((resolveServer, rejectServer) => {
    const server = createServer()
    server.once('error', rejectServer)
    server.listen(path, () => {
      servers.push(server)
      resolveServer(server)
    })
  })
}

async function closeServer(server: Server): Promise<void> {
  const index = servers.indexOf(server)
  if (index >= 0) servers.splice(index, 1)
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
}

/** Run a gate call expected to refuse and return the typed code. */
function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof RoversError) return error.code
    throw error
  }
  throw new Error('ожидался типизированный отказ RoversError, но вызов завершился успешно')
}

/* ──────────────────────────── permission classes ──────────────────────── */

describe('ROVERS_TOOL_ACCESS', () => {
  it('publishes exactly the 12 tools with the ratified access classes', () => {
    expect(Object.keys(ROVERS_TOOL_ACCESS).sort()).toEqual(
      [...READ_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].sort(),
    )
    expect(Object.isFrozen(ROVERS_TOOL_ACCESS)).toBe(true)
    for (const tool of READ_TOOLS) expect(roversToolAccess(tool)?.access).toBe('read')
    for (const tool of WRITE_TOOLS) expect(roversToolAccess(tool)?.access).toBe('write')
    for (const tool of DESTRUCTIVE_TOOLS) expect(roversToolAccess(tool)?.access).toBe('destructive')
  })

  it('requires confirmation for every mutating tool and for none of the read tools', () => {
    for (const [tool, entry] of Object.entries(ROVERS_TOOL_ACCESS)) {
      expect(requiresConfirmation(tool)).toBe(entry.access !== 'read')
    }
    for (const tool of READ_TOOLS) expect(requiresConfirmation(tool)).toBe(false)
    for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(requiresConfirmation(tool)).toBe(true)
  })

  it('refuses to default an unknown tool', () => {
    expect(isRoversToolName('rovers_deploy')).toBe(true)
    expect(isRoversToolName('rovers_nuke')).toBe(false)
    expect(isRoversToolName('')).toBe(false)
    expect(roversToolAccess('rovers_nuke')).toBeUndefined()
    expect(requiresConfirmation('rovers_nuke')).toBe(true)
    expect(toolAllowsAction('rovers_nuke', 'read')).toBe(false)
  })

  it('lets a tool run actions at or below its class, never above', () => {
    expect(toolAllowsAction('rovers_logs', 'read')).toBe(true)
    expect(toolAllowsAction('rovers_logs', 'write')).toBe(false)
    expect(toolAllowsAction('rovers_deploy', 'write')).toBe(true)
    expect(toolAllowsAction('rovers_deploy', 'destructive')).toBe(false)
    expect(toolAllowsAction('rovers_restore', 'destructive')).toBe(true)
  })

  it('ranks create equal to write: write-class tools may create, read tools may not', () => {
    expect(toolAllowsAction('rovers_deploy', 'create')).toBe(true)
    expect(toolAllowsAction('rovers_restore', 'create')).toBe(true)
    expect(toolAllowsAction('rovers_logs', 'create')).toBe(false)
    expect(toolAllowsAction('rovers_list', 'create')).toBe(false)
  })
})

/* ──────────────────────────────── the gate ───────────────────────────── */

describe('authorizeRoversAction — tool table', () => {
  it('refuses an unpublished tool', () => {
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_nuke', action: 'read', labels: ROX_LABELS }))).toBe(
      'socket_denied',
    )
    expect(codeOf(() => authorizeRoversAction({ tool: 'docker', action: 'read', runId: 'run-1' }))).toBe(
      'socket_denied',
    )
  })

  it('refuses a read tool asked to mutate, and a write tool asked to destroy', () => {
    expect(
      codeOf(() =>
        authorizeRoversAction({ tool: 'rovers_logs', action: 'write', labels: ROX_LABELS, confirmed: true }),
      ),
    ).toBe('socket_denied')
    expect(
      codeOf(() =>
        authorizeRoversAction({ tool: 'rovers_stop', action: 'destructive', labels: ROX_LABELS, confirmed: true }),
      ),
    ).toBe('socket_denied')
  })
})

describe('authorizeRoversAction — confirmation', () => {
  it('refuses every mutating tool without confirmation', () => {
    for (const tool of WRITE_TOOLS) {
      expect(codeOf(() => authorizeRoversAction({ tool, action: 'write', labels: ROX_LABELS, confirmed: false }))).toBe(
        'socket_denied',
      )
    }
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(
        codeOf(() => authorizeRoversAction({ tool, action: 'destructive', labels: ROX_LABELS, confirmed: false })),
      ).toBe('socket_denied')
    }
  })

  it('allows a confirmed mutating action on a Rox container', () => {
    const allowance = authorizeRoversAction({ tool: 'rovers_stop', action: 'write', labels: ROX_LABELS, confirmed: true })
    expect(allowance).toEqual({
      tool: 'rovers_stop',
      access: 'write',
      action: 'write',
      serviceId: 'qdrant',
      runId: 'run-1',
      confirmed: true,
    })
  })

  it('refuses a mutating action that is not container-scoped', () => {
    expect(
      codeOf(() => authorizeRoversAction({ tool: 'rovers_stop', action: 'write', runId: 'run-1', confirmed: true })),
    ).toBe('socket_denied')
  })
})

describe('authorizeRoversAction — container creation', () => {
  it('allows a confirmed create with no labels and reports empty ownership', () => {
    const allowance = authorizeRoversAction({ tool: 'rovers_deploy', action: 'create', confirmed: true })
    expect(allowance).toEqual({
      tool: 'rovers_deploy',
      access: 'write',
      action: 'create',
      serviceId: '',
      runId: '',
      confirmed: true,
    })
  })

  it('still requires confirmation for a create', () => {
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_deploy', action: 'create' }))).toBe('socket_denied')
    expect(
      codeOf(() => authorizeRoversAction({ tool: 'rovers_deploy', action: 'create', confirmed: false })),
    ).toBe('socket_denied')
  })

  it('refuses a read tool asked to create', () => {
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_logs', action: 'create', confirmed: true }))).toBe(
      'socket_denied',
    )
  })

  it('refuses a write action without labels — create is the only label-exempt action', () => {
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_stop', action: 'write', confirmed: true }))).toBe(
      'socket_denied',
    )
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_stop', action: 'write' }))).toBe('socket_denied')
  })
})

describe('authorizeRoversAction — label ownership', () => {
  it('refuses a foreign container even for an authorized tool', () => {
    const foreign = { 'com.example.owner': 'other-tenant', 'com.example.role': 'worker' }
    expect(
      codeOf(() => authorizeRoversAction({ tool: 'rovers_stop', action: 'write', labels: foreign, confirmed: true })),
    ).toBe('socket_denied')
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_logs', action: 'read', labels: foreign }))).toBe(
      'socket_denied',
    )
  })

  it('refuses a container carrying only one of the two labels', () => {
    expect(
      codeOf(() => authorizeRoversAction({ tool: 'rovers_logs', action: 'read', labels: { [ROVERS_LABEL_SERVICE]: 'qdrant' } })),
    ).toBe('socket_denied')
    expect(
      codeOf(() => authorizeRoversAction({ tool: 'rovers_logs', action: 'read', labels: { [ROVERS_LABEL_RUN]: 'run-1' } })),
    ).toBe('socket_denied')
    const blankService = { [ROVERS_LABEL_SERVICE]: '', [ROVERS_LABEL_RUN]: 'run-1' }
    expect(
      codeOf(() => authorizeRoversAction({ tool: 'rovers_stop', action: 'write', labels: blankService, confirmed: true })),
    ).toBe('socket_denied')
  })

  it('allows a correctly labelled Rox container for read and write tools', () => {
    const read = authorizeRoversAction({ tool: 'rovers_logs', action: 'read', labels: ROX_LABELS })
    expect(read.serviceId).toBe('qdrant')
    expect(read.runId).toBe('run-1')
    expect(read.confirmed).toBe(false)

    const write = authorizeRoversAction({ tool: 'rovers_deploy', action: 'write', labels: ROX_LABELS, confirmed: true })
    expect(write.runId).toBe('run-1')
    expect(write.confirmed).toBe(true)

    const destroy = authorizeRoversAction({
      tool: 'rovers_restore',
      action: 'destructive',
      labels: ROX_LABELS,
      confirmed: true,
    })
    expect(destroy.access).toBe('destructive')
  })

  it('allows a run-scoped aggregate read and refuses one without a run id', () => {
    expect(authorizeRoversAction({ tool: 'rovers_list', action: 'read', runId: 'run-1' }).runId).toBe('run-1')
    expect(authorizeRoversAction({ tool: 'rovers_monitor', action: 'read', runId: 'run-1' }).serviceId).toBe('')
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_list', action: 'read' }))).toBe('socket_denied')
    expect(codeOf(() => authorizeRoversAction({ tool: 'rovers_list', action: 'read', runId: '   ' }))).toBe(
      'socket_denied',
    )
  })
})

/* ──────────────────────────────── pinning ─────────────────────────────── */

describe('pinRoversDockerEndpoint / assertRoversEndpointPinned', () => {
  it('pins a real Unix socket with its device and inode', async () => {
    const dir = makeTmpDir()
    const socketPath = join(dir, 'engine.sock')
    await listenSocket(socketPath)

    const endpoint = pinRoversDockerEndpoint(`unix://${socketPath}`)
    const stats = statSync(socketPath)
    expect(endpoint.socket).toBe(socketPath)
    expect(endpoint.uri).toBe(`unix://${socketPath}`)
    expect(endpoint.device).toBe(stats.dev)
    expect(endpoint.inode).toBe(stats.ino)

    // Re-assert is stable while the same socket file stays in place.
    expect(() => assertRoversEndpointPinned(endpoint)).not.toThrow()
  })

  it('resolves a symlinked socket path to its real file', async () => {
    const dir = makeTmpDir()
    const realPath = join(dir, 'real.sock')
    await listenSocket(realPath)
    const linkPath = join(dir, 'link.sock')
    symlinkSync(realPath, linkPath)

    const endpoint = pinRoversDockerEndpoint(`unix://${linkPath}`)
    expect(endpoint.socket).toBe(realPath)
    expect(endpoint.device).toBe(statSync(realPath).dev)
    expect(() => assertRoversEndpointPinned(endpoint)).not.toThrow()
  })

  it('rejects anything that is not a unix:// socket', () => {
    for (const uri of ['tcp://127.0.0.1:2375', 'http://127.0.0.1/var/run/docker.sock', '/var/run/docker.sock', 'unix://', 'unix://relative.sock']) {
      expect(codeOf(() => pinRoversDockerEndpoint(uri))).toBe('socket_denied')
    }
  })

  it('rejects a path that exists but is not a socket, and a missing socket', () => {
    const dir = makeTmpDir()
    const filePath = join(dir, 'not-a-socket')
    writeFileSync(filePath, 'plain file')
    expect(codeOf(() => pinRoversDockerEndpoint(`unix://${filePath}`))).toBe('socket_denied')
    expect(codeOf(() => pinRoversDockerEndpoint(`unix://${join(dir, 'absent.sock')}`))).toBe('socket_denied')
  })

  it('refuses re-assertion when the pinned inode no longer matches', async () => {
    const dir = makeTmpDir()
    const socketPath = join(dir, 'engine.sock')
    await listenSocket(socketPath)

    const endpoint = pinRoversDockerEndpoint(`unix://${socketPath}`)
    expect(codeOf(() => assertRoversEndpointPinned({ ...endpoint, inode: endpoint.inode + 1 }))).toBe('socket_denied')
    expect(codeOf(() => assertRoversEndpointPinned({ ...endpoint, device: endpoint.device + 1 }))).toBe('socket_denied')
  })

  it('refuses re-assertion after the socket file is replaced (socket swap)', async () => {
    const dir = makeTmpDir()
    const socketPath = join(dir, 'engine.sock')
    const first = await listenSocket(socketPath)
    const endpoint = pinRoversDockerEndpoint(`unix://${socketPath}`)

    await closeServer(first)
    rmSync(socketPath, { force: true })
    await listenSocket(socketPath)

    expect(statSync(socketPath).ino).not.toBe(endpoint.inode)
    expect(codeOf(() => assertRoversEndpointPinned(endpoint))).toBe('socket_denied')
  })

  it('refuses re-assertion when the pinned path now resolves through a new symlink', async () => {
    const dir = makeTmpDir()
    const socketPath = join(dir, 'engine.sock')
    await listenSocket(socketPath)

    const endpoint = pinRoversDockerEndpoint(`unix://${socketPath}`)
    // Point the pinned path at a different file: resolution now diverges.
    rmSync(socketPath, { force: true })
    const otherPath = join(dir, 'other.sock')
    await listenSocket(otherPath)
    symlinkSync(otherPath, socketPath)

    expect(codeOf(() => assertRoversEndpointPinned(endpoint))).toBe('socket_denied')
  })
})
