/**
 * ESLint Rule: no-floating-z-tokens-in-island
 *
 * Enforces semantic island z-index tokens in island-related components.
 * In island contexts, disallow the deprecated floating aliases:
 * - var(--z-floating-menu)
 * - var(--z-floating-backdrop)
 *
 * and require the layer tokens (styles/tokens/z.css):
 * - var(--z-island)         (400) for island menus/surfaces
 * - var(--z-menu-backdrop)  (390) for their click-catching backdrops (the
 *   step below the island and above fullscreen overlays, so a menu opened in
 *   an overlay still closes on an outside click; --z-island-overlay is a
 *   deprecated alias of it)
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
        'Use layer tokens in island components: var(--z-island) for menus and var(--z-menu-backdrop) for backdrops, instead of floating tokens.',
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
