/**
 * ESLint Rule: rox/no-arbitrary-radius (UI-A2, #1568; UI-AUDIT §8.1)
 *
 * Radii stay on the owner scale 0/4/6/8/12 (packages/ui/src/styles/tokens/radius.css).
 *
 * Disallowed: rounded-[10px], rounded-t-[3px], rounded-xl / 2xl / 3xl / 4xl, unknown names.
 * Allowed:    rounded, rounded-{none,xs,sm,md,lg,full} (any side), and arbitrary values that
 *             only reference a radius token: rounded-[var(--radius-control)].
 */

const { createClassStringListeners } = require('./lib/class-token-visitor.cjs')
const { RADIUS_NAMES, RADIUS_VARS, RETIRED_RADIUS_NAMES } = require('./lib/ui-tokens.cjs')

const ROUNDED = /^rounded(?:-(?:t|r|b|l|s|e|x|y|tl|tr|br|bl|ss|se|es|ee))?(?:-(.+))?$/
const TOKEN_VAR = new RegExp(`^var\\(--radius-(${RADIUS_VARS.join('|')})\\)$`)
const TOKEN_SHORTHAND = new RegExp(`^--radius-(${RADIUS_VARS.join('|')})$`)

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Keep border radii on the token scale (none/xs/sm/md/lg/full).' },
    schema: [],
    messages: {
      arbitrary: "Arbitrary radius '{{token}}'. Use rounded-{none,xs,sm,md,lg,full} (0/4/6/8/12/full).",
      retired: "'{{token}}' is off the radius scale (it now aliases rounded-lg). Use rounded-lg, or a smaller step.",
      unknown: "'{{token}}' is not a radius token. Use rounded-{none,xs,sm,md,lg,full}.",
    },
  },
  create(context) {
    return createClassStringListeners(({ node, tokens }) => {
      for (const token of tokens) {
        if (token.partial) continue
        const match = ROUNDED.exec(token.utility)
        if (!match) continue
        const value = match[1]
        if (value === undefined || RADIUS_NAMES.includes(value)) continue
        if (value.startsWith('[') || value.startsWith('(')) {
          const inner = value.slice(1, -1)
          if (TOKEN_VAR.test(inner) || TOKEN_SHORTHAND.test(inner)) continue
          context.report({ node, messageId: 'arbitrary', data: { token: token.raw } })
          continue
        }
        if (RETIRED_RADIUS_NAMES.includes(value)) {
          context.report({ node, messageId: 'retired', data: { token: token.raw } })
          continue
        }
        context.report({ node, messageId: 'unknown', data: { token: token.raw } })
      }
    })
  },
}
