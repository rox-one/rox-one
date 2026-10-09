import { describe, it, expect } from 'bun:test'
import { runQuitCleanupThenExit } from '../quit-exit-guard'

describe('runQuitCleanupThenExit', () => {
  it('always exits after a successful cleanup', async () => {
    const exits: number[] = []
    await runQuitCleanupThenExit(async () => {}, code => exits.push(code), () => {})
    expect(exits).toEqual([0])
  })

  it('still exits when cleanup rejects, after reporting the error', async () => {
    const exits: number[] = []
    const errors: unknown[] = []
    await runQuitCleanupThenExit(
      async () => { throw new Error('stopAll failed') },
      code => exits.push(code),
      error => errors.push(error),
    )
    expect(exits).toEqual([0])
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('stopAll failed')
  })

  it('awaits cleanup before exiting', async () => {
    const order: string[] = []
    await runQuitCleanupThenExit(
      async () => { await Promise.resolve(); order.push('cleanup') },
      () => order.push('exit'),
      () => {},
    )
    expect(order).toEqual(['cleanup', 'exit'])
  })
})