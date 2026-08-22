import { describe, expect, it } from 'bun:test'
import { isAllowedServerEndpoint } from '../server-endpoint-policy.ts'

describe('isAllowedServerEndpoint (RX-SEC-0006)', () => {
  it('allows loopback over cleartext schemes', () => {
    expect(isAllowedServerEndpoint('http://127.0.0.1:9100').ok).toBe(true)
    expect(isAllowedServerEndpoint('ws://localhost:9100').ok).toBe(true)
    expect(isAllowedServerEndpoint('http://[::1]:9100').ok).toBe(true)
  })

  it('allows any host over TLS schemes', () => {
    expect(isAllowedServerEndpoint('https://api.example.com').ok).toBe(true)
    expect(isAllowedServerEndpoint('wss://remote.server.dev:9443').ok).toBe(true)
  })

  it('denies cleartext to non-loopback hosts', () => {
    const lan = isAllowedServerEndpoint('ws://192.168.1.10:9100')
    expect(lan.ok).toBe(false)
    expect(lan.reason).toContain('loopback')

    const corp = isAllowedServerEndpoint('http://intranet.corp.internal')
    expect(corp.ok).toBe(false)
  })

  it('denies unsupported and malformed inputs', () => {
    expect(isAllowedServerEndpoint('ftp://example.com').ok).toBe(false)
    expect(isAllowedServerEndpoint('javascript:alert(1)').ok).toBe(false)
    expect(isAllowedServerEndpoint('not-a-url').ok).toBe(false)
    expect(isAllowedServerEndpoint('').ok).toBe(false)
  })
})
