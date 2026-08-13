import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROTOCOL_VERSION } from '../types.ts'

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

  it('handshake_ack lists native, index, and run channels', () => {
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
  })
})
