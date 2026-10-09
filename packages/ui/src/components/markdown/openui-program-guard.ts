/**
 * Static cost guard for OpenUI Lang programs.
 *
 * The vendor parser inlines referenced definitions, so a tiny program can
 * expand into an exponentially large tree (`s2 = Card([s1, s1])` chains) and
 * stall the main thread; `Renderer` re-parses on every streaming tick, so one
 * hostile fence is enough to freeze a conversation. This module estimates the
 * expanded size cheaply — one token pass per statement, no parser — so the
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
/**
 * Repetition charged for an `@Each` template whose array cannot be resolved to
 * a literal (a member access like `data.rows`, an `@`-call, an unresolved
 * name). ROX mounts no host data source and never resolves a query, so such an
 * array renders empty at runtime; this bounded factor keeps the estimate an
 * upper bound up to 64 repeats while refusing a heavy template looped over an
 * unbounded array.
 */
const EACH_UNKNOWN_ARRAY_FACTOR = 64
/**
 * Strings, numbers, identifiers and single non-space punctuation characters.
 * The cost model only charges strings/numbers/identifiers (exactly like the
 * original scanner); punctuation is tokenised so {@link evalTokens} can find
 * call arguments, but never adds weight itself.
 */
const TOKEN_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|[^\s]/g

type TokenKind = 'ident' | 'string' | 'number' | 'punct'

interface OpenUIToken {
  text: string
  kind: TokenKind
}

function tokenize(expression: string): OpenUIToken[] {
  const tokens: OpenUIToken[] = []
  TOKEN_RE.lastIndex = 0
  for (let match = TOKEN_RE.exec(expression); match !== null; match = TOKEN_RE.exec(expression)) {
    const text = match[0]
    if (text === undefined || text.length === 0) {
      // Defensive: a zero-width match would spin forever.
      TOKEN_RE.lastIndex += 1
      continue
    }
    const first = text.charCodeAt(0)
    let kind: TokenKind
    if (first === 34 || first === 39) kind = 'string'
    else if (first >= 48 && first <= 57) kind = 'number'
    else if (
      (first >= 65 && first <= 90) ||
      (first >= 97 && first <= 122) ||
      first === 95 ||
      first === 36
    )
      kind = 'ident'
    else kind = 'punct'
    tokens.push({ text, kind })
  }
  return tokens
}

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
 * 0 and no string is open. A line-leading `?` continues the expression (vendor
 * peek rule). A trailing whitespace-only line is never a statement.
 *
 * The vendor peek is resolved lazily: the first depth-0 newline starts a
 * pending boundary, and the *next* non-whitespace character either cancels it
 * (a `?` continuation) or closes the statement. This keeps the scan a single
 * pass — a run of whitespace is never rescanned from every newline it contains
 * (which made a whitespace-only fence quadratic).
 */
function splitStatements(text: string): string[] {
  const statements: string[] = []
  let start = 0
  let pendingBreak = -1
  let depth = 0
  let ternaryDepth = 0
  let quote = ''
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === undefined) continue
    if (escaped) {
      escaped = false
      continue
    }
    if (quote !== '') {
      if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }

    // Resolve a pending newline boundary at the first non-whitespace character.
    if (pendingBreak !== -1 && char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') {
      if (char === '?') {
        // A line-leading `?` continues the expression.
        pendingBreak = -1
      } else {
        const candidate = text.slice(start, pendingBreak).trim()
        if (candidate) statements.push(candidate)
        start = pendingBreak + 1
        pendingBreak = -1
      }
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
    else if (char === '\n' && depth === 0 && ternaryDepth === 0 && pendingBreak === -1) {
      pendingBreak = i
    }
  }

  if (pendingBreak !== -1) {
    const candidate = text.slice(start, pendingBreak).trim()
    if (candidate) statements.push(candidate)
    start = pendingBreak + 1
  }
  const tail = text.slice(start).trim()
  if (tail) statements.push(tail)
  return statements
}

function isOpener(text: string): boolean {
  return text === '(' || text === '[' || text === '{'
}

