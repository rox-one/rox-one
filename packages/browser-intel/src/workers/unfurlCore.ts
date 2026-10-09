/**
 * Pure URL decoder for the unfurl stage.
 *
 * Mirrors the node/edge semantics of the `dfir-unfurl` engine
 * (https://github.com/obsidianforensics/unfurl) without any of its I/O: no
 * network lookups, no warning lists, no HTTP requests. Given a URL string it
 * returns a flat list of decoded tokens, and {@link buildUnfurlGraph} turns
 * that list back into the parent/child graph the DB and the renderer consume.
 *
 * Every decoder is bounded by {@link UnfurlLimits}: a node count, a recursion
 * depth, a decoded-byte budget and a raw-token budget. Whenever one of those is
 * hit `truncated` is set, so a hostile or merely pathological URL fills the
 * caps instead of the heap. The module never throws out of {@link unfurlUrl}:
 * a URL that cannot be parsed becomes an `error` on the result, because the
 * worker persists the row either way.
 *
 * Node id convention: the root URL node is always id `'1'`; a decoded token at
 * index `i` (`tokens[i]`) is id `String(i + 2)`. A token's `parentId` therefore
 * points at the root (`'1'`) or at another token's `i + 2` id. Tokens are
 * emitted parent-before-child, so ids are topological and `buildUnfurlGraph`
 * can rebuild the exact same numbering from the array alone.
 */

import { describeUrl } from '../url.ts'
import type {
  UnfurlEdge,
  UnfurlGraph,
  UnfurlIdentifier,
  UnfurlNode,
  UnfurlResult,
  UnfurlTimestamp,
} from '../types.ts'

export interface UnfurlLimits {
  /** Hard ceiling on graph nodes (root included). */
  maxNodes: number
  /** How deep a decoded value may be re-scanned. */
  maxDepth: number
  /** Cumulative budget for decoded payload bytes. */
  maxDecodeBytes: number
  /** How many raw decodable tokens are collected before truncating. */
  maxTokens: number
}

export const DEFAULT_UNFURL_LIMITS: UnfurlLimits = {
  maxNodes: 256,
  maxDepth: 6,
  maxDecodeBytes: 64 * 1024,
  maxTokens: 128,
}

/** One decoded token, before it is given a graph node id. */
export interface ExtractedToken {
  dataType: string
  key: string | null
  value: string
  decoder: string
  parentId: string | null
  label: string
  hover: string | null
}

// ---------------------------------------------------------------------------
// Character classes / patterns
// ---------------------------------------------------------------------------

const B64_URLSAFE_RE = /^[A-Za-z0-9_-]+={0,2}$/
const B64_STANDARD_RE = /^[A-Za-z0-9+/]+={0,2}$/
const B32_RE = /^[A-Z2-7]+={0,6}$/
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/
const HEX_RE = /^(?:[0-9a-fA-F]{2})+$/
const DIGITS_RE = /^\d+$/
const LETTERS_RE = /^[A-Za-z]+$/
const HAS_PERCENT_RE = /%[0-9a-f]{2}/i
const JWT_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6_RE = /^[0-9a-f:]+$/i
const MAC_RE = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i
const MAC_COMPACT_RE = /^[0-9a-f]{12}$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[A-Za-z]{2,}$/
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

/** Hosts whose `q`-style parameter is a user search phrase. */
const SEARCH_HOSTS = [
  'google.com',
  'bing.com',
  'duckduckgo.com',
  'yandex.ru',
  'yandex.com',
  'search.brave.com',
  'ecosia.org',
  'startpage.com',
] as const

/** Parameter names that carry a search phrase on those hosts. */
const SEARCH_PARAMS = new Set(['q', 'query', 'p', 'search', 'text', 'wd', 'k', 'search_query'])

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function bytesToPrintableAscii(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null
  let out = ''
  for (const byte of bytes) {
    // Tab/newline/CR plus visible ASCII; anything else is not a text payload.
    if (!(byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e))) return null
    out += String.fromCharCode(byte)
  }
  return out
}

function bytesToUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

