/**
 * ESLint Rule: rox/no-foreground-opacity (UI-AUDIT §8.1)
 *
 * Ad-hoc foreground alpha (bg-foreground/5, text-foreground/70, border-foreground/10) produces
 * a different grey on every surface. Use the state, border and text tokens instead:
 *   hover/pressed/selected fills -> bg-surface-hover / -pressed / -selected (--state-*)
 *   lines                        -> border-border-subtle / border-border-strong (--border-*)
 *   secondary text               -> text-muted-foreground / text-text-secondary / text-text-muted
 */

const { createClassStringListeners } = require('./lib/class-token-visitor.cjs')

const FOREGROUND_ALPHA = /^(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|divide|fill|stroke|from|via|to|placeholder|decoration|shadow|caret)-foreground\/(?:\d+|[[(].+[\])])$/

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow foreground/NN alpha classes; use state, border and text tokens.' },
    schema: [],
    messages: {
      foregroundAlpha:
        "'{{token}}' mixes foreground alpha ad hoc. Use a token: bg-surface-hover/pressed/selected, border-border-subtle/strong, text-muted-foreground or text-text-secondary/muted.",
    },
  },
  create(context) {
    return createClassStringListeners(({ node, tokens }) => {
      for (const token of tokens) {
        if (token.partial) continue
        if (FOREGROUND_ALPHA.test(token.utility)) {
          context.report({ node, messageId: 'foregroundAlpha', data: { token: token.raw } })
        }
      }
    })
  },
}
