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
      expect(node.width).toBeGreaterThanOrEqual(168)
    }
    expect(new Set(fitted.map((node) => node.x)).size).toBe(3)
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

  it('humanizes trigger event ids even when label matches the raw event', () => {
    expect(
      nodeDisplayLabel(
        { kind: 'trigger', label: 'LabelAdd', data: { event: 'LabelAdd' } },
        { trigger: 'When' },
      ),
    ).toBe('Label Added')
  })

  it('uses matcher pattern when label and name are missing', () => {
    expect(
      nodeDisplayLabel(
        { kind: 'matcher', data: { matcher: 'inbox|urgent' } },
        { matcher: 'matching' },
      ),
    ).toBe('inbox|urgent')
  })

  it('uses cron when matcher pattern is also missing', () => {
    expect(
      nodeDisplayLabel(
        { kind: 'matcher', data: { cron: '0 9 * * 1-5' } },
        { matcher: 'matching' },
      ),
    ).toBe('0 9 * * 1-5')
  })

  it('uses matcher name before pattern', () => {
    expect(
      nodeDisplayLabel(
        { kind: 'matcher', data: { name: 'Morning triage', matcher: 'inbox' } },
        { matcher: 'matching' },
      ),
    ).toBe('Morning triage')
  })

  it('compacts webhook method and url', () => {
    expect(
      nodeDisplayLabel(
        { kind: 'webhook', data: { method: 'post', url: 'https://hooks.example.com/catch/abc' } },
        { webhook: 'Webhook' },
      ),
    ).toBe('POST hooks.example.com/catch/abc')
  })
})