function decodeBase32(value: string): Uint8Array | null {
  const stripped = value.replace(/=+$/, '').toUpperCase()
  const remainder = stripped.length % 8
  // Base32 encodes 5 bytes into 8 chars; these remainders are impossible.
  if (remainder === 1 || remainder === 3 || remainder === 6) return null
  let bits = 0
  let bitCount = 0
  const out: number[] = []
  for (const char of stripped) {
    const index = B32_ALPHABET.indexOf(char)
    if (index < 0) return null
    bits = (bits << 5) | index
    bitCount += 5
    if (bitCount >= 8) {
      bitCount -= 8
      out.push((bits >> bitCount) & 0xff)
    }
  }
  return out.length > 0 ? Uint8Array.from(out) : null
}

function decodeBase58(value: string): Uint8Array | null {
  let number = 0n
  for (const char of value) {
    const index = B58_ALPHABET.indexOf(char)
    if (index < 0) return null
    number = number * 58n + BigInt(index)
  }
  const body: number[] = []
  while (number > 0n) {
    body.unshift(Number(number & 0xffn))
    number >>= 8n
  }
  let leadingZeros = 0
  for (const char of value) {
    if (char === '1') leadingZeros += 1
    else break
  }
  const out = new Uint8Array(leadingZeros + body.length)
  out.set(body, leadingZeros)
  return out.length > 0 ? out : null
}

function decodeBase64(value: string): Uint8Array | null {
  const stripped = value.replace(/=+$/, '')
  if (stripped.length % 4 === 1) return null
  if (!B64_URLSAFE_RE.test(value) && !B64_STANDARD_RE.test(value)) return null
  try {
    const padded = stripped + '='.repeat((4 - (stripped.length % 4)) % 4)
    // Node/Bun's base64 decoder accepts the URL-safe alphabet too, so one call
    // covers standard, URL-safe and missing-padding inputs.
    const bytes = Uint8Array.from(Buffer.from(padded, 'base64'))
    return bytes.length > 0 ? bytes : null
  } catch {
    return null
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function decodeComponent(value: string, plusIsSpace: boolean): string | null {
  try {
    const prepared = plusIsSpace ? value.replace(/\+/g, '%20') : value
    const decoded = decodeURIComponent(prepared)
    return decoded === value ? null : decoded
  } catch {
    // A malformed escape is not worth failing the whole URL over.
    return null
  }
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isSearchHost(host: string): boolean {
  return SEARCH_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))
}

function scalarToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value) ?? ''
  return String(value)
}

// ---------------------------------------------------------------------------
// Decode state
// ---------------------------------------------------------------------------

interface EmittedNode {
  dataType: string
  value: string
  parentIndex: number
}

interface DecodeTask {
  /** Index into `state.tokens`, or -1 for the root URL node (id `'1'`). */
  index: number
  dataType: string
  key: string | null
  value: string
  depth: number
}

interface TimestampDecode {
  kind: string
  epochMs: number
  iso: string
}

interface DecodeState {
  limits: UnfurlLimits
  tokens: ExtractedToken[]
  emitted: EmittedNode[]
  timestamps: UnfurlTimestamp[]
  identifiers: UnfurlIdentifier[]
  rawTokens: string[]
  truncated: boolean
  bytesDecoded: number
}

interface ChildSpec {
  dataType: string
  key?: string | null
  value: string
  decoder: string
  parent: number
  depth: number
  label?: string
  hover?: string | null
}

function defaultLabel(key: string | null, value: string): string {
  if (key && value) return `${key}: ${value}`
  if (value) return value
  if (key) return `${key}:`
  return '(empty)'
}

/**
 * Append a token, if the node budget allows it.
 *
 * Returns the token's array index, or -1 when the graph is full (in which case
 * `truncated` is set and the caller must not enqueue children for it).
 */
function emit(state: DecodeState, spec: ChildSpec): number {
  if (state.tokens.length + 1 >= state.limits.maxNodes) {
    state.truncated = true
    return -1
  }
  const index = state.tokens.length
  const parentId = spec.parent < 0 ? '1' : String(spec.parent + 2)
  state.tokens.push({
    dataType: spec.dataType,
    key: spec.key ?? null,
    value: spec.value,
    decoder: spec.decoder,
    parentId,
    label: spec.label ?? defaultLabel(spec.key ?? null, spec.value),
    hover: spec.hover ?? null,
  })
  state.emitted.push({ dataType: spec.dataType, value: spec.value, parentIndex: spec.parent })
  return index
}

