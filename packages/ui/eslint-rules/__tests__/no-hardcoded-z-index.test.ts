import { describe, expect, it } from 'bun:test'
import { Linter } from 'eslint'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rule = require('../no-hardcoded-z-index.cjs')

function runRule(code: string, options?: Record<string, boolean>) {
  const linter = new Linter({ configType: 'eslintrc' })
  linter.defineRule('craft-styles/no-hardcoded-z-index', rule)

  return linter.verify(code, {
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'craft-styles/no-hardcoded-z-index': options ? ['error', options] : 'error',
    },
  })
}

describe('no-hardcoded-z-index (ui)', () => {
  it('flags hardcoded default in destructured props', () => {
    const messages = runRule('function Comp({ zIndex = 50 }) { return zIndex }')
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('Avoid hardcoded zIndex values')
  })

  it('flags hardcoded default in object destructuring', () => {
    const messages = runRule('const { zIndex = 50 } = props')
    expect(messages.length).toBe(1)
  })

  it('allows token-based zIndex default values', () => {
    const messages = runRule("const { zIndex = 'var(--z-island, 400)' } = props")
    expect(messages.length).toBe(0)
  })

  it('v2: flags deprecated z alias vars (use the layer they alias)', () => {
    const messages = runRule("const { zIndex = 'var(--z-floating-menu, 400)' } = props")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain("'--z-floating-menu' is a deprecated z alias")
    expect(messages[0]?.message).toContain('var(--z-island)')
  })

  it('v2: flags numeric z classes in class strings', () => {
    const messages = runRule("const c = cn('flex z-50')")
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain("Numeric z class 'z-50'")
  })

  it('v1 compat options keep the style-only behaviour', () => {
    const messages = runRule(
      "const c = cn('z-50'); const s = { zIndex: 'var(--z-overlay)' }; const t = { zIndex: 400 }",
      { checkClasses: false, checkDeprecatedAliases: false },
    )
    expect(messages.length).toBe(1)
    expect(messages[0]?.message).toContain('Avoid hardcoded zIndex values')
  })

  it('continues to flag hardcoded style zIndex literals', () => {
    const messages = runRule('const style = { zIndex: 400 }')
    expect(messages.length).toBe(1)
  })
})
