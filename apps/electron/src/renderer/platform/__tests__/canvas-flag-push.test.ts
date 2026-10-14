import { beforeEach, describe, expect, it } from 'bun:test'
import { __resetCanvasFlagPushForTests, pushCanvasFlagToMain } from '../unified-flags'

describe('pushCanvasFlagToMain (S5)', () => {
  const pushed: boolean[] = []
  beforeEach(() => {
    pushed.length = 0
    __resetCanvasFlagPushForTests()
    ;(globalThis as any).window = { electronAPI: { canvas: { setEnabled: async (on: boolean) => { pushed.push(on) } } } }
  })
  it('pushes true and false, deduped', () => {
    pushCanvasFlagToMain(true); pushCanvasFlagToMain(true); pushCanvasFlagToMain(false); pushCanvasFlagToMain(true)
    expect(pushed).toEqual([true, false, true])
  })
})