function isCloser(text: string): boolean {
  return text === ')' || text === ']' || text === '}'
}

/** Index of the token that closes the bracket opened at `openIndex`, or -1. */
function matchClose(tokens: OpenUIToken[], openIndex: number, limit = tokens.length): number {
  let depth = 0
  for (let i = openIndex; i < limit; i += 1) {
    const text = tokens[i]?.text
    if (text === undefined) break
    if (isOpener(text)) depth += 1
    else if (isCloser(text)) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Top-level comma-separated argument ranges of a call opened at `openIndex`. */
function splitArgs(
  tokens: OpenUIToken[],
  openIndex: number,
  closeIndex: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let depth = 0
  let argStart = openIndex + 1
  for (let i = openIndex + 1; i < closeIndex; i += 1) {
    const text = tokens[i]?.text
    if (text === undefined) break
    if (isOpener(text)) depth += 1
    else if (isCloser(text)) depth -= 1
    else if (text === ',' && depth === 0) {
      ranges.push([argStart, i])
      argStart = i + 1
    }
  }
  ranges.push([argStart, closeIndex])
  return ranges
}

/**
 * Element count of a literal array whose tokens are `tokens[lo..hi)`, or -1 if
 * the range is not a single bracketed array.
 */
function literalArrayLength(tokens: OpenUIToken[], lo: number, hi: number): number {
  if (lo >= hi) return -1
  if (tokens[lo]?.text !== '[') return -1
  if (matchClose(tokens, lo, hi) !== hi - 1) return -1
  if (hi - 1 === lo + 1) return 0 // `[]`
  let depth = 0
  let commas = 0
  for (let i = lo + 1; i < hi - 1; i += 1) {
    const text = tokens[i]?.text
    if (text === undefined) break
    if (isOpener(text)) depth += 1
    else if (isCloser(text)) depth -= 1
    else if (text === ',' && depth === 0) commas += 1
  }
  return commas + 1
}

/**
 * Builtins whose result is an array. `Sort` and `Filter` (lang-core
 * dist/index.mjs:360 and :382) never grow their input — `[...arr].sort(...)` and
 * `arr.filter(...)` — so the operand's element count bounds the result. The
 * vendor table has no length-growing array builtin (`@Range`, `@Repeat`,
 * `@Split`, `@Map`, `@Concat`, `@Push`, `@Slice` do not exist).
 */
const ARRAY_RETURNING_BUILTINS: Record<string, true> = { Sort: true, Filter: true }

/**
 * Statically-resolvable element count of an array expression, or -1 when the
 * expression is not a literal array, a reference (possibly chained) to one, or
 * an array-returning builtin call over a resolvable operand.
 */
function resolvableArrayLength(
  tokens: OpenUIToken[],
  lo: number,
  hi: number,
  defs: Map<string, string>,
  seen: Set<string>,
): number {
  const literal = literalArrayLength(tokens, lo, hi)
  if (literal >= 0) return literal
  let start = lo
  // `@Builtin(...)` carries the `@` as a separate punctuation token.
  if (tokens[start]?.text === '@') start += 1
  const head = tokens[start]
  if (head !== undefined && head.kind === 'ident' && tokens[start + 1]?.text === '(') {
    if (ARRAY_RETURNING_BUILTINS[head.text] !== true) return -1
    const closeIndex = matchClose(tokens, start + 1, hi)
    if (closeIndex === -1) return -1
    const operand = splitArgs(tokens, start + 1, closeIndex)[0]
    if (operand === undefined || operand[0] >= operand[1]) return -1
    return resolvableArrayLength(tokens, operand[0], operand[1], defs, seen)
  }
  if (hi - lo === 1 && head !== undefined && head.kind === 'ident' && defs.has(head.text)) {
    const name = head.text
    if (seen.has(name)) return -1
    seen.add(name)
    const body = defs.get(name)
    let length = -1
    if (body !== undefined) {
      const bodyTokens = tokenize(body)
      length = resolvableArrayLength(bodyTokens, 0, bodyTokens.length, defs, seen)
    }
    seen.delete(name)
    return length
  }
  return -1
}

/**
 * The number of elements an `@Each` array expression iterates. A literal array
 * or a reference (possibly chained) to a literal array resolves exactly, and an
 * array-returning builtin (`@Filter`/`@Sort`) resolves through its operand. An
 * array the scanner cannot see is charged {@link EACH_UNKNOWN_ARRAY_FACTOR} —
 * ROX mounts no host data source and never resolves a query, so a directly
 * unresolved array renders empty at runtime — while a builtin over an
 * unresolvable operand saturates (Infinity) so an indirect fan-out is rejected
 * rather than under-charged.
 */
function elementCount(
  tokens: OpenUIToken[],
  lo: number,
  hi: number,
  defs: Map<string, string>,
  seen: Set<string>,
): number {
  const resolved = resolvableArrayLength(tokens, lo, hi, defs, seen)
  if (resolved >= 0) return resolved
  let start = lo
  if (tokens[start]?.text === '@') start += 1
  const head = tokens[start]
  if (
    head !== undefined &&
    head.kind === 'ident' &&
    ARRAY_RETURNING_BUILTINS[head.text] === true &&
    tokens[start + 1]?.text === '('
  ) {
    return Number.POSITIVE_INFINITY
  }
  return EACH_UNKNOWN_ARRAY_FACTOR
}

interface LinearCost {
  base: number
  refs: Map<string, number>
}

function mergeLinear(target: LinearCost, source: LinearCost): void {
  target.base += source.base
  for (const [name, weight] of source.refs) {
    target.refs.set(name, (target.refs.get(name) ?? 0) + weight)
  }
}

/**
 * Cost of `tokens[lo..hi)` as a linear form: `base` counts the literal tokens
 * that appear once, `refs` counts how many times each defined name expands
 * (multiplied by `factor`). An `@Each(array, var, template)` call charges its
 * template once per array element, so a >1 element count multiplies the
 * template's tokens and references by that count — this mirrors the vendor,
 * which evaluates the template per element (`arr.map(item => evaluate(...))`).
 */
function evalTokens(
  tokens: OpenUIToken[],
  lo: number,
  hi: number,
  factor: number,
  defs: Map<string, string>,
  cap: number,
): LinearCost {
  const cost: LinearCost = { base: 0, refs: new Map() }
  let i = lo
  while (i < hi) {
    const token = tokens[i]
    if (token === undefined) break
    if (
      token.kind === 'ident' &&
      token.text === 'Each' &&
      tokens[i + 1]?.text === '('
    ) {
      const closeIndex = matchClose(tokens, i + 1, hi)
      if (closeIndex !== -1) {
        const args = splitArgs(tokens, i + 1, closeIndex)
        const arrayArg = args[0]
        const count =
          arrayArg === undefined
            ? EACH_UNKNOWN_ARRAY_FACTOR
            : elementCount(tokens, arrayArg[0], arrayArg[1], defs, new Set())
        // The `Each` call itself is one node.
        cost.base += factor
        // The array and the variable name are evaluated once.
        const arrayTokens = args[0]
        if (arrayTokens !== undefined)
          mergeLinear(cost, evalTokens(tokens, arrayTokens[0], arrayTokens[1], factor, defs, cap))
        const varTokens = args[1]
        if (varTokens !== undefined)
          mergeLinear(cost, evalTokens(tokens, varTokens[0], varTokens[1], factor, defs, cap))
        // Everything from the template argument on is repeated per element.
        const templateFactor = Math.min(cap, factor * count)
        for (let a = 2; a < args.length; a += 1) {
          const templateTokens = args[a]
          if (templateTokens === undefined) continue
          mergeLinear(
            cost,
            evalTokens(tokens, templateTokens[0], templateTokens[1], templateFactor, defs, cap),
          )
        }
        i = closeIndex + 1
        continue
      }
    }

    if (token.kind !== 'punct') {
      if (token.kind === 'ident' && defs.has(token.text)) {
        cost.refs.set(token.text, (cost.refs.get(token.text) ?? 0) + factor)
      } else {
        cost.base += factor
      }
    }
    i += 1
  }
  return cost
}

/**
 * Estimate the post-inlining cost of an OpenUI Lang program.
 *
 * Every `name = expr` statement (last definition wins, exactly like the vendor
 * symbol table) yields a linear cost `base + Σ weight·size(ref)`: literal tokens
 * count once, each reference to another definition counts that definition's
 * fully-expanded size, and an `@Each` template counts once per array element.
 * The sizes are then resolved as a saturation fixed point over that system —
 * iterated from below until no size grows. Because a definition can reference a
 * *later* one, a single forward pass would count those references as 1 and miss
 * the attack; the fixed point sees them all. An acyclic program converges in at
 * most (number of definitions) iterations; a cyclic program never converges and
 * is saturated to the rejection cap (the vendor resolves cycles path-scoped, so
 * an estimate that does not converge cannot be trusted as an upper bound).
 */
export function estimateOpenUIProgram(
  source: string,
  budget: OpenUIProgramBudget = OPENUI_PROGRAM_BUDGET,
): OpenUIProgramEstimate {
  // Saturation point: once a value passes 10x the node budget the program is
  // already rejected, so carrying (possibly astronomically large) totals
  // further is pointless.
  const cap = budget.maxNodes * 10
  // Defensive: a non-string must never throw.
  const text = typeof source === 'string' ? source : ''
  const candidates = splitStatements(stripComments(text))

  const defs = new Map<string, string>()
  let statements = 0
  for (const line of candidates) {
    const match = STATEMENT_RE.exec(line)
    if (match === null) continue
    const name = match[1]
    const expression = match[2]
    if (name === undefined || expression === undefined) continue
    statements += 1
    // Last definition wins, matching the vendor's symbol table.
    defs.set(name, expression)
  }

  const names = [...defs.keys()]
  const base = new Map<string, number>()
  const refs = new Map<string, Map<string, number>>()
  for (const name of names) {
    const expression = defs.get(name)
    const tokens = expression === undefined ? [] : tokenize(expression)
    const cost = evalTokens(tokens, 0, tokens.length, 1, defs, cap)
    base.set(name, Math.min(cap, cost.base + 1))
    refs.set(name, cost.refs)
  }

  // Too many statements is already a rejection; skip the (potentially long)
  // fixed point and report the token total as a cheap lower bound.
  if (statements > budget.maxStatements) {
    let nodes = 0
    for (const value of base.values()) {
      nodes += value
      if (nodes >= cap) {
        nodes = cap
        break
      }
    }
    return { ok: false, nodes, statements }
  }

  const size = new Map<string, number>()
  for (const name of names) size.set(name, base.get(name) ?? 0)

  const maxIterations = names.length + 1
  let converged = names.length === 0
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false
    let nodes = 0
    for (const name of names) {
      let value = base.get(name) ?? 0
      const references = refs.get(name)
      if (references !== undefined) {
        for (const [reference, weight] of references) {
          const referencedSize = size.get(reference)
          if (referencedSize !== undefined) value += weight * referencedSize
        }
      }
      if (value >= cap) value = cap
      if (value > (size.get(name) ?? 0)) {
        size.set(name, value)
        changed = true
      }
      nodes += value
      if (nodes >= cap) nodes = cap
    }
    // The estimate grows monotonically, so once it passes the cap the verdict
    // is already decided and no further iteration can change it.
    if (nodes >= cap) return { ok: false, nodes: cap, statements }
    if (!changed) {
      converged = true
      break
    }
  }

  // A non-converging system means a reference cycle; the vendor's path-scoped
  // resolver keeps such programs finite but potentially enormous, so the honest
  // upper bound is "over budget".
  if (!converged) return { ok: false, nodes: cap, statements }

  let nodes = 0
  for (const name of names) {
    nodes += size.get(name) ?? 0
    if (nodes >= cap) {
      nodes = cap
      break
    }
  }

  return {
    ok: nodes <= budget.maxNodes && statements <= budget.maxStatements,
    nodes,
    statements,
  }
}