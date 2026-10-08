/**
 * ESLint Rule: no-floating-z-tokens-in-island
 *
 * Enforces semantic island z-index tokens in island-related components.
 * In island contexts, disallow the deprecated floating aliases:
 * - var(--z-floating-menu)
 * - var(--z-floating-backdrop)
 *
 * and require the island layers (styles/tokens/z.css):
 * - var(--z-island)          (400)
 * - var(--z-island-overlay)  (300, the toast step below the island)
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow floating z-index tokens in island components. Use island-specific z-index tokens.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [],
    messages: {
      useIslandToken:
        'Use island z-index tokens in island components: var(--z-island) / var(--z-island-overlay) instead of floating tokens.',
    },
  },

  create(context) {
    const filename = String(context.getFilename?.() ?? '').replace(/\\/g, '/').toLowerCase()
    const isIslandContext = /\/components\/(annotations\/annotationislandmenu|overlay\/annotatablemarkdowndocument|ui\/island|ui\/islandfollowupcontentview)\.tsx$/.test(filename)

    if (!isIslandContext) {
      return {}
    }

    function isDisallowedFloatingToken(value) {
      const normalized = value.trim().toLowerCase()
      return normalized.includes('var(--z-floating-menu') || normalized.includes('var(--z-floating-backdrop')
    }

    function checkString(node, value) {
      if (!value) return
      if (!isDisallowedFloatingToken(value)) return
      context.report({ node, messageId: 'useIslandToken' })
    }

    function getStaticTemplateValue(node) {
      if (node.type !== 'TemplateLiteral') return null
      if (node.expressions.length > 0) return null
      return node.quasis.map((q) => q.value.cooked ?? '').join('')
    }

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return
        checkString(node, node.value)
      },

      TemplateLiteral(node) {
        const staticValue = getStaticTemplateValue(node)
        if (staticValue == null) return
        checkString(node, staticValue)
      },
    }
  },
}
