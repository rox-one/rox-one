import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string) => runRoxRule('no-arbitrary-text-size', code)

describe('rox/no-arbitrary-text-size', () => {
  it('flags arbitrary font sizes and suggests the matching token', () => {
    const messages = run(`const a = <p className="text-[13px] md:text-[0.8rem] text-[length:12px] text-[11px]/[14px]" />`)
    expect(ids(messages)).toEqual(['textSize', 'textSize', 'textSize', 'textSize'])
    expect(messages[0]?.message).toContain('text-body')
    expect(messages[3]?.message).toContain('text-caption')
  })

  it('flags arbitrary leading and tracking', () => {
    expect(ids(run(`const a = cn('leading-[18px]', 'tracking-[0.02em]', 'tracking-[-0.5px]')`)))
      .toEqual(['leading', 'tracking', 'tracking'])
  })

  it('flags off-scale named sizes', () => {
    expect(ids(run(`const a = <h1 className="text-2xl lg:text-4xl" />`))).toEqual(['offScale', 'offScale'])
  })

  it('allows type tokens, aliases, colours and var-based values', () => {
    const messages = run(`
      const a = <p className="text-caption text-small text-body text-reading text-title-sm text-title text-display text-xs text-sm text-base text-lg text-xl" />
      const b = cn('text-[length:var(--text-code-size)]', 'text-[#fff]', 'text-[var(--accent)]', 'leading-[var(--text-body-leading)]', 'text-foreground', 'leading-none', 'tracking-tight')
    `)
    expect(messages).toHaveLength(0)
  })
})