/** Loop guard: refuse a child whose (type, value) already appears on its chain. */
function isRepeatedAncestor(state: DecodeState, parentIndex: number, dataType: string, value: string): boolean {
  let cursor = parentIndex
  let guard = 0
  while (cursor >= 0 && guard < state.limits.maxNodes) {
    const node = state.emitted[cursor]
    if (!node) break
    if (node.dataType === dataType && node.value === value) return true
    cursor = node.parentIndex
    guard += 1
  }
  return false
}

function pushChild(state: DecodeState, queue: DecodeTask[], spec: ChildSpec): number {
  if (isRepeatedAncestor(state, spec.parent, spec.dataType, spec.value)) return -1
  const index = emit(state, spec)
  if (index < 0) return -1
  queue.push({ index, dataType: spec.dataType, key: spec.key ?? null, value: spec.value, depth: spec.depth })
  return index
}

function recordToken(state: DecodeState, raw: string): void {
  if (raw.length === 0 || state.rawTokens.includes(raw)) return
  if (state.rawTokens.length >= state.limits.maxTokens) {
    state.truncated = true
    return
  }
  state.rawTokens.push(raw)
}

/** Charge decoded bytes against the budget; returns false when the cap is hit. */
function chargeBytes(state: DecodeState, bytes: Uint8Array): boolean {
  if (state.bytesDecoded + bytes.length > state.limits.maxDecodeBytes) {
    state.truncated = true
    return false
  }
  state.bytesDecoded += bytes.length
  return true
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

function buildTimestamp(kind: string, epochMs: number): TimestampDecode {
  const safe = Number.isFinite(epochMs) ? epochMs : 0
  const date = new Date(safe)
  return { kind, epochMs: safe, iso: Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString() }
}

function decodeTimestamp(value: string): TimestampDecode | null {
  if (DIGITS_RE.test(value)) {
    const number = Number(value)
    if (value.length === 10 && number >= 1262304000 && number <= 1893456000) return buildTimestamp('unix-seconds', number * 1000)
    if (value.length === 13 && number >= 1420070400000 && number <= 1893456000000) return buildTimestamp('unix-millis', number)
    // Mozilla PRTime is microseconds since the Unix epoch, the same unit as
    // `unix-micros`; the number alone cannot distinguish the two.
    if (value.length === 16 && number >= 1420070400000000 && number <= 1893456000000000) return buildTimestamp('unix-micros', number / 1000)
    if (value.length === 17 && number >= 13064544000000000 && number <= 13537929600000000) {
      return buildTimestamp('webkit-micros', number / 1000 - 11644473600000)
    }
    return null
  }
  if (ISO_RE.test(value)) {
    const parsed = Date.parse(value.includes(' ') ? value.replace(' ', 'T') : value)
    if (Number.isFinite(parsed)) return buildTimestamp('iso8601', parsed)
  }
  return null
}

// ---------------------------------------------------------------------------
// Binary decoders
// ---------------------------------------------------------------------------

function emitDecodedBytes(
  state: DecodeState,
  queue: DecodeTask[],
  task: DecodeTask,
  bytes: Uint8Array,
  decoder: string,
  raw: string,
): void {
  if (!chargeBytes(state, bytes)) return
  recordToken(state, raw)
  const printable = bytesToPrintableAscii(bytes)
  if (printable) {
    pushChild(state, queue, { dataType: 'string', value: printable, decoder, parent: task.index, depth: task.depth + 1 })
    return
  }
  scanProtobuf(state, queue, task, bytes, decoder)
}

/**
 * Heuristic protobuf wire-format walk.
 *
 * A decoded binary blob is scanned field by field: varint keys give a field
 * number and wire type, and any length-delimited payload that looks like text
 * is surfaced. This is deliberately shallow — the extracted strings are pushed
 * back on the queue (so a nested URL or timestamp inside a proto blob still
 * resolves) but no schema is assumed.
 */
function scanProtobuf(
  state: DecodeState,
  queue: DecodeTask[],
  task: DecodeTask,
  bytes: Uint8Array,
  decoder: string,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  let fields = 0
  const maxFields = 64

  const readVarint = (): bigint | null => {
    let result = 0n
    let shift = 0n
    while (offset < bytes.length && shift <= 63n) {
      const byte = view.getUint8(offset)
      offset += 1
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result
      shift += 7n
    }
    return null
  }

  while (offset < bytes.length && fields < maxFields) {
    const key = readVarint()
    if (key === null) return
    const fieldNumber = Number(key >> 3n)
    const wireType = Number(key & 0x07n)
    if (fieldNumber <= 0) return
    fields += 1

    if (wireType === 0) {
      if (readVarint() === null) return
    } else if (wireType === 1) {
      if (offset + 8 > bytes.length) return
      offset += 8
    } else if (wireType === 2) {
      const length = readVarint()
      if (length === null) return
      const size = Number(length)
      if (offset + size > bytes.length) return
      const chunk = bytes.subarray(offset, offset + size)
      offset += size
      const text = bytesToUtf8(chunk) ?? bytesToPrintableAscii(chunk)
      if (text) {
        pushChild(state, queue, {
          dataType: 'protobuf.string',
          key: String(fieldNumber),
          value: text,
          decoder,
          parent: task.index,
          depth: task.depth + 1,
        })
      }
    } else if (wireType === 5) {
      if (offset + 4 > bytes.length) return
      offset += 4
    } else {
      // Groups (3/4) are unused in modern protobuf; stop rather than guess.
      return
    }
  }
  if (fields >= maxFields) state.truncated = true
}

// ---------------------------------------------------------------------------
// String decoders
// ---------------------------------------------------------------------------

function tryBase64(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  const explicit = task.dataType === 'base64'
  const stripped = value.replace(/=+$/, '')
  if (stripped.length < (explicit ? 1 : 8)) return
  if (!explicit && (LETTERS_RE.test(value) || DIGITS_RE.test(value))) return
  const bytes = decodeBase64(value)
  if (!bytes) return
  emitDecodedBytes(state, queue, task, bytes, 'base64', value)
}

function tryBase32(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  const explicit = task.dataType === 'base32'
  if (!B32_RE.test(value)) return
  const stripped = value.replace(/=+$/, '')
  if (!explicit && (LETTERS_RE.test(stripped) || stripped.length < 8)) return
  const bytes = decodeBase32(value)
  if (!bytes) return
  emitDecodedBytes(state, queue, task, bytes, 'base32', value)
}

function tryBase58(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  const explicit = task.dataType === 'base58'
  if (!B58_RE.test(value)) return
  if (!explicit && (LETTERS_RE.test(value) || value.length < 16)) return
  const bytes = decodeBase58(value)
  if (!bytes) return
  if (!chargeBytes(state, bytes)) return
  recordToken(state, value)
  const printable = bytesToPrintableAscii(bytes)
  if (printable) {
    pushChild(state, queue, { dataType: 'string', value: printable, decoder: 'base58', parent: task.index, depth: task.depth + 1 })
  } else if (explicit) {
    scanProtobuf(state, queue, task, bytes, 'base58')
  }
}

function tryHex(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  if (!HEX_RE.test(value)) return
  if (!/[a-f]/i.test(value) || !/\d/.test(value)) return
  const bytes = Uint8Array.from(Buffer.from(value, 'hex'))
  if (bytes.length === 0) return
  if (!chargeBytes(state, bytes)) return
  recordToken(state, value)
  const printable = bytesToPrintableAscii(bytes)
  if (printable) {
    pushChild(state, queue, { dataType: 'string', value: printable, decoder: 'hex', parent: task.index, depth: task.depth + 1 })
  } else {
    scanProtobuf(state, queue, task, bytes, 'hex')
  }
}

function tryJwt(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  if (!JWT_RE.test(value)) return
  const [encodedHeader, encodedPayload, encodedSignature] = value.split('.') as [string, string, string]
  const headerBytes = decodeBase64(encodedHeader)
  const headerText = headerBytes ? bytesToUtf8(headerBytes) : null
  if (!headerText) return
  const header = parseJson(headerText)
  // RFC 7515 requires a JOSE header carrying `alg`; anything else merely looks
  // like a JWT (ordinary dotted path segments decode to the same shape).
  if (header === undefined || header === null || typeof header !== 'object' || Array.isArray(header)) return
  if (!('alg' in (header as Record<string, unknown>))) return

  recordToken(state, value)
  pushChild(state, queue, {
    dataType: 'jwt.header',
    key: 'JWT Header',
    value: headerText,
    decoder: 'jwt',
    parent: task.index,
    depth: task.depth + 1,
    hover: 'The header identifies which algorithm is used to generate the signature.',
  })
  const payloadBytes = decodeBase64(encodedPayload)
  const payloadText = payloadBytes ? bytesToUtf8(payloadBytes) : null
  pushChild(state, queue, {
    dataType: 'jwt.payload',
    key: 'JWT Payload',
    value: payloadText ?? encodedPayload,
    decoder: 'jwt',
    parent: task.index,
    depth: task.depth + 1,
    hover: 'The payload contains the token claims.',
  })
  pushChild(state, queue, {
    dataType: 'jwt.signature',
    key: 'JWT Signature',
    value: encodedSignature,
    decoder: 'jwt',
    parent: task.index,
    depth: task.depth + 1,
  })
}

function tryJson(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  if (value.length < 2) return
  const first = value[0]
  if (first !== '{' && first !== '[') return
  const parsed = parseJson(value)
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') return
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      pushChild(state, queue, { dataType: 'json', value: scalarToString(item), decoder: 'json', parent: task.index, depth: task.depth + 1 })
    }
    return
  }
  for (const [key, item] of Object.entries(parsed as Record<string, unknown>)) {
    pushChild(state, queue, { dataType: 'json', key, value: scalarToString(item), decoder: 'json', parent: task.index, depth: task.depth + 1 })
  }
}

