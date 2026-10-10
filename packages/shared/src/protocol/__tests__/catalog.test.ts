import { describe, expect, it } from 'bun:test'
import { getAllChannelValues, RPC_CHANNELS } from '../channels'
import {
  BROADCAST_EVENT_CHANNELS,
  buildProtocolCatalog,
  buildProtocolFeatures,
  buildProtocolPolicy,
  flattenChannelCatalog,
  flattenEventCatalog,
  PROTOCOL_MAX_PAYLOAD_BYTES,
} from '../catalog'

describe('flattenChannelCatalog', () => {
  const catalog = flattenChannelCatalog()

  it('lists every RPC_CHANNELS value exactly once', () => {
    const values = getAllChannelValues()
    expect(catalog).toHaveLength(values.length)
    expect(catalog.map((entry) => entry.channel)).toEqual(values)
    expect(new Set(catalog.map((entry) => entry.channel)).size).toBe(values.length)
  })

  it('tags every entry as an rpc with a routing classification', () => {
    for (const entry of catalog) {
      expect(entry.direction).toBe('rpc')
      expect(entry.routing).not.toBe('unclassified')
    }
  })

  it('never emits a channel twice across namespaces', () => {
    const counts = new Map<string, number>()
    for (const { channel } of catalog) counts.set(channel, (counts.get(channel) ?? 0) + 1)
    const duplicated = [...counts].filter(([, n]) => n > 1).map(([channel]) => channel)
    expect(duplicated).toEqual([])
  })
})

describe('flattenEventCatalog', () => {
  it('matches the BroadcastEventMap runtime mirror and tags each as an event', () => {
    const events = flattenEventCatalog()
    expect(events.map((entry) => entry.channel)).toEqual([...BROADCAST_EVENT_CHANNELS])
    for (const entry of events) {
      expect(entry.direction).toBe('event')
      expect(entry.routing).not.toBe('unclassified')
    }
  })

  it('every event channel is a known RPC_CHANNELS value', () => {
    const values = new Set(getAllChannelValues())
    for (const channel of BROADCAST_EVENT_CHANNELS) {
      expect(values.has(channel)).toBe(true)
    }
  })
})

describe('buildProtocolCatalog', () => {
  it('returns methods, events, capabilities, and policy', () => {
    const catalog = buildProtocolCatalog()
    expect(catalog.methods.length).toBeGreaterThan(0)
    expect(catalog.events.length).toBeGreaterThan(0)
    expect(catalog.capabilities.length).toBeGreaterThan(0)
    expect(catalog.policy.maxPayloadBytes).toBe(PROTOCOL_MAX_PAYLOAD_BYTES)
    expect(catalog.policy.maxPayloadBytes).toBeGreaterThan(0)
  })

  it('is byte-stable across two independent runs', () => {
    const first = JSON.stringify(buildProtocolCatalog())
    const second = JSON.stringify(buildProtocolCatalog())
    expect(first).toBe(second)
  })

  it('advertises channel names as strings in the wire feature block', () => {
    const features = buildProtocolFeatures()
    expect(features.methods).toEqual(flattenChannelCatalog().map((entry) => entry.channel))
    expect(features.events).toEqual([...BROADCAST_EVENT_CHANNELS])
    expect(features.methods).toContain(RPC_CHANNELS.sessions.GET)
  })

  it('advertises the frozen payload policy', () => {
    expect(buildProtocolPolicy()).toEqual({ maxPayloadBytes: PROTOCOL_MAX_PAYLOAD_BYTES })
  })
})