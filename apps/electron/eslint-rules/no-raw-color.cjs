/**
 * ESLint Rule: rox/no-raw-color (UI-A2, #1568; UI-AUDIT §8.1)
 *
 * Colour comes from semantic, status and entity tokens, never from literals or the
 * Tailwind palette.
 *
 * Disallowed:
 *   - palette classes: bg-red-500, text-zinc-400/60, border-t-blue-200, ring-emerald-300 ...
 *   - arbitrary literal colours in classes: bg-[#1e1e1e], text-[rgb(0_0_0)], border-[hsl(0,0%,50%)]
 *   - literal colours in colour-ish style keys and SVG attributes:
 *       style={{ color: '#fff' }}, { backgroundColor: 'rgba(0,0,0,.5)' }, <path fill="#000" />
 *   - in .tsx files, any string literal that is just a colour: '#ff00aa', 'rgb(1 2 3)', 'hsl(...)'
 * Allowed: bg-accent, text-muted-foreground, text-status-danger, bg-[var(--x)], color-mix() of vars,
 *   white/black/transparent/currentColor.
 */

const { createClassStringListeners, mergeListeners } = require('./lib/class-token-visitor.cjs')
const { PALETTE_HUES } = require('./lib/ui-tokens.cjs')

const COLOR_PREFIX = '(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|divide|fill|stroke|from|via|to|accent|caret|decoration|placeholder)'
const PALETTE_CLASS = new RegExp(`^${COLOR_PREFIX}-(?:${PALETTE_HUES.join('|')})-(?:50|[1-9]00|950)(?:\\/.*)?$`)
const ARBITRARY_CLASS = new RegExp(`^${COLOR_PREFIX}-[[(](.+)[\\])](?:\\/.*)?$`)
const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(\s*[-+.\d]/i
const WHOLE_COLOR = /^\s*(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(\s*[-+.\d][^)]*\))\s*$/i

const COLOR_KEYS = new Set([
  'color', 'background', 'backgroundColor', 'backgroundImage', 'border', 'borderColor',
  'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'outline', 'outlineColor', 'fill', 'stroke', 'caretColor', 'accentColor',
  'textDecorationColor', 'columnRuleColor', 'stopColor', 'floodColor', 'lightingColor',
])
const COLOR_ATTRIBUTES = new Set(['fill', 'stroke', 'color', 'stopColor', 'stop-color', 'floodColor', 'flood-color', 'lightingColor'])

function staticString(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked ?? '').join(' ')
  if (node.type === 'JSXExpressionContainer') return staticString(node.expression)
  return null
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow literal colours and Tailwind palette classes; use colour tokens.' },
    schema: [],
    messages: {
      paletteClass: "Palette class '{{token}}'. Use a semantic, status or entity colour token (bg-accent, text-status-danger, ...).",
      arbitraryClass: "Literal colour in '{{token}}'. Use a colour token or var(--...).",
      literal: "Literal colour '{{value}}'. Use a colour token (var(--...) or a token class).",
    },
  },
  create(context) {
    const filename = String(context.filename ?? context.getFilename?.() ?? '')
    const isTsx = /\.(tsx|jsx)$/.test(filename)
    const reported = new WeakSet()
    const queue = []

    function reportLiteral(node, value) {
      if (reported.has(node)) return
      reported.add(node)
      context.report({ node, messageId: 'literal', data: { value: value.trim().slice(0, 40) } })
    }

    const classListeners = createClassStringListeners(({ node, tokens }) => {
      for (const token of tokens) {
        if (token.partial) continue
        if (PALETTE_CLASS.test(token.utility)) {
          reported.add(node)
          context.report({ node, messageId: 'paletteClass', data: { token: token.raw } })
          continue
        }
        const arbitrary = ARBITRARY_CLASS.exec(token.utility)
        if (arbitrary && LITERAL_COLOR.test(arbitrary[1])) {
          reported.add(node)
          context.report({ node, messageId: 'arbitraryClass', data: { token: token.raw } })
        }
      }
    })

    const literalListeners = {
      Property(node) {
        if (node.computed) return
        const key = node.key.type === 'Identifier' ? node.key.name : node.key.type === 'Literal' ? String(node.key.value) : null
        if (!key || !COLOR_KEYS.has(key)) return
        const value = staticString(node.value)
        if (value != null && LITERAL_COLOR.test(value)) reportLiteral(node.value, value)
      },
      JSXAttribute(node) {
        if (!node.name || node.name.type !== 'JSXIdentifier' || !COLOR_ATTRIBUTES.has(node.name.name)) return
        const target = node.value && node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value
        const value = staticString(target)
        if (value != null && LITERAL_COLOR.test(value)) reportLiteral(target, value)
      },
    }

    const tsxListeners = isTsx
      ? {
          Literal(node) {
            if (typeof node.value !== 'string' || !WHOLE_COLOR.test(node.value)) return
            if (node.parent && (node.parent.type === 'ImportDeclaration' || node.parent.type === 'ExportAllDeclaration')) return
            // Let Property/JSXAttribute run first so a style value is reported once.
            queue.push(node)
          },
          TemplateElement(node) {
            const value = node.value.cooked ?? ''
            if (node.parent && node.parent.type === 'TemplateLiteral' && node.parent.expressions.length === 0 && WHOLE_COLOR.test(value)) queue.push(node)
          },
          'Program:exit'() {
            for (const node of queue) {
              const value = node.type === 'Literal' ? node.value : node.value.cooked
              reportLiteral(node, value)
            }
          },
        }
      : {}
    return mergeListeners(classListeners, literalListeners, tsxListeners)
  },
}
