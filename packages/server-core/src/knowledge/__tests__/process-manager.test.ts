import { describe, expect, it } from 'bun:test'
import { parseOemKernelPin } from '@craft-agent/shared/knowledge/oem-pin'
import { SiyuanProcessManager } from '../process-manager'

const pin = parseOemKernelPin({
  version: '3.1.28-rox.1',
  sha256: {
    'darwin-arm64': 'a'.repeat(64),
    'darwin-x64': 'b'.repeat(64),
    'linux-x64': 'c'.repeat(64),
    'win32-x64': 'd'.repeat(64),
  },
  relativePayloadDir: 'resources/oem-kernel',
  minApi: '3.0.0',
  maxApiExclusive: '4.0.0',
})

describe('SiyuanProcessManager', () => {
  it('fails closed when G2 is not C', async () => {
    const pm = new SiyuanProcessManager()
    await expect(
      pm.start({
        configDir: '/tmp/cfg',
        connectionId: 'c1',
        g2AcceptedVariant: null,
        pin,
        resolveBinary: () => '/bin/true',
        spawnFn: () => {
          throw new Error('should not spawn')
        },
        allocatePort: () => 19200,
      }),
    ).rejects.toMatchObject({ code: 'G2_BLOCKED' })
    expect(pm.status().running).toBe(false)
  })

  it('spawns on ephemeral port with G2=C', async () => {
    const kids: Array<{ pid: number; killed?: string }> = []
    const pm = new SiyuanProcessManager()
    const inst = await pm.start({
      configDir: '/tmp/cfg',
      connectionId: 'c1',
      g2AcceptedVariant: 'C',
      pin,
      resolveBinary: () => '/fake/kernel',
      allocatePort: () => 19201,
      spawnFn: (cmd, args) => {
        expect(cmd).toBe('/fake/kernel')
        expect(args.some((a) => a.includes('19201'))).toBe(true)
        expect(args.some((a) => a.includes('6806'))).toBe(false)
        return {
          pid: 4242,
          unref() {},
          on() {},
          kill(sig?: string) {
            kids.push({ pid: 4242, killed: sig })
          },
        }
      },
    })
    expect(inst.port).toBe(19201)
    expect(inst.baseUrl).toBe('http://127.0.0.1:19201')
    expect(inst.workspacePath).toContain('knowledge-workspaces/c1')
    await pm.stop({ graceMs: 0 })
    expect(kids[0]?.killed).toBe('SIGTERM')
  })

  it('marks KERNEL_CRASHED after five exits', async () => {
    const pm = new SiyuanProcessManager()
    const exitCbs: Array<(code: number | null) => void> = []
    await pm.start({
      configDir: '/tmp/cfg',
      connectionId: 'c1',
      g2AcceptedVariant: 'C',
      pin,
      resolveBinary: () => '/fake/kernel',
      allocatePort: () => 19202,
      spawnFn: () => ({
        pid: 7,
        unref() {},
        on(_ev: 'exit', cb: (code: number | null) => void) {
          exitCbs.push(cb)
        },
        kill() {},
      }),
    })
    for (let i = 0; i < 5; i++) {
      const cb = exitCbs[exitCbs.length - 1]
      cb?.(1)
    }
    expect(pm.status().running).toBe(false)
    expect(pm.status().error).toBe('KERNEL_CRASHED')
  })
})
