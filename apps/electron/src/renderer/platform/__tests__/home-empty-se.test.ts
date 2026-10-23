import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const front = readFileSync(join(import.meta.dir, '../HomeFrontPage.tsx'), 'utf8')
const widgets = readFileSync(join(import.meta.dir, '../home/widgets.tsx'), 'utf8')

describe('Home empty (P5.5)', () => {
  it('empty layout uses EntityListEmptyScreen', () => {
    expect(front).toContain('EntityListEmptyScreen')
    expect(front).toContain('workbench.home.emptyLayout')
    expect(front).toContain('data-home-empty-layout')
    expect(front).not.toMatch(/emptyLayout[\s\S]{0,80}font-bold text-foreground/)
  })

  it('today/top3 empties use WidgetEmpty', () => {
    expect(widgets).toMatch(/todayEmpty[\s\S]{0,80}WidgetEmpty|WidgetEmpty[\s\S]{0,80}todayEmpty/)
    expect(widgets).toMatch(/top3Empty[\s\S]{0,80}WidgetEmpty|WidgetEmpty[\s\S]{0,80}top3Empty/)
  })
})
