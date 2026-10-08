/**
 * ESLint Rule: no-hardcoded-z-index (v2, UI-A2 #1568)
 *
 * Keeps stacking on the A1 z layer scale (packages/ui/src/styles/tokens/z.css).
 *
 * v1 checks (style objects and style assignments), option `checkStyle`:
 *   style={{ zIndex: 400 }}            -> error
 *   style={{ zIndex: '400' }}          -> error
 *   el.style.zIndex = 9999             -> error
 *   function C({ zIndex = 50 }) {}     -> error
 *
 * v2 checks on class strings (className / cn / clsx / cva / tv ...), option `checkClasses`:
 *   'z-50', 'md:z-[60]', '-z-10', '!z-0'    -> numeric or arbitrary z class
 *   'z-overlay', 'z-floating-menu'          -> not a layer utility (retired names)
 *   'z-[var(--z-island)]'                   -> allowed (references a layer)
 *   'z-[calc(var(--z-chrome)+1)]'           -> allowed (local offset on a layer)
 *
 * v2 deprecated alias check, option `checkDeprecatedAliases`:
 *   any string with var(--z-floating-menu) / --z-overlay / --z-local ... -> use the layer
 *
 * Allowed:
 *   style={{ zIndex: 'var(--z-island)' }}, 'calc(var(--z-island) + 1)', Z_CONSTANT, index + 1
 *   className="z-popover", "z-auto"
 */

const { createClassStringListeners, mergeListeners } = require('./lib/class-token-visitor.cjs')
const { readZTokens } = require('./lib/ui-tokens.cjs')

