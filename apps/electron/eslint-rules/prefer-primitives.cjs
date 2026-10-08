/**
 * ESLint Rule: rox/prefer-primitives (UI-AUDIT P1-14, P1-15, §8.1)
 *
 * Hand-rolled controls drift from the system (and render OS-styled popups on Windows).
 *
 * Disallowed:
 *   <select>                        -> Select (@/components/ui/select, Radix)
 *   <input type="checkbox">         -> Checkbox (#1592; messageId rawCheckbox is ungated until it lands)
 *   role="tab"                      -> Tabs (@/components/ui/tabs); Segmented for filters (#1592)
 *   <button title={t('...')}>       -> Tooltip (packages/ui tooltip / ActionTooltip; also on *Button)
 *   'fixed inset-0' in a class list -> Dialog / Sheet / FullscreenOverlayBase (scrim + portal + z layer)
 */

const { createClassStringListeners, mergeListeners } = require('./lib/class-token-visitor.cjs')

function attributeValue(attribute) {
  if (!attribute || !attribute.value) return null
  if (attribute.value.type === 'Literal') return attribute.value.value
  if (attribute.value.type === 'JSXExpressionContainer') {
    const expression = attribute.value.expression
    if (expression.type === 'Literal') return expression.value
    if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0) {
      return expression.quasis[0].value.cooked
    }
  }
  return null
}

function findAttribute(node, name) {
  return node.attributes.find((attribute) => attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier' && attribute.name.name === name)
}

function isTranslationCall(expression) {
  if (!expression || expression.type !== 'CallExpression') return false
  const callee = expression.callee
  if (callee.type === 'Identifier') return callee.name === 't'
  return callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && callee.property.name === 't'
}

function elementName(nameNode) {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name
  if (nameNode.type === 'JSXMemberExpression') return nameNode.property.name
  return ''
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Use the shared primitives instead of native or hand-rolled controls.' },
    schema: [],
    messages: {
      nativeSelect: 'Native <select>. Use the Select primitive (@/components/ui/select).',
      rawCheckbox: 'Raw <input type="checkbox">. Use the Checkbox primitive once it lands (#1592); not gated by the ratchet until then.',
      roleTab: 'Hand-rolled role="tab". Use Tabs (@/components/ui/tabs); filter segments can use SettingsSegmentedControl until Segmented lands (#1592).',
      titleTooltip: 'title={t(...)} on a button. Use the Tooltip primitive (@rox/ui Tooltip or ActionTooltip); native titles are slow, unstyled and invisible to keyboard users.',
      fixedOverlay: "Hand-rolled 'fixed inset-0' overlay. Use Dialog, Sheet or FullscreenOverlayBase (portal, scrim and z layer included).",
    },
  },
  create(context) {
    const jsxListeners = {
      JSXOpeningElement(node) {
        const name = elementName(node.name)
        if (name === 'select') context.report({ node, messageId: 'nativeSelect' })
        if (name === 'input' && String(attributeValue(findAttribute(node, 'type')) ?? '').toLowerCase() === 'checkbox') {
          context.report({ node, messageId: 'rawCheckbox' })
        }
        if (attributeValue(findAttribute(node, 'role')) === 'tab') {
          context.report({ node: findAttribute(node, 'role'), messageId: 'roleTab' })
        }
        if (name === 'button' || /Button$/.test(name)) {
          const title = findAttribute(node, 'title')
          if (title && title.value && title.value.type === 'JSXExpressionContainer' && isTranslationCall(title.value.expression)) {
            context.report({ node: title, messageId: 'titleTooltip' })
          }
        }
      },
    }

    const classListeners = createClassStringListeners(({ node, tokens }) => {
      const bare = new Set(tokens.filter((token) => !token.partial && token.variants.length === 0).map((token) => token.utility))
      if (bare.has('fixed') && bare.has('inset-0')) context.report({ node, messageId: 'fixedOverlay' })
    })

    return mergeListeners(jsxListeners, classListeners)
  },
}
