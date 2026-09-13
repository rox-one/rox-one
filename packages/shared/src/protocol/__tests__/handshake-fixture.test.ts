import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '../types.ts'
import {
  protocolMajor,
  protocolVersionRejectionMessage,
  protocolVersionsCompatible,
} from '../version-policy.ts'

const dir = dirname(fileURLToPath(import.meta.url))
const fixtures = join(dir, '../__fixtures__')

describe('native sidecar handshake fixtures', () => {
  it('handshake advertises protocol 1.0', () => {
    const handshake = JSON.parse(readFileSync(join(fixtures, 'handshake.json'), 'utf8')) as {
      id: string
      type: string
      protocolVersion: string
    }
    expect(handshake.type).toBe('handshake')
    expect(handshake.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(handshake.protocolVersion.split('.')[0]).toBe('1')
    expect(handshake.id.length).toBeGreaterThan(0)
  })

  it('handshake_ack lists native, index, run, and journal channels', () => {
    const ack = JSON.parse(readFileSync(join(fixtures, 'handshake-ack.json'), 'utf8')) as {
      type: string
      protocolVersion: string
      registeredChannels: string[]
    }
    expect(ack.type).toBe('handshake_ack')
    expect(ack.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(ack.registeredChannels).toContain('native:health')
    expect(ack.registeredChannels).toContain('index:reindex')
    expect(ack.registeredChannels).toContain('index:search')
    expect(ack.registeredChannels).toContain('run:create')
    expect(ack.registeredChannels).toContain('journal:write')
  })
})

describe('iOS handshake protocol version policy', () => {
  it('accepts the same major as PROTOCOL_VERSION', () => {
    expect(protocolMajor(PROTOCOL_VERSION)).toBe(1)
    expect(protocolVersionsCompatible(PROTOCOL_VERSION, '1.0')).toBe(true)
    expect(protocolVersionsCompatible(PROTOCOL_VERSION, '1.9')).toBe(true)
  })

  it('rejects a missing version or a different major (server 99.0)', () => {
    expect(protocolVersionsCompatible(PROTOCOL_VERSION, '')).toBe(false)
    expect(protocolVersionsCompatible(PROTOCOL_VERSION, '99.0')).toBe(false)
    expect(protocolMajor('v1.0')).toBeNull()
    expect(protocolVersionRejectionMessage('1.0', '99.0')).toContain('99.0')
  })
})
