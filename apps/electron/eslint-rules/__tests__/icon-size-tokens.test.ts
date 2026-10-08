import { describe, expect, it } from 'bun:test'
import { ids, runRoxRule } from './helpers/run-rox-rule'

const run = (code: string) => runRoxRule('icon-size-tokens', code)

describe('rox/icon-size-tokens', () => {
  it('flags numeric size props, strokeWidth and size classes on lucide icons', () => {
    const messages = run(`
      import { X, ChevronDown as Chevron } from 'lucide-react'
      const a = <X size={14} />
      const b = <Chevron size="16" strokeWidth={2} />
      const c = <X className="h-4 w-4 text-muted-foreground" />
      const d = <X className={cn('size-3.5', 'w-[18px]')} />
    `)
    expect(ids(messages)).toEqual(['sizeProp', 'sizeProp', 'strokeWidth', 'sizeClass', 'sizeClass', 'sizeClass', 'sizeClass'])
  })

  it('handles namespace imports', () => {
    const messages = run(`import * as Icons from 'lucide-react'; const a = <Icons.Plus size={12} />`)
    expect(ids(messages)).toEqual(['sizeProp'])
  })

  it('allows icon-* classes, pass-through sizes and non-lucide components', () => {
    const messages = run(`
      import { X, type LucideIcon } from 'lucide-react'
      const a = <X className="icon-toolbar text-muted-foreground" />
      const b = <X size={size} />
      const c = <Avatar size={14} className="h-4 w-4" />
      const d = <X className="h-full w-full" />
    `)
    expect(messages).toHaveLength(0)
  })
})
