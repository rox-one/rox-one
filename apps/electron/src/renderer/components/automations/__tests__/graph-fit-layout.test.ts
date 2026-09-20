import { describe, expect, it } from 'bun:test'
import { fitGraphLayout, nodeDisplayLabel } from '../graph-fit-layout'

describe('fitGraphLayout', () => {
  it('fits three original columns into a 300px viewport', () => {
    const fitted = fitGraphLayout(
      [
        { id: 'a', position: { x: 0, y: 0 } },
        { id: 'b', position: { x: 260, y: 0 } },
        { id: 'c', position: { x: 520, y: 0 } },
      ],
      300,
    )

    expect(fitted).toHaveLength(3)
    for (const node of fitted) {
      expect(node.x + node.width).toBeLessThanOrEqual(300)
    }
  })

  it('keeps distinct original rows on separate fitted rows', () => {
    const fitted = fitGraphLayout(
      [
        { id: 'a', position: { x: 0, y: 0 } },
        { id: 'b', position: { x: 0, y: 160 } },
      ],
      300,
    )

    expect(new Set(fitted.map((node) => node.y)).size).toBe(2)
    expect(fitted[0]!.y).toBeLessThan(fitted[1]!.y)
  })

  it('returns [] for empty input', () => {
    expect(fitGraphLayout([], 300)).toEqual([])
  })
})

describe('nodeDisplayLabel', () => {
  it('uses prompt data.prompt when label is missing', () => {
    expect(
      nodeDisplayLabel(
        { kind: 'prompt', data: { prompt: 'Summarize the inbox' } },
        { prompt: 'Prompt' },
      ),
    ).toBe('Summarize the inbox')
  })
})