// ---------------------------------------------------------------------------
// Value classifiers
// ---------------------------------------------------------------------------

function tryTimestamp(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  if (!DIGITS_RE.test(value) && !ISO_RE.test(value)) return
  const decoded = decodeTimestamp(value)
  if (!decoded) return
  const index = pushChild(state, queue, {
    dataType: `timestamp.${decoded.kind}`,
    key: task.key,
    value: decoded.iso,
    decoder: 'timestamp',
    parent: task.index,
    depth: task.depth + 1,
    hover: `Converted as ${decoded.kind}`,
  })
  if (index < 0) return
  state.timestamps.push({ raw: value, kind: decoded.kind, epochMs: decoded.epochMs, iso: decoded.iso, nodeId: String(index + 2) })
}

function tryHash(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  if (!HEX_RE.test(value)) return
  if (!/[a-f]/i.test(value) || !/\d/.test(value)) return
  const kind =
    value.length === 32
      ? 'md5'
      : value.length === 40
        ? 'sha-1'
        : value.length === 64
          ? 'sha-256'
          : value.length === 128
            ? 'sha-512'
            : null
  if (!kind) return
  // A 32-char value whose 13th nibble is 4 is far more likely a UUIDv4.
  if (value.length === 32 && /^[0-9a-f]{12}4/i.test(value)) return
  const index = pushChild(state, queue, {
    dataType: `hash.${kind}`,
    key: `${kind.toUpperCase()} Hash`,
    value,
    decoder: 'hash',
    parent: task.index,
    depth: task.depth + 1,
    hover: `This is potentially a ${kind.toUpperCase()} hash (based on length and character set).`,
  })
  if (index >= 0) state.identifiers.push({ kind: `hash.${kind}`, value, nodeId: String(index + 2) })
}

