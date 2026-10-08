import { describe, expect, it } from 'bun:test'
import { createLatestStateBuffer } from '../latest-state-buffer'

function pushSource<T>() {
  const listeners = new Set<(value: T) => void>()
  return {
    source: (callback: (value: T) => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
    push: (value: T) => listeners.forEach(listener => listener(value)),
    size: () => listeners.size,
  }
}

describe('createLatestStateBuffer', () => {
  it('subscribes immediately and replays a state pushed before the consumer mounts', () => {
    const src = pushSource<string>()
    const buffer = createLatestStateBuffer(src.source)
    expect(src.size()).toBe(1)
    src.push('did-finish-load state')
    const seen: string[] = []
    buffer.subscribe(value => seen.push(value))
    expect(seen).toEqual(['did-finish-load state'])
    src.push('next')
    expect(seen).toEqual(['did-finish-load state', 'next'])
  })

  it('replays only the latest value and nothing when nothing was pushed', () => {
    const src = pushSource<number>()
    const buffer = createLatestStateBuffer(src.source)
    const early: number[] = []
    buffer.subscribe(value => early.push(value))
    expect(early).toEqual([])
    src.push(1); src.push(2)
    const late: number[] = []
    buffer.subscribe(value => late.push(value))
    expect(late).toEqual([2])
    expect(buffer.latest()).toBe(2)
  })

  it('replays a pushed null and stops forwarding after unsubscribe/dispose', () => {
    const src = pushSource<string | null>()
    const buffer = createLatestStateBuffer(src.source)
    src.push(null)
    const seen: (string | null)[] = []
    const unsubscribe = buffer.subscribe(value => seen.push(value))
    expect(seen).toEqual([null])
    unsubscribe(); src.push('ignored')
    expect(seen).toEqual([null])
    buffer.dispose()
    expect(src.size()).toBe(0)
  })

  it('tolerates a missing source (no preload bridge)', () => {
    const buffer = createLatestStateBuffer<string>(undefined)
    const seen: string[] = []
    buffer.subscribe(value => seen.push(value))
    expect(seen).toEqual([])
    buffer.dispose()
  })
})
