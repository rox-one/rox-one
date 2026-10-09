import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string) => runRoxRule('no-arbitrary-radius', code)

describe('rox/no-arbitrary-radius', () => {
  it('flags arbitrary radii on any side', () => {
    expect(ids(run(`const a = <div className="rounded-[10px] rounded-t-[3px] md:rounded-tl-[0.5rem]" />`)))
      .toEqual(['arbitrary', 'arbitrary', 'arbitrary'])
  })

  it('flags the retired xl/2xl/3xl/4xl steps', () => {
    expect(ids(run(`const a = cn('rounded-xl', 'rounded-b-2xl', 'rounded-3xl', 'rounded-4xl')`)))
      .toEqual(['retired', 'retired', 'retired', 'retired'])
  })

  it('flags unknown radius names', () => {
    expect(ids(run(`const a = <div className="rounded-control" />`))).toEqual(['unknown'])
  })

  it('allows the scale, bare rounded, and token-only arbitrary values', () => {
    const messages = run(`
      const a = <div className="rounded rounded-none rounded-xs rounded-sm rounded-md rounded-lg rounded-full rounded-t-lg rounded-bl-md" />
      const b = cn('rounded-[var(--radius-control)]', 'rounded-(--radius-overlay)')
    `)
    expect(messages).toHaveLength(0)
  })

  it('flags arbitrary values that are not just a radius token', () => {
    expect(ids(run(`const a = cn('rounded-[calc(var(--radius-md)+2px)]', 'rounded-[var(--my-radius)]')`)))
      .toEqual(['arbitrary', 'arbitrary'])
  })
})