function tryIdentifiers(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  const emitIdentifier = (dataType: string, kind: string, display: string): void => {
    const index = pushChild(state, queue, { dataType, value: display, decoder: 'identifier', parent: task.index, depth: task.depth + 1 })
    if (index >= 0) state.identifiers.push({ kind, value: display, nodeId: String(index + 2) })
  }

  if (IPV4_RE.test(value) && value.split('.').every((part) => Number(part) <= 255)) {
    emitIdentifier('ip', 'ip', value)
    return
  }
  if (value.includes(':') && value.length >= 2 && IPV6_RE.test(value)) {
    emitIdentifier('ip', 'ip', value)
    return
  }
  if (UUID_RE.test(value)) {
    emitIdentifier('uuid', 'uuid', value)
    return
  }
  if (EMAIL_RE.test(value)) {
    emitIdentifier('email', 'email', value)
    return
  }
  if (MAC_RE.test(value)) {
    emitIdentifier('mac-address', 'mac-address', value.toUpperCase())
    return
  }
  if (MAC_COMPACT_RE.test(value)) {
    const pretty = value.toUpperCase().match(/../g)!.join(':')
    emitIdentifier('mac-address', 'mac-address', pretty)
    return
  }
  const hostLike = task.dataType === 'url.hostname' || task.dataType === 'string'
  if (hostLike && DOMAIN_RE.test(value)) {
    const domain = value.toLowerCase().replace(/^www\./, '')
    emitIdentifier('url.domain', 'domain', domain)
  }
}

