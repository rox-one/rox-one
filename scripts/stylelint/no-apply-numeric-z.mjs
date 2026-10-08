/**
 * Stylelint rule: rox-css/no-apply-numeric-z (UI-A2 review1 W4)
 *
 * `@apply z-50` / `@apply md:z-[60]` bypasses both the ESLint z rule (not TSX) and the
 * declaration-strict-value check (an at-rule, not a z-index declaration). Same token test as the
 * ESLint broad check; layer-based arbitrary values (z-[calc(var(--z-chrome)+1)]) stay allowed.
 */
import { createRequire } from 'node:module'
import stylelint from 'stylelint'

// Same bracket-aware token parser as the ESLint rule, so `@apply data-[state=open]:z-50`,
// `@apply [&>*]:z-10` and `@apply group-hover/name:z-10` are caught.
const { isNumericZToken, parseClassToken } = createRequire(import.meta.url)('../../apps/electron/eslint-rules/lib/class-token-visitor.cjs')

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

export const ruleName = 'rox-css/no-apply-numeric-z'

export const messages = ruleMessages(ruleName, {
  numericZ: (token) => `"@apply ${token}" is off the z layer scale. Apply a z-<layer> utility instead.`,
})

const LAYER_BASED = /var\(\s*--z-[a-z0-9-]+/

const rule = (primary) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary })) return
  root.walkAtRules('apply', (atRule) => {
    for (const raw of atRule.params.split(/\s+/).filter(Boolean)) {
      const token = parseClassToken(raw)
      if (!isNumericZToken(token)) continue
      // Only the utility decides: z-[calc(var(--z-chrome)+1)] is allowed whatever the variants say.
      if (LAYER_BASED.test(token.utility)) continue
      report({ result, ruleName, node: atRule, message: messages.numericZ(raw), word: raw })
    }
  })
}

rule.ruleName = ruleName
rule.messages = messages
rule.meta = { url: 'https://github.com/rox-one/rox-one/issues/1568' }

export default createPlugin(ruleName, rule)
