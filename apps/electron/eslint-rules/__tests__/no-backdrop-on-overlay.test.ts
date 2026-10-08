import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string) => runRoxRule('no-backdrop-on-overlay', code)

describe('rox/no-backdrop-on-overlay', () => {
  it('flags blur and translucent backgrounds on overlay content', () => {
    const messages = run(`
      const a = <PopoverContent className="backdrop-blur-md bg-background/80" />
      const b = <TooltipContent className={cn('bg-popover/95')} />
      const c = <ContextMenu.Content className="backdrop-saturate-150" />
      const d = <StyledDropdownMenuSubContent className="bg-[var(--surface-popover)]/90" />
      const e = <DialogContent className="backdrop-blur-sm" />
    `)
    expect(ids(messages)).toEqual(Array(6).fill('backdrop'))
  })

  it('allows opaque content and blur on chrome strips', () => {
    const messages = run(`
      const a = <PopoverContent className="bg-popover shadow-strong" />
      const b = <header className="backdrop-blur-md bg-background/80" />
      const c = <DialogOverlay className="bg-black/40 backdrop-blur-sm" />
    `)
    expect(messages).toHaveLength(0)
  })
})