// ---------------------------------------------------------------------------
// Scheme-specific decoders
// ---------------------------------------------------------------------------

function tryMailto(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const body = task.value.slice('mailto:'.length)
  if (body.length === 0) return
  const question = body.indexOf('?')
  const addressPart = question < 0 ? body : body.slice(0, question)
  const queryPart = question < 0 ? '' : body.slice(question + 1)

  if (addressPart.length > 0) {
    for (const raw of addressPart.split(',')) {
      const address = decodeComponent(raw, false) ?? raw
      if (address.length > 0) {
        pushChild(state, queue, { dataType: 'email', key: 'to', value: address, decoder: 'mailto', parent: task.index, depth: task.depth + 1 })
      }
    }
  }
  for (const chunk of queryPart.split('&')) {
    if (chunk.length === 0) continue
    const equals = chunk.indexOf('=')
    const key = equals < 0 ? chunk : chunk.slice(0, equals)
    const rawValue = equals < 0 ? '' : chunk.slice(equals + 1)
    const value = decodeComponent(rawValue, true) ?? rawValue
    const isAddress = key === 'to' || key === 'cc' || key === 'bcc'
    pushChild(state, queue, {
      dataType: isAddress ? 'email' : 'url.query.pair',
      key,
      value,
      decoder: 'mailto',
      parent: task.index,
      depth: task.depth + 1,
    })
  }
}

function tryMagnet(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const body = task.value.slice('magnet:'.length)
  const query = body.startsWith('?') ? body.slice(1) : body
  if (query.length === 0) return
  for (const chunk of query.split('&')) {
    if (chunk.length === 0) continue
    const equals = chunk.indexOf('=')
    const key = equals < 0 ? chunk : chunk.slice(0, equals)
    const rawValue = equals < 0 ? '' : chunk.slice(equals + 1)
    const value = decodeComponent(rawValue, false) ?? rawValue
    const index = pushChild(state, queue, {
      dataType: `magnet.${key}`,
      key,
      value,
      decoder: 'magnet',
      parent: task.index,
      depth: task.depth + 1,
    })
    if (index >= 0 && key === 'xt' && value.length > 0) {
      const segments = value.split(':')
      const hash = segments[segments.length - 1]
      if (hash) state.identifiers.push({ kind: 'magnet.xt', value: hash, nodeId: String(index + 2) })
    }
  }
}

// ---------------------------------------------------------------------------
// URL structure
// ---------------------------------------------------------------------------

