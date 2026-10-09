/**
 * W1-12 (#1509) — Deterministic ids for the rule engine (TECH-SPEC §14.3,
 * §17.2 "deterministic UUIDv5 ids").
 *
 * Idempotent rules need ids that are stable across replays, retries and
 * process restarts: the daily-link block id is `uuidv5(key + ':daily-link')`,
 * the R3 welcome message is `uuidv5(principal, 'welcome')`, starter content
 * uses uuidv5 ids. This module is dependency-free and isomorphic (Bun, Node,
 * Electron renderer): SHA-1 is implemented here rather than importing
 * `node:crypto`.
 */

/** ROX namespace for automation ids (stable forever — changing it re-keys every derived id). */
export const ROX_UUID_NAMESPACE = '3f2a1c1e-9b7d-4a5e-8f6c-1d0e2b3a4c5d'

/** Standard RFC 4122 namespaces (test vectors, third-party ids). */
export const UUID_NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
export const UUID_NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

const HEX = '0123456789abcdef'

function uuidBytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += HEX[byte >> 4]! + HEX[byte & 0x0f]!
  return out
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`Invalid uuid: ${uuid}`)
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = uuidBytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const SHA1_K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6] as const

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

/** RFC 3174 SHA-1 over UTF-8 bytes (isomorphic; no `node:crypto`). */
export function sha1Bytes(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8
  const padded = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64)
  padded.set(input)
  padded[input.length] = 0x80
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
  view.setUint32(padded.length - 4, bitLength >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(block + index * 4)
    for (let index = 16; index < 80; index += 1) w[index] = rotateLeft(w[index - 3]! ^ w[index - 8]! ^ w[index - 14]! ^ w[index - 16]!, 1)

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let index = 0; index < 80; index += 1) {
      const round = (index / 20) | 0
      let f: number
      if (round === 0) {
        f = (b & c) | (~b & d)
      } else if (round === 1) {
        f = b ^ c ^ d
      } else if (round === 2) {
        f = (b & c) | (b & d) | (c & d)
      } else {
        f = b ^ c ^ d
      }
      const k = SHA1_K[round]!
      const temp = (rotateLeft(a, 5) + f + e + k + w[index]!) >>> 0
      e = d
      d = c
      c = rotateLeft(b, 30)
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const digest = new Uint8Array(20)
  const digestView = new DataView(digest.buffer)
  digestView.setUint32(0, h0)
  digestView.setUint32(4, h1)
  digestView.setUint32(8, h2)
  digestView.setUint32(12, h3)
  digestView.setUint32(16, h4)
  return digest
}

/** RFC 4122 v5 (SHA-1 name-based) UUID over `name` in `namespace`. */
export function uuidv5(name: string, namespace: string = ROX_UUID_NAMESPACE): string {
  const namespaceBytes = uuidToBytes(namespace)
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length)
  input.set(namespaceBytes)
  input.set(nameBytes, namespaceBytes.length)
  const digest = sha1Bytes(input).slice(0, 16)
  digest[6] = ((digest[6]! & 0x0f) | 0x50) & 0xff
  digest[8] = ((digest[8]! & 0x3f) | 0x80) & 0xff
  return bytesToUuid(digest)
}