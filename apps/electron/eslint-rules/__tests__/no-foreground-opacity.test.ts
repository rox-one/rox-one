import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string) => runRoxRule('no-foreground-opacity', code)

describe('rox/no-foreground-opacity', () => {
  it('flags foreground alpha classes', () => {
    expect(ids(run(`const a = <div className="bg-foreground/5 text-foreground/70 border-foreground/10 hover:bg-foreground/[0.03] border-b-foreground/20" />`)))
      .toEqual(Array(5).fill('foregroundAlpha'))
  })

  it('allows tokens and plain foreground', () => {
    const messages = run(`const a = cn('text-foreground', 'text-muted-foreground', 'bg-surface-hover', 'border-border-subtle', 'bg-accent/10', 'text-muted-foreground/80')`)
    expect(messages).toHaveLength(0)
  })
})
