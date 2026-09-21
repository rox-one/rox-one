import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dir, '..')
const inspector = readFileSync(join(dir, 'ConationInspectorPanel.tsx'), 'utf8')
const fund = readFileSync(join(dir, 'ConationFundPanel.tsx'), 'utf8')
const board = readFileSync(join(dir, 'ConationBoardPanel.tsx'), 'utf8')

describe('conation surface chrome radius', () => {
  it('frames inspector/fund/board with RADIUS_INNER and header strip', () => {
    for (const src of [inspector, fund, board]) {
      expect(src).toContain('RADIUS_INNER')
      expect(src).toContain('borderRadius: RADIUS_INNER')
      expect(src).toContain('border border-border/50')
      expect(src).toContain('shadow-middle')
    }
    expect(inspector).toContain('data-testid="conation-inspector-placeholder"')
    expect(fund).toContain('data-conation-fund-open')
    expect(board).toContain('data-conation-board-open')
  })
})