const CSS_KEYWORDS = new Set(['auto', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'])

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow hardcoded z-index values and numeric/arbitrary z classes. Use the z layer tokens.',
      category: 'Best Practices',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          checkStyle: { type: 'boolean' },
          checkClasses: { type: 'boolean' },
          checkDeprecatedAliases: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noHardcodedZIndex:
        'Avoid hardcoded zIndex values. Use a z layer token (for example var(--z-popover) or var(--z-island)), a Tailwind z-<layer> utility, or a named constant.',
      numericClass:
        "Numeric z class '{{token}}' is off the layer scale. Use a z-<layer> utility ({{layers}}).",
      arbitraryClass:
        "Arbitrary z class '{{token}}' is off the layer scale. Use a z-<layer> utility, or reference a layer: z-[calc(var(--z-<layer>)+1)].",
      unknownLayerClass:
        "'{{token}}' is not a z layer utility and generates no CSS. Use one of: {{layers}}.",
      deprecatedAlias:
        "'--z-{{alias}}' is a deprecated z alias. Use var(--z-{{target}}) (or the z-{{target}} utility) instead.",
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const checkStyle = options.checkStyle !== false
    const checkClasses = options.checkClasses !== false
    const checkDeprecatedAliases = options.checkDeprecatedAliases !== false

    const { layers, aliases } = readZTokens()
    const layerNames = new Set(layers.keys())
    const layerList = [...layerNames].join(', ')
    const aliasPattern = new RegExp(`var\\(\\s*--z-(${[...aliases.keys()].map(escapeRegExp).join('|')})(?![a-z0-9-])`, 'g')
    const layerVarPattern = new RegExp(`var\\(\\s*--z-(${[...layerNames].map(escapeRegExp).join('|')})(?![a-z0-9-])`)

    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    // ---- v1: style objects --------------------------------------------------
    function isZIndexPropertyName(node) {
      if (!node) return false
      if (node.type === 'Identifier') return node.name === 'zIndex'
      if (node.type === 'Literal') return node.value === 'zIndex' || node.value === 'z-index'
      return false
    }

    function getStaticTemplateValue(node) {
      if (node.type !== 'TemplateLiteral') return null
      if (node.expressions.length > 0) return null
      return node.quasis.map((q) => q.value.cooked ?? '').join('')
    }

    function isAllowedZIndexString(value) {
      const normalized = value.trim().toLowerCase()
      if (normalized.includes('var(--z-')) return true
      return CSS_KEYWORDS.has(normalized)
    }

    function isHardcodedLiteralValue(node) {
      if (!node) return false
      if (node.type === 'Literal') {
        if (typeof node.value === 'number') return true
        if (typeof node.value === 'string') return !isAllowedZIndexString(node.value)
        return false
      }
      if (node.type === 'TemplateLiteral') {
        const staticValue = getStaticTemplateValue(node)
        if (staticValue == null) return false
        return !isAllowedZIndexString(staticValue)
      }
      return false
    }

    function isStyleZIndexMemberExpression(node) {
      return (
        node &&
        node.type === 'MemberExpression' &&
        !node.computed &&
        node.property &&
        node.property.type === 'Identifier' &&
        node.property.name === 'zIndex' &&
        node.object &&
        node.object.type === 'MemberExpression' &&
        !node.object.computed &&
        node.object.property &&
        node.object.property.type === 'Identifier' &&
        node.object.property.name === 'style'
      )
    }

    const styleListeners = checkStyle
      ? {
          Property(node) {
            if (!isZIndexPropertyName(node.key)) return
            if (isHardcodedLiteralValue(node.value)) {
              context.report({ node: node.value, messageId: 'noHardcodedZIndex' })
            }
          },
          AssignmentPattern(node) {
            if (!(node.left && node.left.type === 'Identifier' && node.left.name === 'zIndex')) return
            if (isHardcodedLiteralValue(node.right)) {
              context.report({ node: node.right, messageId: 'noHardcodedZIndex' })
            }
          },
          AssignmentExpression(node) {
            if (!isStyleZIndexMemberExpression(node.left)) return
            if (isHardcodedLiteralValue(node.right)) {
              context.report({ node: node.right, messageId: 'noHardcodedZIndex' })
            }
          },
        }
      : {}

    // ---- v2: class strings ---------------------------------------------------
    function checkZToken(token, node) {
      if (token.partial) return
      const utility = token.utility
      if (!utility.startsWith('z-')) return
      const value = utility.slice(2)
      if (!value) return
      if (/^\d+$/.test(value)) {
        context.report({ node, messageId: 'numericClass', data: { token: token.raw, layers: layerList } })
        return
      }
      if (value.startsWith('[') || value.startsWith('(')) {
        const inner = value.slice(1, -1)
        const aliasMatch = new RegExp(aliasPattern.source).exec(inner) || /^--z-([a-z0-9-]+)$/.exec(inner)
        if (aliasMatch && aliases.has(aliasMatch[1])) {
          context.report({ node, messageId: 'deprecatedAlias', data: { alias: aliasMatch[1], target: aliases.get(aliasMatch[1]) } })
          return
        }
        // Tailwind v4 shorthand z-(--z-island) and arbitrary values that build on a layer are fine.
        const shorthandLayer = /^--z-([a-z0-9-]+)$/.exec(inner)
        if (shorthandLayer && layerNames.has(shorthandLayer[1])) return
        if (layerVarPattern.test(inner)) return
        context.report({ node, messageId: 'arbitraryClass', data: { token: token.raw } })
        return
      }
      if (value === 'auto' || layerNames.has(value)) return
      context.report({ node, messageId: 'unknownLayerClass', data: { token: token.raw, layers: layerList } })
    }

    const classListeners = checkClasses
      ? createClassStringListeners(({ node, tokens }) => {
          for (const token of tokens) checkZToken(token, node)
        })
      : {}

    // ---- v2: deprecated alias vars anywhere --------------------------------
    // Class-string literals carrying z-[var(--z-alias)] are reported by the
    // class check; skip them here so a token is counted once.
    function reportAliases(node, value) {
      if (typeof value !== 'string' || !value.includes('--z-')) return
      if (checkClasses && /(^|[\s:!])-?z-[[(]/.test(value)) return
      aliasPattern.lastIndex = 0
      for (const match of value.matchAll(aliasPattern)) {
        context.report({ node, messageId: 'deprecatedAlias', data: { alias: match[1], target: aliases.get(match[1]) } })
      }
    }

    const aliasListeners = checkDeprecatedAliases
      ? {
          Literal(node) {
            reportAliases(node, node.value)
          },
          TemplateElement(node) {
            reportAliases(node, node.value.cooked ?? node.value.raw)
          },
        }
      : {}

    return mergeListeners(styleListeners, classListeners, aliasListeners)
  },
}
