/**
 * Stylelint rule: rox-css/no-theme-self-reference (UI-A2, #1568; UI-AUDIT P2-22)
 *
 * Inside a Tailwind `@theme` / `@theme inline` block, a custom property that reads itself
 * (`--shadow-sm: var(--shadow-sm)`) is a cycle: the utility it backs resolves to nothing.
 * The audit found exactly that for shadow-xs/sm/lg/xl/2xl. Fail on any direct self-reference.
 */
import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

export const ruleName = 'rox-css/no-theme-self-reference'

export const messages = ruleMessages(ruleName, {
  selfReference: (prop) => `"${prop}" references itself inside @theme. The utility it backs resolves to nothing; point it at the source token instead.`,
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const rule = (primary) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary })) return
  root.walkAtRules('theme', (atRule) => {
    atRule.walkDecls((decl) => {
      if (!decl.prop.startsWith('--')) return
      const selfRef = new RegExp(`var\\(\\s*${escapeRegExp(decl.prop)}\\s*[,)]`)
      if (selfRef.test(decl.value)) {
        report({ result, ruleName, node: decl, message: messages.selfReference(decl.prop), word: decl.prop })
      }
    })
  })
}

rule.ruleName = ruleName
rule.messages = messages
rule.meta = { url: 'https://github.com/rox-one/rox-one/issues/1568' }

export default createPlugin(ruleName, rule)
