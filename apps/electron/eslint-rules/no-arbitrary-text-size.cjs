/**
 * ESLint Rule: rox/no-arbitrary-text-size (UI-A2, #1568; UI-AUDIT §8.1)
 *
 * Type stays on the owner scale 11/12/13/15/15/18/24 (packages/ui/src/styles/tokens/type.css).
 *
 * Disallowed: text-[13px], text-[0.8rem], text-[length:12px], leading-[18px], tracking-[0.02em],
 *             off-scale sizes text-2xl ... text-9xl.
 * Allowed:    text-{caption,small,body,reading,title-sm,title,display} and the xs/sm/base/lg/xl aliases;
 *             arbitrary values that reference a token var: text-[length:var(--text-code-size)].
 * Colour arbitrary values (text-[#fff], text-[var(--x)]) belong to rox/no-raw-color.
 */

const { createClassStringListeners } = require('./lib/class-token-visitor.cjs')
const { OFF_SCALE_TEXT_SIZES, TEXT_SIZE_BY_PX } = require('./lib/ui-tokens.cjs')

const LENGTH = /^(?:length:)?-?\d*\.?\d+(px|rem|em|pt|%|vw|vh)?$/
const USES_VAR = /var\(--|^--/

function suggestion(inner) {
  const px = /^(?:length:)?(\d+(?:\.\d+)?)px$/.exec(inner)
  if (px && TEXT_SIZE_BY_PX[Number(px[1])]) return ` (${TEXT_SIZE_BY_PX[Number(px[1])]})`
  return ''
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Keep font size, line height and letter spacing on the type tokens.' },
    schema: [],
    messages: {
      textSize: "Arbitrary text size '{{token}}'. Use a type token{{hint}}: text-caption/small/body/reading/title-sm/title/display.",
      offScale: "'{{token}}' is off the type scale. Use text-title or text-display.",
      leading: "Arbitrary line height '{{token}}'. Type tokens carry their own line height; drop it or use a token var.",
      tracking: "Arbitrary letter spacing '{{token}}'. Use the type tokens' tracking or a token var.",
    },
  },
  create(context) {
    return createClassStringListeners(({ node, tokens }) => {
      for (const token of tokens) {
        if (token.partial) continue
        const utility = token.utility
        let match = /^text-([[(])(.+?)[\])](?:\/.*)?$/.exec(utility)
        if (match) {
          const inner = match[2]
          if (USES_VAR.test(inner)) continue
          if (LENGTH.test(inner)) {
            context.report({ node, messageId: 'textSize', data: { token: token.raw, hint: suggestion(inner) } })
          }
          continue
        }
        match = /^text-([0-9]xl)(?:\/.*)?$/.exec(utility)
        if (match && OFF_SCALE_TEXT_SIZES.includes(match[1])) {
          context.report({ node, messageId: 'offScale', data: { token: token.raw } })
          continue
        }
        match = /^(leading|tracking)-[[(](.+)[\])]$/.exec(utility)
        if (match) {
          if (USES_VAR.test(match[2])) continue
          context.report({ node, messageId: match[1], data: { token: token.raw } })
        }
      }
    })
  },
}
