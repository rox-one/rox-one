/**
 * Token vocabulary for the rox/* UI token rules (UI-A2, #1568).
 *
 * The z layer names and the deprecated alias names are read from the A1 token
 * file (packages/ui/src/styles/tokens/z.css) so the lint rules can never drift
 * from the tokens. Everything else mirrors the owner decisions recorded in the
 * token files: radii 0/4/6/8/12, the 9/11/12/13/15/15/16/18/20/24/44 type scale, and the
 * icon-* utilities.
 */

const fs = require('node:fs')
const path = require('node:path')

const Z_TOKEN_FILE = path.resolve(__dirname, '../../../../packages/ui/src/styles/tokens/z.css')

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function rootBlock(css) {
  const start = css.indexOf(':root')
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return ''
}

/** file -> { mtimeMs, size, tokens }. A long-running editor ESLint server picks up z.css edits. */
const zCache = new Map()

/** { layers: Map<name, number>, aliases: Map<name, targetLayer> } parsed from z.css :root. */
function readZTokens(file = Z_TOKEN_FILE) {
  const stat = fs.statSync(file)
  const cached = zCache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.tokens
  const css = stripComments(fs.readFileSync(file, 'utf8'))
  const root = rootBlock(css)
  const layers = new Map()
  const aliases = new Map()
  for (const match of root.matchAll(/--z-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, name, rawValue] = match
    const value = rawValue.trim()
    if (/^-?\d+$/.test(value)) {
      layers.set(name, Number(value))
      continue
    }
    const alias = /^var\(--z-([a-z0-9-]+)\)$/.exec(value)
    if (alias) aliases.set(name, alias[1])
  }
  if (layers.size === 0) {
    throw new Error(`rox lint rules: no z layers found in ${file}`)
  }
  const tokens = { layers, aliases }
  zCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, tokens })
  return tokens
}

const RADIUS_NAMES = ['none', 'xs', 'sm', 'md', 'lg', 'full']
const RADIUS_VARS = ['none', 'xs', 'sm', 'md', 'lg', 'full', 'control', 'card', 'composer', 'overlay']
const RETIRED_RADIUS_NAMES = ['xl', '2xl', '3xl', '4xl']

/** px -> token name for the type scale (owner decision 9/11/12/13/15/15/16/18/20/24/44). */
const TEXT_SIZE_BY_PX = {
  9: 'text-mark',
  11: 'text-caption',
  12: 'text-small',
  13: 'text-body',
  15: 'text-reading or text-title-sm',
  16: 'text-title-md',
  18: 'text-title',
  20: 'text-stat',
  24: 'text-display',
  44: 'text-hero',
}
const TEXT_SIZE_NAMES = [
  'caption', 'small', 'body', 'reading', 'title-sm', 'title', 'display',
  'data', 'prose', 'title-md', 'stat', 'hero', 'floor', 'mark',
  'xs', 'sm', 'base', 'lg', 'xl',
]
const OFF_SCALE_TEXT_SIZES = ['2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']

const ICON_CLASSES = ['icon-rail', 'icon-toolbar', 'icon-inline', 'icon-caption', 'icon-status', 'icon-empty']

const PALETTE_HUES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]

module.exports = {
  ICON_CLASSES,
  OFF_SCALE_TEXT_SIZES,
  PALETTE_HUES,
  RADIUS_NAMES,
  RADIUS_VARS,
  RETIRED_RADIUS_NAMES,
  TEXT_SIZE_BY_PX,
  TEXT_SIZE_NAMES,
  Z_TOKEN_FILE,
  readZTokens,
}
