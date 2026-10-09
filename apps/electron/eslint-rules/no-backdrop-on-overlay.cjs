/**
 * ESLint Rule: rox/no-backdrop-on-overlay (UI-AUDIT §8.1)
 *
 * Floating content (tooltips, popovers, menus, dialogs, toasts) sits on an opaque
 * surface-popover / card token. Translucency and backdrop blur belong to chrome strips only.
 *
 * Disallowed on *Content of Tooltip / Popover / HoverCard / DropdownMenu / ContextMenu / Menubar /
 * Select / Dialog / AlertDialog / Sheet / Drawer / Toast / Command (incl. Styled* wrappers and
 * namespace forms like ContextMenu.Content):
 *   backdrop-blur*, backdrop-saturate*, other backdrop-* filters, translucent bg-<token>/NN
 */

const { walkClassExpression } = require('./lib/class-token-visitor.cjs')

const OVERLAY_FAMILY = '(?:Tooltip|Popover|HoverCard|DropdownMenu|ContextMenu|Menubar|Menu|Select|Dialog|AlertDialog|Sheet|Drawer|Toast|Command)'
const CONTENT_ELEMENT = new RegExp(`^(?:Styled)?${OVERLAY_FAMILY}(?:Sub)?(?:Content|Popup|Viewport)$`)
const NAMESPACE_CONTENT = new RegExp(`^${OVERLAY_FAMILY}(?:Primitive)?\\.(?:Sub)?Content$`)
const BACKDROP = /^backdrop-/
const TRANSLUCENT_BG = /^bg-[^\s/]+\/(?:\d+|[[(].+[\])])$/

function fullName(nameNode) {
  if (nameNode.type === 'JSXIdentifier') return nameNode.name
  if (nameNode.type === 'JSXMemberExpression') return `${fullName(nameNode.object)}.${nameNode.property.name}`
  return ''
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow backdrop blur and translucent backgrounds on floating overlay content.' },
    schema: [],
    messages: {
      backdrop: "'{{token}}' on {{element}}. Floating content uses an opaque surface (bg-popover / surface-popover); blur is for chrome strips only.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = fullName(node.name)
        const short = name.split('.').pop()
        if (!CONTENT_ELEMENT.test(short) && !NAMESPACE_CONTENT.test(name)) return
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier') continue
          if (attribute.name.name !== 'className') continue
          walkClassExpression(attribute.value, (literal, _value, tokens) => {
            for (const token of tokens) {
              if (token.partial) continue
              if (BACKDROP.test(token.utility) || TRANSLUCENT_BG.test(token.utility)) {
                context.report({ node: literal, messageId: 'backdrop', data: { token: token.raw, element: name } })
              }
            }
          }, new WeakSet())
        }
      },
    }
  },
}
