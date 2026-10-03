import { describe, expect, it } from 'bun:test'
import { diagnosticConnection, diagnosticEndpoint, networkRates } from './diagnostics-model'
import type { DeviceDiagnosticSnapshot } from '../../../../shared/device-diagnostics'

function network(sampledAt: number, receivedBytes: number, sentBytes: number): DeviceDiagnosticSnapshot {
  return { kind: 'network', platform: 'linux', sampledAt, result: { status: 'available', data: { interfaces: [
    { name: 'eth0', receivedBytes, sentBytes, internal: false },
    { name: 'lo', receivedBytes: 999999, sentBytes: 999999, internal: true },
  ] } } }
}

describe('diagnostic display projections', () => {
  it('drops userinfo, paths, query strings, fragments and raw error payloads', () => {
    const projected = diagnosticConnection({
      mode: 'remote', status: 'failed', url: 'wss://user:secret@example.com:9443/token/path?token=secret#secret',
      attempt: 2, updatedAt: 1, lastError: { kind: 'auth', message: 'secret value', code: 'SECRET' },
    })
    expect(projected).toEqual({ mode: 'remote', status: 'failed', endpoint: 'wss://example.com:9443', attempt: 2, errorKind: 'auth', closeCode: null })
    expect(diagnosticEndpoint('file:///private/secret')).toBeNull()
    expect(diagnosticEndpoint('not a url')).toBeNull()
  })

  it('derives network rates only from two compatible samples and excludes loopback', () => {
    expect(networkRates(network(6000, 5000, 12000), network(1000, 1000, 2000))).toEqual({ receivedBytesPerSecond: 800, sentBytesPerSecond: 2000 })
    expect(networkRates(network(6000, 5000, 12000), null)).toBeNull()
    expect(networkRates(network(1000, 5000, 12000), network(1000, 1000, 2000))).toBeNull()
    expect(networkRates(network(6000, 100, 200), network(1000, 1000, 2000))).toBeNull()
  })
})
