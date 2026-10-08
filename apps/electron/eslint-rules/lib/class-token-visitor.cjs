/**
 * Shared class-string visitor for the rox/* UI token rules (UI-A2, #1568).
 *
 * Finds every static class string an element can receive and hands each one
 * to a callback, split into tokens:
 *
 *   - JSX `className` / `class` / `*ClassName` attributes
 *   - calls to cn / clsx / cx / classnames / classNames / twMerge / twJoin / cva / tv
 *   - variables named like class holders (`fooClasses`, `BASE_CLASS`, `rowClassName`)
 *   - object properties named `className` / `class` / `*ClassName`
 *
 * Inside those it follows string literals, template quasis, conditionals,
 * logical expressions, arrays, object keys and values (clsx maps, cva variant
 * maps), `+` concatenation and TS wrappers. A literal is reported once per
 * file even when two entry points reach it (className={cn('...')}).
 *
 * Template quasis are split at their `${}` holes. A token touching a hole
 * (`z-${level}`) is partial and marked `partial: true`; rules skip partial
 * tokens because their final value is not known statically.
 */

const CLASS_FUNCTIONS = new Set([
  'cn',
  'clsx',
  'cx',
  'classnames',
  'classNames',
  'twMerge',
  'twJoin',
  'cva',
  'tv',
])

const CLASS_ATTRIBUTE = /^(class|className|[A-Za-z0-9]+ClassName)$/
const CLASS_VARIABLE = /(class(es|name|names)?|cls)$/i
const CLASS_PROPERTY = /^(class|className|[A-Za-z0-9]+ClassName)$/

function calleeName(callee) {
  if (!callee) return null
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name
  }
  return null
}

function isClassFunctionCall(node) {
  return node && node.type === 'CallExpression' && CLASS_FUNCTIONS.has(calleeName(node.callee) ?? '')
}

function propertyKeyName(key) {
  if (!key) return null
  if (key.type === 'Identifier') return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  return null
}

/**
 * Split a class token into variants, the utility, and the important/negative flags.
 *   'md:hover:-z-10!' -> { variants: ['md', 'hover'], utility: 'z-10', negative: true, important: true }
 */
function parseClassToken(raw) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch === '[' || ch === '(') depth += 1
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ':' && depth === 0) {
      parts.push(raw.slice(start, i))
      start = i + 1
    }
  }
  parts.push(raw.slice(start))
  let utility = parts.pop() ?? ''
  let important = false
  let negative = false
  if (utility.startsWith('!')) {
    important = true
    utility = utility.slice(1)
  }
  if (utility.endsWith('!')) {
    important = true
    utility = utility.slice(0, -1)
  }
  if (utility.startsWith('-')) {
    negative = true
    utility = utility.slice(1)
  }
  return { raw, variants: parts, utility, important, negative }
}

/** Whitespace split that keeps bracketed arbitrary values (`grid-cols-[1fr_auto]`) intact. */
function splitClassString(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
}

function tokensFromString(value, { partialStart = false, partialEnd = false } = {}) {
  const startsWithSpace = /^\s/.test(value)
  const endsWithSpace = /\s$/.test(value)
  const raws = splitClassString(value)
  return raws.map((raw, index) => {
    const token = parseClassToken(raw)
    token.partial =
      (partialStart && index === 0 && !startsWithSpace) ||
      (partialEnd && index === raws.length - 1 && !endsWithSpace)
    return token
  })
}

/**
 * Walk an expression that evaluates to (part of) a class list and call
 * `emit(node, value, tokens)` for every static string piece.
 */
