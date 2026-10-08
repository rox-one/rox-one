/**
 * Stylelint rule: rox-css/no-apply-numeric-z (UI-A2 review1 W4)
 *
 * `@apply z-50` / `@apply md:z-[60]` bypasses both the ESLint z rule (not TSX) and the
 * declaration-strict-value check (an at-rule, not a z-index declaration). Same token test as the
 * ESLint broad check; layer-based arbitrary values (z-[calc(var(--z-chrome)+1)]) stay allowed.
 */
import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

export const ruleName = 'rox-css/no-apply-numeric-z'

export const messages = ruleMessages(ruleName, {
  numericZ: (token) => `"@apply ${token}" is off the z layer scale. Apply a z-<layer> utility instead.`,
})

const NUMERIC_Z = /^(?:[\w-]+:)*!?-?z-(?:\d+|\[[^\]]+\])!?$/
const LAYER_BASED = /var\(\s*--z-[a-z0-9-]+/

const rule = (primary) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary })) return
  root.walkAtRules('apply', (atRule) => {
    for (const token of atRule.params.split(/\s+/).filter(Boolean)) {
      if (!NUMERIC_Z.test(token)) continue
      if (token.includes('[') && LAYER_BASED.test(token)) continue
      report({ result, ruleName, node: atRule, message: messages.numericZ(token), word: token })
    }
  })
}

rule.ruleName = ruleName
rule.messages = messages
rule.meta = { url: 'https://github.com/rox-one/rox-one/issues/1568' }

export default createPlugin(ruleName, rule)
