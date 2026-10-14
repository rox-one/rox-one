/**
 * Fractional z-order keys = integer part + fraction, compared lexicographically.
 *
 * Integer part: a head char giving the digit count, then that many base-62
 * digits. Heads 'a'..'z' are non-negative integers with 1..26 digits, heads
 * 'Z'..'A' negative ones with 1..26 digits (more digits = smaller), so plain
 * string order equals numeric order. Fraction: base-62 digits, never ending
 * in '0'. Appends/prepends just step the integer (keys grow logarithmically);
 * inserts between neighbours extend the fraction. Reordering rewrites one
 * object's key only, so concurrent reorders never conflict in the CRDT.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const ZERO = DIGITS[0]!
const MAX = DIGITS[BASE - 1]!
const SMALLEST_INTEGER = 'A' + ZERO.repeat(26)
const INTEGER_ZERO = 'a' + ZERO

function digit(c: string): number {
  const v = DIGITS.indexOf(c)
  if (v < 0) throw new Error(`fractional-index: invalid digit "${c}"`)
  return v
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2
  throw new Error(`fractional-index: invalid head "${head}"`)
}

function integerPart(key: string): string {
  const n = integerLength(key[0]!)
  if (n > key.length) throw new Error(`fractional-index: invalid key "${key}"`)
  return key.slice(0, n)
}

export function isValidIndexKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key === SMALLEST_INTEGER) return false
  let n: number
  try { n = integerLength(key[0]!) } catch { return false }
  if (key.length < n) return false
  for (let i = 1; i < key.length; i++) if (DIGITS.indexOf(key[i]!) < 0) return false
  const frac = key.slice(n)
  return !frac.endsWith(ZERO)
}

function incrementInteger(x: string): string | null {
  const head = x[0]!
  const digs = x.slice(1).split('')
  for (let i = digs.length - 1; i >= 0; i--) {
    const d = digit(digs[i]!) + 1
    if (d < BASE) { digs[i] = DIGITS[d]!; return head + digs.join('') }
    digs[i] = ZERO
  }
  // carry out of the top digit
  if (head === 'Z') return INTEGER_ZERO
  if (head === 'z') return null
  const h = String.fromCharCode(head.charCodeAt(0) + 1)
  if (h > 'a') digs.push(ZERO)
  else digs.pop()
  return h + digs.join('')
}

function decrementInteger(x: string): string | null {
  const head = x[0]!
  const digs = x.slice(1).split('')
  for (let i = digs.length - 1; i >= 0; i--) {
    const d = digit(digs[i]!) - 1
    if (d >= 0) { digs[i] = DIGITS[d]!; return head + digs.join('') }
    digs[i] = MAX
  }
  if (head === 'a') return 'Z' + MAX
  if (head === 'A') return null
  const h = String.fromCharCode(head.charCodeAt(0) - 1)
  if (h < 'Z') digs.push(MAX)
  else digs.pop()
  return h + digs.join('')
}

/** Fraction strictly between a and b (b null = 1); neither ends in '0'. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? ZERO) === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a.length > 0 ? digit(a[0]!) : 0
  const db = b !== null ? digit(b[0]!) : BASE
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]!
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[da]! + midpoint(a.slice(1), null)
}

/** Key strictly between `a` and `b` (null = open end). Requires a < b. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && !isValidIndexKey(a)) throw new Error(`fractional-index: invalid key "${a}"`)
  if (b !== null && !isValidIndexKey(b)) throw new Error(`fractional-index: invalid key "${b}"`)
  if (a !== null && b !== null && a >= b) throw new Error(`fractional-index: "${a}" >= "${b}"`)
  if (a === null && b === null) return INTEGER_ZERO
  if (a === null) {
    const ib = integerPart(b!)
    const fb = b!.slice(ib.length)
    if (ib === SMALLEST_INTEGER) return ib + midpoint('', fb)
    if (ib < b!) return ib
    const dec = decrementInteger(ib)
    if (dec === null) throw new Error('fractional-index: cannot go lower')
    return dec
  }
  const ia = integerPart(a)
  const fa = a.slice(ia.length)
  if (b === null) {
    const inc = incrementInteger(ia)
    return inc === null ? ia + midpoint(fa, null) : inc
  }
  const ib = integerPart(b)
  const fb = b.slice(ib.length)
  if (ia === ib) return ia + midpoint(fa, fb)
  const inc = incrementInteger(ia)
  if (inc === null) throw new Error('fractional-index: cannot go higher')
  if (inc < b) return inc
  return ia + midpoint(fa, null)
}

/** `n` increasing keys strictly between `a` and `b`. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  const out: string[] = []
  let prev = a
  for (let i = 0; i < n; i++) {
    const k = keyBetween(prev, b)
    out.push(k)
    prev = k
  }
  return out
}
