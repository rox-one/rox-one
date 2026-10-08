import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { loadRule } from './helpers/run-rox-rule'

const visitor = loadRule('lib/class-token-visitor.cjs')

/** Collect every class string the visitor hands out for a snippet. */
function collect(code: string) {
  const found: Array<{ value: string; tokens: string[]; partial: string[]; kind: string; element?: string }> = []
  const rule = {
    create() {
      return visitor.createClassStringListeners(({ value, tokens, source }: any) => {
        found.push({
          value,
          tokens: tokens.filter((t: any) => !t.partial).map((t: any) => t.raw),
          partial: tokens.filter((t: any) => t.partial).map((t: any) => t.raw),
          kind: source.kind,
          element: source.element ?? undefined,
        })
      })
    },
  }
  const linter = new Linter()
  linter.verify(code, [{
    files: ['**/*.tsx'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { t: { rules: { collect: rule } } },
    rules: { 't/collect': 'error' },
  }], 'C.tsx')
  return found
}

describe('class-token-visitor', () => {
  it('parses variants, important and negative flags', () => {
    expect(visitor.parseClassToken('md:hover:-z-10!')).toMatchObject({
      variants: ['md', 'hover'], utility: 'z-10', negative: true, important: true,
    })
    expect(visitor.parseClassToken('!z-[calc(var(--z-a)+1)]')).toMatchObject({ variants: [], utility: 'z-[calc(var(--z-a)+1)]', important: true })
    expect(visitor.parseClassToken('[&:hover]:z-10')).toMatchObject({ variants: ['[&:hover]'], utility: 'z-10' })
  })

  it('reads className strings, expressions and cn/clsx/cva/tv calls once each', () => {
    const found = collect(`
      const a = <div className="z-10 flex" />
      const b = <div className={cn('z-20', open && 'z-30', { 'z-40': on }, ['z-50'], x ? 'z-60' : 'z-70')} />
      const c = clsx('rounded-xl')
      const d = cva('base', { variants: { size: { sm: 'h-6' } }, compoundVariants: [{ class: 'z-80' }] })
      const e = tv({ base: 'z-90' })
      const contentClasses = 'fixed inset-0'
      const props = { overlayClassName: 'z-[5]' }
      const f = <Popover contentClassName={'a' + 'b'} />
    `)
    const all = found.flatMap((f) => f.tokens)
    for (const token of ['z-10', 'z-20', 'z-30', 'z-40', 'z-50', 'z-60', 'z-70', 'rounded-xl', 'h-6', 'z-80', 'z-90', 'fixed', 'inset-0', 'z-[5]', 'a', 'b']) {
      expect(all).toContain(token)
    }
    // The cn(...) literals inside className={...} are reported once, not by both entry points.
    expect(all.filter((t) => t === 'z-20')).toHaveLength(1)
    expect(found.find((f) => f.tokens.includes('z-10'))?.element).toBe('div')
  })

  it('splits template literals and marks tokens touching a hole as partial', () => {
    const found = collect('const a = <div className={`z-${level} flex p-${n}x rounded-lg`} />')
    const tokens = found.flatMap((f) => f.tokens)
    const partial = found.flatMap((f) => f.partial)
    expect(tokens).toEqual(expect.arrayContaining(['flex', 'rounded-lg']))
    expect(partial).toEqual(expect.arrayContaining(['z-', 'p-', 'x']))
    expect(tokens).not.toContain('z-')
  })

  it('ignores strings outside class contexts', () => {
    const found = collect(`const label = 'z-50'; fetch('z-10'); const el = <div title="z-20" />`)
    expect(found).toHaveLength(0)
  })
})