function decodeUrlStructure(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const parsed = safeParseUrl(task.value)
  if (!parsed) return
  // Splitting a URL into its RFC 3986 parts is not a decode hop: the parts are
  // the same value, cut up. They inherit the parent's depth so `maxDepth` only
  // bounds how many times a value is actually *decoded* (base64, hex, percent,
  // JSON, a nested URL, …) and a redirector that base64-encodes another URL is
  // not silently cut off. The node budget still bounds structural fan-out.
  const structureDepth = task.depth

  if (parsed.protocol) {
    pushChild(state, queue, {
      dataType: 'url.scheme',
      key: 'Scheme',
      value: parsed.protocol.replace(/:$/, ''),
      decoder: 'url',
      parent: task.index,
      depth: structureDepth,
      hover: 'The URL scheme, per RFC 3986.',
    })
  }

  if (parsed.hostname) {
    const host = parsed.hostname.toLowerCase()
    pushChild(state, queue, {
      dataType: 'url.hostname',
      key: 'Host',
      value: host,
      decoder: 'url',
      parent: task.index,
      depth: structureDepth,
      hover: 'The host subcomponent of the authority, per RFC 3986.',
    })
  }

  const pathname = parsed.pathname
  if (pathname && pathname !== '/') {
    const pathIndex = pushChild(state, queue, {
      dataType: 'url.path',
      value: pathname,
      decoder: 'url',
      parent: task.index,
      depth: structureDepth,
      hover: 'The URL path, per RFC 3986.',
    })
    if (pathIndex >= 0) {
      const segments = pathname.split('/').filter((segment) => segment.length > 0)
      segments.forEach((segment, position) => {
        pushChild(state, queue, {
          dataType: 'url.path.segment',
          key: String(position + 1),
          value: segment,
          decoder: 'url',
          parent: pathIndex,
          depth: structureDepth,
        })
      })
    }
  }

  const search = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search
  if (search.length > 0) {
    const queryIndex = pushChild(state, queue, {
      dataType: 'url.query',
      value: search,
      decoder: 'url',
      parent: task.index,
      depth: structureDepth,
      hover: 'The URL query, per RFC 3986.',
    })
    if (queryIndex >= 0) {
      const host = parsed.hostname.toLowerCase()
      for (const chunk of search.split('&')) {
        if (chunk.length === 0) continue
        const equals = chunk.indexOf('=')
        const rawKey = equals < 0 ? chunk : chunk.slice(0, equals)
        const rawValue = equals < 0 ? '' : chunk.slice(equals + 1)
        const key = decodeComponent(rawKey, true) ?? rawKey
        const pairIndex = pushChild(state, queue, {
          dataType: 'url.query.pair',
          key,
          value: rawValue,
          decoder: 'url',
          parent: queryIndex,
          depth: structureDepth,
        })
        if (pairIndex >= 0 && isSearchHost(host) && SEARCH_PARAMS.has(key)) {
          const phrase = decodeComponent(rawValue, true) ?? rawValue
          pushChild(state, queue, {
            dataType: 'search.query',
            key: 'Search Query',
            value: phrase,
            decoder: 'search',
            parent: pairIndex,
            depth: structureDepth + 1,
          })
        }
      }
    }
  }

  const fragment = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  if (fragment.length > 0) {
    pushChild(state, queue, {
      dataType: 'url.fragment',
      value: fragment,
      decoder: 'url',
      parent: task.index,
      depth: structureDepth,
      hover: 'The URL fragment, per RFC 3986.',
    })
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function expand(state: DecodeState, queue: DecodeTask[], task: DecodeTask): void {
  const value = task.value
  if (value.length === 0) return
  const nextDepth = task.depth + 1
  if (nextDepth > state.limits.maxDepth) {
    state.truncated = true
    return
  }

  if (value.startsWith('mailto:')) {
    tryMailto(state, queue, task)
    return
  }
  if (value.startsWith('magnet:')) {
    tryMagnet(state, queue, task)
    return
  }

  // A non-URL node whose value is itself an absolute URL (a redirect parameter,
  // a decoded payload, …) becomes an explicit `url` child so its structure is
  // parsed there rather than mixed into the parent's children.
  if (task.dataType !== 'url' && safeParseUrl(value)) {
    pushChild(state, queue, { dataType: 'url', value, decoder: 'url', parent: task.index, depth: nextDepth })
    return
  }

  if (task.dataType === 'url') {
    decodeUrlStructure(state, queue, task)
    return
  }

  // Percent-decoding only makes sense off a URL node; "+" is a space only where
  // the value really came from a query string.
  if (HAS_PERCENT_RE.test(value)) {
    const plusIsSpace = task.dataType === 'url.query.pair' || task.dataType === 'search.query'
    const decoded = decodeComponent(value, plusIsSpace)
    if (decoded) {
      pushChild(state, queue, { dataType: 'string', value: decoded, decoder: 'percent', parent: task.index, depth: nextDepth })
    }
  }

  tryJwt(state, queue, task)
  tryJson(state, queue, task)
  tryTimestamp(state, queue, task)
  tryHash(state, queue, task)
  tryIdentifiers(state, queue, task)
  tryBase64(state, queue, task)
  tryBase32(state, queue, task)
  tryBase58(state, queue, task)
  tryHex(state, queue, task)
}

interface DecodeOutcome {
  normalizedUrl: string
  tokens: ExtractedToken[]
  rawTokens: string[]
  timestamps: UnfurlTimestamp[]
  identifiers: UnfurlIdentifier[]
  truncated: boolean
}

function decodeUrl(url: string, limits: UnfurlLimits): DecodeOutcome {
  const parts = describeUrl(url)
  if (!parts) throw new Error(`Unparseable URL: ${url.slice(0, 200)}`)

  const state: DecodeState = {
    limits,
    tokens: [],
    emitted: [],
    timestamps: [],
    identifiers: [],
    rawTokens: [],
    truncated: false,
    bytesDecoded: 0,
  }
  const queue: DecodeTask[] = [{ index: -1, dataType: 'url', key: null, value: parts.rawUrl, depth: 0 }]

  // The node cap already bounds `state.tokens`; this guard only protects the
  // loop itself against a decoder that keeps enqueueing without emitting.
  let iterations = 0
  const maxIterations = limits.maxNodes * 8
  while (queue.length > 0 && iterations < maxIterations) {
    iterations += 1
    const task = queue.shift()
    if (!task) break
    expand(state, queue, task)
  }
  if (iterations >= maxIterations) state.truncated = true

  return {
    normalizedUrl: parts.normalizedUrl,
    tokens: state.tokens,
    rawTokens: state.rawTokens,
    timestamps: state.timestamps,
    identifiers: state.identifiers,
    truncated: state.truncated,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode a URL into a flat, parent-referencing token list.
 *
 * May throw for a value that is not a URL at all; {@link unfurlUrl} is the
 * never-throwing entry point the worker uses.
 */
export function decodeUrlTokens(
  url: string,
  limits: UnfurlLimits = DEFAULT_UNFURL_LIMITS,
): { tokens: ExtractedToken[]; truncated: boolean } {
  const outcome = decodeUrl(url, limits)
  return { tokens: outcome.tokens, truncated: outcome.truncated }
}

/** Longest root-to-leaf chain length in a graph (root alone = 0). */
function graphDepth(graph: UnfurlGraph): number {
  const depthById = new Map<string, number>([['1', 0]])
  let max = 0
  for (const node of graph.nodes) {
    if (node.id === '1') continue
    const parentDepth = node.parentId ? (depthById.get(node.parentId) ?? 0) : 0
    const depth = parentDepth + 1
    depthById.set(node.id, depth)
    if (depth > max) max = depth
  }
  return max
}

/** Materialize the decoded tokens into a Cytoscape-ready directed graph. */
export function buildUnfurlGraph(
  url: string,
  tokens: readonly ExtractedToken[],
  limits: UnfurlLimits = DEFAULT_UNFURL_LIMITS,
): UnfurlGraph {
  const maxTokens = Math.max(0, limits.maxNodes - 1)
  const used = tokens.slice(0, maxTokens)
  const nodes: UnfurlNode[] = [
    { id: '1', dataType: 'url', key: null, value: url, label: url, hover: null, parentId: null, decoder: 'url' },
  ]
  const edges: UnfurlEdge[] = []
  const knownIds = new Set<string>(['1'])

  used.forEach((token, index) => {
    const id = String(index + 2)
    // A truncated token list can reference a parent that was dropped; fall back
    // to the root so the graph stays a valid tree.
    const parentId = token.parentId && knownIds.has(token.parentId) ? token.parentId : '1'
    nodes.push({
      id,
      dataType: token.dataType,
      key: token.key,
      value: token.value,
      label: token.label,
      hover: token.hover,
      parentId,
      decoder: token.decoder,
    })
    edges.push({ id: `e${edges.length + 1}`, source: parentId, target: id, label: null, decoder: token.decoder })
    knownIds.add(id)
  })

  return { nodes, edges }
}

/**
 * Decode one URL into the full unfurl result the worker persists.
 *
 * Never throws: an unparseable URL (or any internal decoder error) is returned
 * as a result whose `error` is set and whose graph is just the root node, so
 * the caller can always write a row.
 */
export function unfurlUrl(url: string, urlId: number, limits: UnfurlLimits = DEFAULT_UNFURL_LIMITS): UnfurlResult {
  const startedAt = Date.now()
  try {
    const outcome = decodeUrl(url, limits)
    const graph = buildUnfurlGraph(url, outcome.tokens, limits)
    return {
      urlId,
      url,
      normalizedUrl: outcome.normalizedUrl,
      graph,
      tokens: outcome.rawTokens,
      timestamps: outcome.timestamps,
      identifiers: outcome.identifiers,
      depth: graphDepth(graph),
      cpuMs: Math.max(0, Date.now() - startedAt),
      truncated: outcome.truncated,
      error: null,
    }
  } catch (error) {
    return {
      urlId,
      url,
      normalizedUrl: url,
      graph: buildUnfurlGraph(url, [], limits),
      tokens: [],
      timestamps: [],
      identifiers: [],
      depth: 0,
      cpuMs: Math.max(0, Date.now() - startedAt),
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}