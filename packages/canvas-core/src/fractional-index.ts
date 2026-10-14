/**
 * Fractional z-order keys: base-62 digit strings read as fractions in (0, 1),
 * compared lexicographically. Reordering rewrites one object's key only, so
 * concurrent reorders never conflict in the CRDT. Valid keys are non-empty and
 * never end with '0', which guarantees a key strictly between any two keys.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

function digit(c: string): number {
  const v = DIGITS.indexOf(c)
  if (v < 0) throw new Error(`fractional-index: invalid digit "${c}"`)
  return v
}

export function isValidIndexKey(key: string): boolean {
  if (key.length === 0 || key.endsWith('0')) return false
  for (const c of key) if (DIGITS.indexOf(c) < 0) return false
  return true
}

/** a < b, both digit strings without trailing zeros; b === null means 1. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
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
  return midpoint(a ?? '', b)
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