function walkClassExpression(expr, emit, seen) {
  if (!expr) return
  switch (expr.type) {
    case 'Literal':
      if (typeof expr.value === 'string') {
        if (seen.has(expr)) return
        seen.add(expr)
        emit(expr, expr.value, tokensFromString(expr.value))
      }
      return
    case 'TemplateLiteral':
      expr.quasis.forEach((quasi, index) => {
        if (seen.has(quasi)) return
        seen.add(quasi)
        const value = quasi.value.cooked ?? quasi.value.raw ?? ''
        emit(quasi, value, tokensFromString(value, {
          partialStart: index > 0,
          partialEnd: index < expr.quasis.length - 1,
        }))
      })
      expr.expressions.forEach((inner) => walkClassExpression(inner, emit, seen))
      return
    case 'TaggedTemplateExpression':
      walkClassExpression(expr.quasi, emit, seen)
      return
    case 'ConditionalExpression':
      walkClassExpression(expr.consequent, emit, seen)
      walkClassExpression(expr.alternate, emit, seen)
      return
    case 'LogicalExpression':
      walkClassExpression(expr.left, emit, seen)
      walkClassExpression(expr.right, emit, seen)
      return
    case 'BinaryExpression':
      if (expr.operator === '+') {
        walkClassExpression(expr.left, emit, seen)
        walkClassExpression(expr.right, emit, seen)
      }
      return
    case 'ArrayExpression':
      expr.elements.forEach((element) => walkClassExpression(element, emit, seen))
      return
    case 'ObjectExpression':
      expr.properties.forEach((property) => {
        if (property.type === 'SpreadElement') {
          walkClassExpression(property.argument, emit, seen)
          return
        }
        if (property.type !== 'Property') return
        if (!property.computed || property.key.type === 'Literal' || property.key.type === 'TemplateLiteral') {
          if (property.key.type === 'Literal' || property.key.type === 'TemplateLiteral') {
            walkClassExpression(property.key, emit, seen)
          }
        }
        walkClassExpression(property.value, emit, seen)
      })
      return
    case 'SpreadElement':
      walkClassExpression(expr.argument, emit, seen)
      return
    case 'CallExpression':
      if (isClassFunctionCall(expr)) {
        expr.arguments.forEach((argument) => walkClassExpression(argument, emit, seen))
      }
      return
    case 'ArrowFunctionExpression':
      // cn-style render props: className={({ isActive }) => cn(...)}
      if (expr.body && expr.body.type !== 'BlockStatement') walkClassExpression(expr.body, emit, seen)
      return
    case 'JSXExpressionContainer':
      walkClassExpression(expr.expression, emit, seen)
      return
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
    case 'ChainExpression':
    case 'ParenthesizedExpression':
      walkClassExpression(expr.expression, emit, seen)
      return
    default:
      return
  }
}

function jsxElementName(nameNode) {
  if (!nameNode) return null
  if (nameNode.type === 'JSXIdentifier') return nameNode.name
  if (nameNode.type === 'JSXMemberExpression') {
    const object = jsxElementName(nameNode.object)
    return object ? `${object}.${nameNode.property.name}` : nameNode.property.name
  }
  if (nameNode.type === 'JSXNamespacedName') return `${nameNode.namespace.name}:${nameNode.name.name}`
  return null
}

/**
 * Build ESLint listeners that call `onClassString({ node, value, tokens, source })`
 * for each static class string. `source` is { kind, attribute?, element?, callee?, variable? }.
 */
function createClassStringListeners(onClassString) {
  const seen = new WeakSet()

  function visit(expr, source) {
    walkClassExpression(expr, (node, value, tokens) => onClassString({ node, value, tokens, source }), seen)
  }

  return {
    JSXAttribute(node) {
      if (!node.name || node.name.type !== 'JSXIdentifier') return
      if (!CLASS_ATTRIBUTE.test(node.name.name)) return
      const element = node.parent && node.parent.type === 'JSXOpeningElement' ? jsxElementName(node.parent.name) : null
      visit(node.value, { kind: 'jsx-attribute', attribute: node.name.name, element })
    },
    CallExpression(node) {
      if (!isClassFunctionCall(node)) return
      node.arguments.forEach((argument) => visit(argument, { kind: 'call', callee: calleeName(node.callee) }))
    },
    VariableDeclarator(node) {
      if (!node.init || node.id.type !== 'Identifier') return
      if (!CLASS_VARIABLE.test(node.id.name)) return
      visit(node.init, { kind: 'variable', variable: node.id.name })
    },
    Property(node) {
      if (node.computed) return
      const name = propertyKeyName(node.key)
      if (!name || !CLASS_PROPERTY.test(name)) return
      visit(node.value, { kind: 'property', property: name })
    },
  }
}

/** Merge several listener maps into one (ESLint allows only one function per selector). */
function mergeListeners(...maps) {
  const merged = {}
  for (const map of maps) {
    for (const [selector, fn] of Object.entries(map)) {
      const previous = merged[selector]
      merged[selector] = previous ? (node) => { previous(node); fn(node) } : fn
    }
  }
  return merged
}

module.exports = {
  CLASS_FUNCTIONS,
  createClassStringListeners,
  isClassFunctionCall,
  jsxElementName,
  mergeListeners,
  parseClassToken,
  splitClassString,
  tokensFromString,
  walkClassExpression,
}
