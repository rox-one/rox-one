/**
 * Static cost guard for OpenUI Lang programs.
 *
 * The vendor parser inlines referenced definitions, so a tiny program can
 * expand into an exponentially large tree (`s2 = Card([s1, s1])` chains) and
 * stall the main thread; `Renderer` re-parses on every streaming tick, so one
 * hostile fence is enough to freeze a conversation. This module estimates the
 * expanded size cheaply — a single scan plus one token pass, no parser — so the
 * block can refuse to mount the `Renderer` when a program is over budget.
 *
 * Statements are delimited the way the vendor scanner delimits them: a newline
 * ends a statement only at bracket depth 0 and outside a string literal, so a
 * multi-line expression (whose continuation-line references must still be
 * counted) stays a single statement. Splitting on newlines naively would let a
 * `s1 = Card([\n s0,\n s0\n])` chain hide its doubling behind continuation
 * lines.
 *
 * The estimate is pure and total: identical input always yields identical
 * output, partial/streaming text never throws, and the arithmetic saturates so
 * an absurd program cannot overflow.
 */

export interface OpenUIProgramBudget {
  /** Maximum post-inlining node count an accepted program may expand to. */
  maxNodes: number
  /** Maximum number of `name = expr` statements an accepted program may have. */
  maxStatements: number
}

export const OPENUI_PROGRAM_BUDGET: OpenUIProgramBudget = {
  maxNodes: 10_000,
  maxStatements: 400,
}

export interface OpenUIProgramEstimate {
  /** The program is within budget and safe to hand to the parser. */
  ok: boolean
  /** Estimated post-inlining node count (saturated at 10x the node budget). */
  nodes: number
  /** Number of `name = expr` statements found. */
  statements: number
}

/** `name = expr` with an identifier LHS and a bare `=` (not `==`); expr may span lines. */
const STATEMENT_RE = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]*)$/
/** Identifier / string / number literals — the only tokens that add weight. */
const TOKEN_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*/g

/**
 * Strip `//` and `#` comments like the vendor preprocessor, so an unbalanced
 * bracket inside a comment cannot fool {@link splitStatements} into joining
 * every following statement into one (which would hide a doubling chain). The
 * string state persists across lines, matching the vendor scanner.
 */
function stripComments(text: string): string {
  const lines = text.split('\n')
  let quote = ''
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line === undefined) continue
    let commentAt = -1
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]
      if (quote !== '') {
        if (char === '\\' && i + 1 < line.length) {
          i += 1
          continue
        }
        if (char === quote) quote = ''
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (char === '#' || (char === '/' && line[i + 1] === '/')) {
        commentAt = i
        break
      }
    }
    lines[index] = commentAt === -1 ? line : line.slice(0, commentAt).trimEnd()
  }
  return lines.join('\n')
}

/**
 * Split source into statement candidates exactly like the vendor scanner: track
 * round/square/curly bracket depth and string state (double and single quotes
 * with backslash escapes), and end a statement at a newline only when depth is
 * 0 and no string is open. A trailing whitespace-only line is never a
 * statement.
 */
function splitStatements(text: string): string[] {
  const statements: string[] = []
  let start = 0
  let depth = 0
  let ternaryDepth = 0
  let quote = ''
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote !== '') {
      if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') {
      if (depth > 0) depth -= 1
    } else if (char === '?' && depth === 0) ternaryDepth += 1
    else if (char === ':' && depth === 0 && ternaryDepth > 0) ternaryDepth -= 1
    else if (char === '\n' && depth === 0 && ternaryDepth === 0) {
      // A line-leading `?` continues the expression (vendor peek rule).
      let peek = i + 1
      while (peek < text.length) {
        const next = text[peek]
        if (next !== ' ' && next !== '\t' && next !== '\r' && next !== '\n') break
        peek += 1
      }
      if (text[peek] === '?') continue
      const candidate = text.slice(start, i).trim()
      if (candidate) statements.push(candidate)
      start = i + 1
    }
  }

  const tail = text.slice(start).trim()
  if (tail) statements.push(tail)
  return statements
}

/**
 * Estimate the post-inlining cost of an OpenUI Lang program.
 *
 * Each statement's size is `1 + Σ` over its tokens: a reference to a name
 * defined earlier contributes that name's size (so each occurrence multiplies:
 * `Card([s1, s1])` = 2x size of `s1`), and every other identifier, string or
 * number counts 1. Names not yet defined count 1 (placeholder semantics).
 *
 * Sizes are resolved forward as fully-expanded numbers, so a self- or
 * mutually-referential name can never be walked in its own ancestry: the map
 * only ever holds already-collapsed sizes and the pass is strictly linear.
 */
export function estimateOpenUIProgram(
  source: string,
  budget: OpenUIProgramBudget = OPENUI_PROGRAM_BUDGET,
): OpenUIProgramEstimate {
  // Saturation point: once a value passes 10x the node budget the program is
  // already rejected, so carrying (possibly astronomically large) totals
  // further is pointless.
  const cap = budget.maxNodes * 10
  const sizes = new Map<string, number>()
  // Defensive: a non-string must never throw.
  const text = typeof source === 'string' ? source : ''
  const candidates = splitStatements(stripComments(text))

  let nodes = 0
  let statements = 0

  for (const line of candidates) {
    const match = STATEMENT_RE.exec(line)
    if (match === null) continue
    const name = match[1]
    const expression = match[2]
    if (name === undefined || expression === undefined) continue
    statements += 1

    let size = 1
    TOKEN_RE.lastIndex = 0
    for (let token = TOKEN_RE.exec(expression); token !== null; token = TOKEN_RE.exec(expression)) {
      const tokenText = token[0]
      if (tokenText === undefined) break
      // A reference to an already-defined name contributes that name's size;
      // an unknown name, string or number contributes a single node. Only
      // identifier tokens can name a definition (strings start with `"`/`'`,
      // numbers with a digit).
      const first = tokenText.charCodeAt(0)
      const identifierish =
        (first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95 || first === 36
      const referenced = identifierish ? sizes.get(tokenText) : undefined
      size += referenced ?? 1
      if (size >= cap) {
        size = cap
        break
      }
    }

    sizes.set(name, size)
    nodes += size
    if (nodes >= cap) nodes = cap
    // Both limits are already exceeded, so the verdict can no longer change.
    if (nodes >= cap && statements > budget.maxStatements) break
  }

  return {
    ok: nodes <= budget.maxNodes && statements <= budget.maxStatements,
    nodes,
    statements,
  }
}