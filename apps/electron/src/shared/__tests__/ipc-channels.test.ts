import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RPC_CHANNELS, type BroadcastEventMap } from '../types'
import { EXPECTED_CHANNELS, EXPECTED_CHANNEL_COUNT } from './ipc-channels.generated'
import { collectIpcInventory, renderIpcInventory } from '../../../../../scripts/ipc-inventory'

function flattenValues(obj: Record<string, unknown>): string[] {
  return Object.values(obj).flatMap(v =>
    typeof v === 'string' ? [v]
      : typeof v === 'object' && v !== null ? flattenValues(v as Record<string, unknown>)
      : []
  )
}

const EXPECTED_COUNT = EXPECTED_CHANNEL_COUNT
const GENERATED_FILE = join(dirname(fileURLToPath(import.meta.url)), 'ipc-channels.generated.ts')

describe('RPC_CHANNELS wire-format stability', () => {
  it(`contains exactly ${EXPECTED_COUNT} channel strings`, () => {
    const actual = flattenValues(RPC_CHANNELS)
    expect(actual.length).toBe(EXPECTED_COUNT)
  })

  it('preserves exact wire-format strings (sorted equality)', () => {
    const actual = flattenValues(RPC_CHANNELS).sort()
    expect(actual).toEqual(EXPECTED_CHANNELS)
  })

  it('has no duplicate wire-format strings', () => {
    const values = flattenValues(RPC_CHANNELS)
    const unique = new Set(values)
    expect(values.length).toBe(unique.size)
  })
})

describe('RPC_CHANNELS inventory is generated, not hand-maintained', () => {
  it('committed artifact is byte-identical to a fresh generator run', () => {
    expect(readFileSync(GENERATED_FILE, 'utf8')).toBe(renderIpcInventory(collectIpcInventory()))
  })

  it('committed snapshot matches a fresh generator run', () => {
    expect(EXPECTED_CHANNELS).toEqual(collectIpcInventory())
  })
})

// ── BroadcastEventMap payload shape assertions ──────────────────────────
// These compile-time checks prevent the emitter/listener payload mismatch
// that caused sources:changed to silently send undefined after OAuth flows.
type AssertTuple<T extends readonly unknown[], N extends number> =
  T['length'] extends N ? true : false

describe('BroadcastEventMap payload shapes', () => {
  it('sources:changed carries (workspaceId, sources)', () => {
    type Payload = BroadcastEventMap[typeof RPC_CHANNELS.sources.CHANGED]
    const _check: AssertTuple<Payload, 2> = true
    expect(_check).toBe(true)
  })

  it('sources:indexChanged carries (workspaceId, payload)', () => {
    type Payload = BroadcastEventMap[typeof RPC_CHANNELS.sources.INDEX_CHANGED]
    const _check: AssertTuple<Payload, 2> = true
    expect(_check).toBe(true)
  })

  it('skills:changed carries (workspaceId, skills)', () => {
    type Payload = BroadcastEventMap[typeof RPC_CHANNELS.skills.CHANGED]
    const _check: AssertTuple<Payload, 2> = true
    expect(_check).toBe(true)
  })

  it('contextDocs:CHANGED carries no payload', () => {
    type Payload = BroadcastEventMap[typeof RPC_CHANNELS.contextDocs.CHANGED]
    const _check: AssertTuple<Payload, 0> = true
    expect(_check).toBe(true)
  })

  it('entities:linksChanged carries (workspaceId)', () => {
    type Payload = BroadcastEventMap[typeof RPC_CHANNELS.entities.LINKS_CHANGED]
    const _check: AssertTuple<Payload, 1> = true
    expect(_check).toBe(true)
  })
})