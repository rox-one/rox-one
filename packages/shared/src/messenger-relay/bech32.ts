/**
 * Minimal bech32 decoder for NIP-19 `nsec`/`npub` values (BIP-173, no
 * bech32m). Only what the relay bridge needs to accept a human-entered key.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: readonly number[]): number {
  let chk = 1
  for (const value of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i += 1) if ((top >> i) & 1) chk ^= GENERATOR[i]!
  }
  return chk
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (const char of hrp) out.push(char.charCodeAt(0) >> 5)
  out.push(0)
  for (const char of hrp) out.push(char.charCodeAt(0) & 31)
  return out
}

function convertBits(data: readonly number[], from: number, to: number): number[] {
  let accumulator = 0
  let bits = 0
  const out: number[] = []
  const maxValue = (1 << to) - 1
  for (const value of data) {
    if (value < 0 || value >> from !== 0) throw new Error('invalid bech32 data')
    accumulator = (accumulator << from) | value
    bits += from
    while (bits >= to) {
      bits -= to
      out.push((accumulator >> bits) & maxValue)
    }
  }
  if (bits >= from || ((accumulator << (to - bits)) & maxValue) !== 0) throw new Error('invalid bech32 padding')
  return out
}

export interface Bech32Decoded {
  prefix: string
  bytes: Uint8Array
}

/** Decode a bech32 string, returning its human-readable prefix and bytes. */
export function bech32Decode(input: string): Bech32Decoded {
  if (typeof input !== 'string' || input.length < 8 || input.length > 90) throw new Error('invalid bech32 length')
  const lower = input.toLowerCase()
  if (input !== lower && input !== input.toUpperCase()) throw new Error('invalid bech32 case')
  const separator = lower.lastIndexOf('1')
  if (separator < 1 || separator + 7 > lower.length) throw new Error('invalid bech32 separator')
  const prefix = lower.slice(0, separator)
  const data = [...lower.slice(separator + 1)].map(char => {
    const index = CHARSET.indexOf(char)
    if (index === -1) throw new Error('invalid bech32 character')
    return index
  })
  if (polymod([...hrpExpand(prefix), ...data]) !== 1) throw new Error('invalid bech32 checksum')
  return { prefix, bytes: Uint8Array.from(convertBits(data.slice(0, -6), 5, 8)) }
}

/**
 * Accept a 32-byte secret key as 64-char hex or a NIP-19 `nsec1…` value and
 * return the raw 32 bytes. Throws on anything else.
 */
export function parseSecretKey(value: string): Uint8Array {
  const trimmed = value.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Uint8Array.from(Buffer.from(trimmed, 'hex'))
  if (trimmed.toLowerCase().startsWith('nsec1')) {
    const decoded = bech32Decode(trimmed)
    if (decoded.prefix !== 'nsec' || decoded.bytes.length !== 32) throw new Error('invalid nsec')
    return decoded.bytes
  }
  throw new Error('secret key must be 64-char hex or a NIP-19 nsec value')
}
