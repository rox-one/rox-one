/**
 * Test harness for the rox/* UI token rules: lints a snippet with the real TypeScript
 * parser (JSX on) and returns the messages of the rule under test.
 */
import { Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function loadRule(file: string) {
  return require(`../../${file}`)
}

export function runRoxRule(
  name: string,
  code: string,
  { options, filename = 'Component.tsx' }: { options?: unknown; filename?: string } = {},
) {
  const rule = loadRule(`${name}.cjs`)
  const linter = new Linter()
  const ruleId = `rox/${name}`
  const messages = linter.verify(
    code,
    [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
          parser: tsParser,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
        },
        plugins: { rox: { rules: { [name]: rule } } },
        rules: { [ruleId]: options === undefined ? 'error' : ['error', options] },
      },
    ],
    filename,
  )
  const fatal = messages.filter((message) => message.fatal)
  if (fatal.length) throw new Error(`parse error: ${fatal.map((message) => message.message).join('; ')}`)
  return messages.filter((message) => message.ruleId === ruleId)
}

export function ids(messages: Array<{ messageId?: string }>) {
  return messages.map((message) => message.messageId)
}
