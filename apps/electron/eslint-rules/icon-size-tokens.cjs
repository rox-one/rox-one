/**
 * ESLint Rule: rox/icon-size-tokens (UI-AUDIT §8.1; owner decision: lucide stroke 1.75;
 * navigation chrome uses @phosphor-icons/react, regular weight)
 *
 * lucide-react and @phosphor-icons/react icons take their size and stroke from the icon tokens
 * (packages/ui/src/styles/tokens/icon.css): icon-rail 20, icon-toolbar 16, icon-inline 16,
 * icon-caption 14, icon-status 12, icon-empty 32. The global stroke is 1.75.
 *
 * Disallowed on a lucide or Phosphor component:
 *   size={14} / size="14"         -> use an icon-* class
 *   strokeWidth={2}               -> stroke comes from --icon-stroke (icon-status / icon-empty adjust it)
 *   className="h-4 w-4" / "size-3.5" / "w-[18px]"  -> use an icon-* class
 *   weight="bold" (Phosphor)    -> chrome glyphs stay regular weight
 * Allowed: <Icon className="icon-toolbar" />, size={size} (a variable passed through), h-full/w-full.
 */

const { walkClassExpression } = require('./lib/class-token-visitor.cjs')

const PHOSPHOR_NON_COMPONENTS = new Set(['Icon', 'IconProps', 'IconWeight', 'IconContext', 'IconBase', 'SSRBase'])

const SIZE_CLASS = /^(?:size|h|w)-(?:\d+(?:\.\d+)?|px|[[(].+[\])])$/

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Size lucide icons with icon-* token classes, not ad-hoc sizes or strokes.' },
    schema: [],
    messages: {
      sizeProp: "Icon '{{name}}' uses size={{value}}. Use an icon-* class (icon-toolbar 16, icon-caption 14, icon-status 12, icon-rail 20, icon-empty 32).",
      strokeWidth: "Icon '{{name}}' sets strokeWidth. The stroke comes from --icon-stroke (1.75); icon-status / icon-empty adjust it.",
      phosphorWeight: "Icon '{{name}}' sets weight=\"{{value}}\". Navigation glyphs use Phosphor's regular weight.",
      sizeClass: "Icon '{{name}}' is sized with '{{token}}'. Use an icon-* class (icon-toolbar, icon-caption, icon-status, icon-rail, icon-empty).",
    },
  },
  create(context) {
    const lucideNames = new Set()
    const lucideNamespaces = new Set()
    const phosphorLocals = new Set()

    function isLucide(nameNode) {
      if (!nameNode) return null
      if (nameNode.type === 'JSXIdentifier' && lucideNames.has(nameNode.name)) return nameNode.name
      if (
        nameNode.type === 'JSXMemberExpression' &&
        nameNode.object.type === 'JSXIdentifier' &&
        lucideNamespaces.has(nameNode.object.name)
      ) {
        return `${nameNode.object.name}.${nameNode.property.name}`
      }
      return null
    }

    function numericValue(value) {
      if (!value) return null
      if (value.type === 'Literal' && (typeof value.value === 'number' || /^\d+(\.\d+)?$/.test(String(value.value)))) {
        return String(value.value)
      }
      if (value.type === 'JSXExpressionContainer') return numericValue(value.expression)
      return null
    }

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value)
        const phosphor = source === '@phosphor-icons/react' || source.startsWith('@phosphor-icons/react/')
        if (!phosphor && source !== 'lucide-react' && !source.startsWith('lucide-react/')) return
        if (phosphor) {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportNamespaceSpecifier') { lucideNamespaces.add(specifier.local.name); phosphorLocals.add(specifier.local.name) }
            else if (specifier.type === 'ImportSpecifier') {
              const imported = specifier.imported.name || specifier.imported.value
              if (PHOSPHOR_NON_COMPONENTS.has(imported) || node.importKind === 'type' || specifier.importKind === 'type') continue
              lucideNames.add(specifier.local.name); phosphorLocals.add(specifier.local.name)
            }
          }
          return
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') lucideNamespaces.add(specifier.local.name)
          else if (specifier.type === 'ImportSpecifier' || specifier.type === 'ImportDefaultSpecifier') {
            const imported = specifier.imported ? specifier.imported.name || specifier.imported.value : 'default'
            // LucideIcon / LucideProps are types, not components.
            if (imported === 'LucideIcon' || imported === 'LucideProps' || imported === 'icons') continue
            if (node.importKind === 'type' || specifier.importKind === 'type') continue
            lucideNames.add(specifier.local.name)
          }
        }
      },
      JSXOpeningElement(node) {
        const name = isLucide(node.name)
        if (!name) return
        for (const attribute of node.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier') continue
          const attrName = attribute.name.name
          if (attrName === 'size') {
            const value = numericValue(attribute.value)
            if (value != null) context.report({ node: attribute, messageId: 'sizeProp', data: { name, value } })
          } else if (attrName === 'weight') {
            const root = node.name.type === 'JSXMemberExpression' ? node.name.object.name : node.name.name
            const v = attribute.value && attribute.value.type === 'Literal' ? String(attribute.value.value) : null
            if (phosphorLocals.has(root) && v && v !== 'regular') context.report({ node: attribute, messageId: 'phosphorWeight', data: { name, value: v } })
          } else if (attrName === 'strokeWidth') {
            context.report({ node: attribute, messageId: 'strokeWidth', data: { name } })
          } else if (attrName === 'className') {
            walkClassExpression(attribute.value, (literal, _value, tokens) => {
              for (const token of tokens) {
                if (!token.partial && SIZE_CLASS.test(token.utility)) {
                  context.report({ node: literal, messageId: 'sizeClass', data: { name, token: token.raw } })
                }
              }
            }, new WeakSet())
          }
        }
      },
    }
  },
}
