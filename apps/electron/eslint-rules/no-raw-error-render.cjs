/**
 * ESLint Rule: rox/no-raw-error-render (UI-AUDIT §6, §8.1)
 *
 * Raw error text (stack-ish messages, ROX_* codes, English from the backend) must not reach
 * the UI directly. Route it through presentError() (UI-A3), which maps codes to i18n and keeps
 * the raw message in a collapsible Details section.
 *
 * Disallowed:
 *   <p>{error}</p>, <p>{err.message}</p>, <p>{e?.message}</p>, <p>{state.error}</p>,
 *   <p>{String(err)}</p>, <p>{`Failed: ${err.message}`}</p>,
 *   toast.error(e.message), toast.error(String(err)), toast.error('x', { description: err.message })
 * Allowed:
 *   <ErrorState error={presentError(err)} />, toast.error(presentError(e).title),
 *   {error && <ErrorCard ... />} (the condition is not rendered), {errorCount}
 */

const ERROR_NAME = /^(?:e|err|error|ex|exc|exception)$|(?:Error|Err|Exception)$/
const TOAST_METHODS = new Set(['error', 'warning', 'message', 'info'])

function isErrorName(name) {
  return typeof name === 'string' && ERROR_NAME.test(name)
}

function unwrap(node) {
  let current = node
  while (
    current &&
    (current.type === 'ChainExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSAsExpression' ||
      current.type === 'ParenthesizedExpression')
  ) {
    current = current.expression
  }
  return current
}

function memberName(node) {
  const current = unwrap(node)
  if (!current) return null
  if (current.type === 'Identifier') return current.name
  if (current.type === 'MemberExpression' && !current.computed && current.property.type === 'Identifier') {
    return current.property.name
  }
  return null
}

/** Does this expression evaluate to raw error text? */
function isRawError(node) {
  const current = unwrap(node)
  if (!current) return false
  switch (current.type) {
    case 'Identifier':
      return isErrorName(current.name)
    case 'MemberExpression': {
      if (current.computed || current.property.type !== 'Identifier') return false
      const property = current.property.name
      if (property === 'message' || property === 'stack') return isErrorName(memberName(current.object))
      return isErrorName(property)
    }
    case 'CallExpression': {
      const callee = unwrap(current.callee)
      if (callee && callee.type === 'Identifier' && callee.name === 'String') {
        return current.arguments.length > 0 && isRawError(current.arguments[0])
      }
      if (
        callee &&
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'toString'
      ) {
        return isRawError(callee.object)
      }
      return false
    }
    case 'TemplateLiteral':
      return current.expressions.some(isRawError)
    case 'BinaryExpression':
      return current.operator === '+' && (isRawError(current.left) || isRawError(current.right))
    default:
      return false
  }
}

/** Expressions that are actually rendered (skip the condition of && / ?:). */
function renderedExpressions(node) {
  const current = unwrap(node)
  if (!current) return []
  if (current.type === 'LogicalExpression') {
    if (current.operator === '&&') return renderedExpressions(current.right)
    return [...renderedExpressions(current.left), ...renderedExpressions(current.right)]
  }
  if (current.type === 'ConditionalExpression') {
    return [...renderedExpressions(current.consequent), ...renderedExpressions(current.alternate)]
  }
  return [current]
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow rendering raw error messages; use presentError().' },
    schema: [],
    messages: {
      rawRender: 'Raw error rendered in JSX. Use presentError(err) (code -> i18n, raw text only in Details).',
      rawToast: 'Raw error passed to toast.{{method}}(). Use presentError(err) for the title/description.',
    },
  },
  create(context) {
    return {
      JSXExpressionContainer(node) {
        const parent = node.parent
        if (!parent || (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment')) return
        for (const expression of renderedExpressions(node.expression)) {
          if (isRawError(expression)) context.report({ node: expression, messageId: 'rawRender' })
        }
      },
      CallExpression(node) {
        const callee = unwrap(node.callee)
        if (
          !callee ||
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.object.type !== 'Identifier' ||
          callee.object.name !== 'toast' ||
          callee.property.type !== 'Identifier' ||
          !TOAST_METHODS.has(callee.property.name)
        ) {
          return
        }
        const method = callee.property.name
        const [first, second] = node.arguments
        for (const expression of renderedExpressions(first)) {
          if (isRawError(expression)) context.report({ node: expression, messageId: 'rawToast', data: { method } })
        }
        if (second && second.type === 'ObjectExpression') {
          for (const property of second.properties) {
            if (property.type !== 'Property' || property.computed) continue
            const key = property.key.type === 'Identifier' ? property.key.name : property.key.value
            if (key !== 'description' && key !== 'title') continue
            for (const expression of renderedExpressions(property.value)) {
              if (isRawError(expression)) context.report({ node: expression, messageId: 'rawToast', data: { method } })
            }
          }
        }
      },
    }
  },
}
