import { describe, expect, it } from 'bun:test'
import { parseOemKernelPin, pinPlatformKey } from '../oem-pin'

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
