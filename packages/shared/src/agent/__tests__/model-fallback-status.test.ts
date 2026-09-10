import { describe, expect, it } from 'bun:test'
import { resolveModelFallbackStatus } from '../model-fallback-status.ts'

describe('resolveModelFallbackStatus', () => {
  it('reports switched only when the runtime recorded a model', () => {
    expect(resolveModelFallbackStatus({ switchedTo: 'gpt-5.6-sol' })).toEqual({
      kind: 'switched',
      model: 'gpt-5.6-sol',
    })
  })

  it('stays unverified when nothing was recorded', () => {
    expect(resolveModelFallbackStatus(undefined)).toEqual({ kind: 'unverified' })
    expect(resolveModelFallbackStatus({})).toEqual({ kind: 'unverified' })
    expect(resolveModelFallbackStatus({ switchedTo: '  ' })).toEqual({ kind: 'unverified' })
  })
})
