import { describe, expect, it } from 'bun:test'
import { dirname, join } from 'node:path'
import { parseOemKernelPin, pinPlatformKey, resolveOemManagedLayout } from '../oem-pin'

const PIN_BODY = {
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
}

function pinJson(overrides: Partial<typeof PIN_BODY> = {}): string {
  return JSON.stringify({ ...PIN_BODY, ...overrides })
}

function fsStub(files: Record<string, string | true>) {
  const existsSync = (p: string) => Object.prototype.hasOwnProperty.call(files, p)
  const readFileSync = (p: string) => {
    const v = files[p]
    if (typeof v === 'string') return v
    throw new Error(`not a file: ${p}`)
  }
  return { existsSync, readFileSync }
}

describe('parseOemKernelPin', () => {
  it('accepts a complete pin', () => {
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
    expect(pin.version).toBe('3.1.28-rox.1')
    expect(pinPlatformKey('darwin', 'arm64')).toBe('darwin-arm64')
  })

  it('rejects missing sha256 platform', () => {
    expect(() =>
      parseOemKernelPin({
        version: '1',
        sha256: {},
        relativePayloadDir: 'x',
        minApi: '3',
        maxApiExclusive: '4',
      }),
    ).toThrow(/sha256/)
  })
})

describe('resolveOemManagedLayout', () => {
  it('prefers env overrides when those files exist', () => {
    const pinPath = '/override/oem-kernel-pin.json'
    const kernelBinary = '/override/bin/knowledge-engine'
    const g2RecordPath = '/override/g2-decision-record.md'
    const { existsSync, readFileSync } = fsStub({
      [pinPath]: pinJson(),
      [kernelBinary]: true,
      [g2RecordPath]: true,
      '/repo/apps/electron/resources/oem-kernel-pin.json': pinJson({ version: 'should-not-win' }),
    })

    const layout = resolveOemManagedLayout({
      env: {
        G2_RECORD_PATH: g2RecordPath,
        OEM_PIN_PATH: pinPath,
        OEM_KERNEL_BINARY: kernelBinary,
      },
      cwd: '/repo/packages/server-core',
      existsSync,
      readFileSync,
    })

    expect(layout.pinPath).toBe(pinPath)
    expect(layout.kernelBinary).toBe(kernelBinary)
    expect(layout.g2RecordPath).toBe(g2RecordPath)
  })

  it('ignores env overrides when the files are missing', () => {
    const walkedPin = join('/repo', 'apps', 'electron', 'resources', 'oem-kernel-pin.json')
    const walkedG2 = join('/repo', 'docs', 'specs', '2026-08-07-siyuan-integration', 'g2-decision-record.md')
    const walkedBin = join('/repo', 'resources', 'oem-kernel', 'knowledge-engine')
    const { existsSync, readFileSync } = fsStub({
      [walkedPin]: pinJson(),
      [walkedG2]: true,
      [walkedBin]: true,
    })

    const layout = resolveOemManagedLayout({
      env: {
        G2_RECORD_PATH: '/missing/g2.md',
        OEM_PIN_PATH: '/missing/pin.json',
        OEM_KERNEL_BINARY: '/missing/bin',
      },
      cwd: '/repo/packages/server-core',
      platform: 'linux',
      arch: 'x64',
      existsSync,
      readFileSync,
    })

    expect(layout.pinPath).toBe(walkedPin)
    expect(layout.g2RecordPath).toBe(walkedG2)
    expect(layout.kernelBinary).toBe(walkedBin)
  })

  it('walks up at most 8 parents for the pin file', () => {
    const pinPath = join('/repo', 'apps', 'electron', 'resources', 'oem-kernel-pin.json')
    const { existsSync, readFileSync } = fsStub({
      [pinPath]: pinJson(),
    })

    const near = resolveOemManagedLayout({
      env: {},
      cwd: '/repo/packages/server-core/src/knowledge',
      existsSync,
      readFileSync,
    })
    expect(near.pinPath).toBe(pinPath)

    const missed = resolveOemManagedLayout({
      env: {},
      cwd: '/repo/a/b/c/d/e/f/g/h/i/j',
      existsSync,
      readFileSync,
    })
    expect(missed.pinPath).toBeNull()

    const atEighthParent = resolveOemManagedLayout({
      env: {},
      cwd: '/repo/1/2/3/4/5/6/7/8',
      existsSync,
      readFileSync,
    })
    expect(atEighthParent.pinPath).toBe(pinPath)
  })

  it('walks g2-decision-record.md relatives from cwd', () => {
    const g2 = join('/repo', 'g2-decision-record.md')
    const { existsSync, readFileSync } = fsStub({
      [g2]: true,
    })
    const layout = resolveOemManagedLayout({
      env: {},
      cwd: '/repo/packages/server-core',
      existsSync,
      readFileSync,
    })
    expect(layout.g2RecordPath).toBe(g2)
  })

  it('resolves kernel under relativePayloadDir and SiYuan-Kernel names', () => {
    const pinPath = join('/pack', 'oem-kernel-pin.json')
    const binaryPath = join('/pack', 'resources', 'oem-kernel', 'SiYuan-Kernel')
    const { existsSync, readFileSync } = fsStub({
      [pinPath]: pinJson(),
      [binaryPath]: true,
    })

    const layout = resolveOemManagedLayout({
      env: {},
      cwd: '/pack',
      platform: 'linux',
      arch: 'x64',
      existsSync,
      readFileSync,
    })

    expect(layout.pinPath).toBe(pinPath)
    expect(layout.kernelBinary).toBe(binaryPath)
  })

  it('resolves payloadDir/platformKey/knowledge-engine', () => {
    const pinPath = join('/repo', 'oem-kernel-pin.json')
    const payloadDir = '/custom/payload'
    const binaryPath = join(payloadDir, 'darwin-arm64', 'knowledge-engine')
    const { existsSync, readFileSync } = fsStub({
      [pinPath]: pinJson(),
      [binaryPath]: true,
    })

    const layout = resolveOemManagedLayout({
      env: { OEM_KERNEL_PAYLOAD_DIR: payloadDir },
      cwd: '/repo',
      platform: 'darwin',
      arch: 'arm64',
      existsSync,
      readFileSync,
    })

    expect(layout.kernelBinary).toBe(binaryPath)
  })

  it('defaults payload dir to /tmp/oem-kernel-payload', () => {
    const binaryPath = join('/tmp/oem-kernel-payload', 'linux-x64', 'knowledge-engine')
    const { existsSync, readFileSync } = fsStub({
      [binaryPath]: true,
    })
    const layout = resolveOemManagedLayout({
      env: {},
      cwd: '/unrelated',
      platform: 'linux',
      arch: 'x64',
      existsSync,
      readFileSync,
    })
    expect(layout.kernelBinary).toBe(binaryPath)
  })

  it('never throws on missing files, bad JSON, or existsSync errors', () => {
    expect(() =>
      resolveOemManagedLayout({
        env: { OEM_PIN_PATH: '/nope.json' },
        cwd: '/',
        existsSync: () => {
          throw new Error('fs boom')
        },
        readFileSync: () => {
          throw new Error('read boom')
        },
      }),
    ).not.toThrow()

    const { existsSync, readFileSync } = fsStub({
      '/bad/oem-kernel-pin.json': '{not-json',
    })
    const layout = resolveOemManagedLayout({
      env: { OEM_PIN_PATH: '/bad/oem-kernel-pin.json' },
      cwd: dirname('/bad/oem-kernel-pin.json'),
      existsSync,
      readFileSync,
    })
    expect(layout.pinPath).toBe('/bad/oem-kernel-pin.json')
    expect(layout.kernelBinary).toBeNull()
  })
})
