/** Markdown remains the authority; these byte ranges are disposable projections. */
export type SourceRange = { start: number; end: number }
export type RetainedLine = SourceRange & { contentEnd: number; text: string; eol: string }
export type RetainedSource = {
  version: 1
  bytes: Uint8Array
  text: string
  sourceHash: string
  lines: RetainedLine[]
  frontmatter?: SourceRange & { contentStart: number; contentEnd: number }
  diagnostics: Array<{ code: 'invalidUtf8' | 'malformedFrontmatter'; range: SourceRange }>
}
export type RawSpanPatch = SourceRange & { expected: string; replacement: string }
/** Purpose is part of the reviewed digest, rather than mutable display metadata. */
export type RawSpanPurpose =
  | { kind: 'property'; keyPath: string[]; value: string | number | boolean | null }
  | { kind: 'markerMapping'; markerMappingVersion: 1; authorityEpoch: number }
export type RawSpanPreview = {
  version: 1
  expectedSourceHash: string
  patches: RawSpanPatch[]
  digest: string
  lossReport: { lostBytes: 0; unsupported: string[] }
  purpose?: RawSpanPurpose
}
export type RawSpanError = { status: 'error'; code: 'validation' | 'conflict' | 'unknownFormat' }
export type RawSpanResult =
  | { status: 'ok'; bytes: Uint8Array; text: string; sourceHash: string; changedSpans: SourceRange[]; noOp: boolean }
  | RawSpanError

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
export function utf8Bytes(text: string): Uint8Array { return encoder.encode(text) }
export function utf8Text(bytes: Uint8Array): string { return decoder.decode(bytes) }

// Standard SHA-256, kept browser-safe so renderer previews and native commits
// use the same revision. The constants are fractional roots of the first primes.
const shaConstants: number[] = []
const shaInitial: number[] = []
for (let candidate = 2; shaConstants.length < 64; candidate += 1) {
  let prime = true
  for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) if (candidate % divisor === 0) { prime = false; break }
  if (!prime) continue
  if (shaInitial.length < 8) shaInitial.push((Math.sqrt(candidate) % 1 * 0x100000000) >>> 0)
  shaConstants.push((Math.cbrt(candidate) % 1 * 0x100000000) >>> 0)
}
function rotate(value: number, count: number): number { return (value >>> count) | (value << (32 - count)) }
export function retainedSourceHash(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000), false)
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0, false)
  const hash = [...shaInitial]
  const words = new Uint32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15]!, b = words[index - 2]!
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number]
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + s1 + ch + shaConstants[index]! + words[index]!) >>> 0
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const values = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index += 1) hash[index] = (hash[index]! + values[index]!) >>> 0
  }
  return `sha256:${hash.map(value => value.toString(16).padStart(8, '0')).join('')}`
}

export function retainSource(input: Uint8Array | string): RetainedSource {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : new Uint8Array(input)
  const source: RetainedSource = { version: 1, bytes, text: '', sourceHash: retainedSourceHash(bytes), lines: [], diagnostics: [] }
  try { source.text = utf8Text(bytes) } catch {
    source.diagnostics.push({ code: 'invalidUtf8', range: { start: 0, end: bytes.length } })
    return source
  }
  let start = 0
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 10 && bytes[index] !== 13) continue
    let end = index, eol = ''
    if (index < bytes.length) {
      if (bytes[index] === 13 && bytes[index + 1] === 10) { end = index + 2; eol = '\r\n'; index += 1 }
      else { end = index + 1; eol = bytes[index] === 13 ? '\r' : '\n' }
    }
    if (start < end || source.lines.length === 0) source.lines.push({ start, end, contentEnd: end - eol.length,
      text: utf8Text(bytes.slice(start, end - eol.length)), eol })
    start = end
  }
  const first = source.lines[0]
  if (first && /^---[ \t]*$/.test(first.text.replace(/^\uFEFF/, ''))) {
    const closing = source.lines.slice(1).find(line => /^(?:---|\.\.\.)[ \t]*$/.test(line.text))
    if (!closing) source.diagnostics.push({ code: 'malformedFrontmatter', range: { start: 0, end: bytes.length } })
    else source.frontmatter = { start: 0, end: closing.end, contentStart: first.end, contentEnd: closing.start }
  }
  return source
}

export function retainedText(source: RetainedSource, range: SourceRange): string {
  if (!validRange(range, source.bytes.length)) throw new RangeError('Invalid retained source byte range')
  return utf8Text(source.bytes.slice(range.start, range.end))
}

function validRange(range: SourceRange, length: number): boolean {
  return !!range && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
    && range.start >= 0 && range.end >= range.start && range.end <= length
}
function wellFormedString(value: string): boolean { return utf8Text(utf8Bytes(value)) === value }
function validPurpose(value: RawSpanPurpose | undefined): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  if (value.kind === 'markerMapping') return value.markerMappingVersion === 1
    && Number.isSafeInteger(value.authorityEpoch) && value.authorityEpoch >= 1
  return value.kind === 'property' && Array.isArray(value.keyPath) && value.keyPath.length > 0
    && value.keyPath.every(key => typeof key === 'string' && key.length > 0 && wellFormedString(key))
    && (value.value === null || typeof value.value === 'boolean'
      || (typeof value.value === 'number' && Number.isFinite(value.value))
      || (typeof value.value === 'string' && wellFormedString(value.value)))
}
function copyPurpose(purpose: RawSpanPurpose | undefined): RawSpanPurpose | undefined {
  if (!purpose) return undefined
  return purpose.kind === 'property'
    ? { kind: 'property', keyPath: [...purpose.keyPath], value: purpose.value }
    : { kind: 'markerMapping', markerMappingVersion: 1, authorityEpoch: purpose.authorityEpoch }
}
export function rawSpanPreviewDigest(expectedSourceHash: string, patches: readonly RawSpanPatch[], purpose?: RawSpanPurpose): string {
  // JSON represents -0 as 0; retain this typed distinction in the semantic purpose.
  const semanticPurpose = purpose?.kind === 'property' && Object.is(purpose.value, -0)
    ? { ...purpose, value: { negativeZero: true } } : purpose
  return retainedSourceHash(JSON.stringify({ version: 1, expectedSourceHash,
    patches: patches.map(({ start, end, expected, replacement }) => ({ start, end, expected, replacement })),
    ...(semanticPurpose ? { purpose: semanticPurpose } : {}) }))
}
export function previewRawSpanPatches(source: RetainedSource, input: readonly RawSpanPatch[], options: {
  expectedSourceHash?: string; purpose?: RawSpanPurpose
} = {}): RawSpanPreview | RawSpanError {
  if (retainedSourceHash(source.bytes) !== source.sourceHash || (options.expectedSourceHash !== undefined
    && options.expectedSourceHash !== source.sourceHash)) return { status: 'error', code: 'conflict' }
  if (retainSource(source.bytes).diagnostics.length) return { status: 'error', code: 'unknownFormat' }
  if (!Array.isArray(input) || !validPurpose(options.purpose)) return { status: 'error', code: 'validation' }
  // Copy only the wire fields: getters/prototypes and arbitrary metadata are not an edit.
  const patches = input.map(patch => patch && ({ start: patch.start, end: patch.end,
    expected: patch.expected, replacement: patch.replacement })).sort((a, b) => (a?.start ?? -1) - (b?.start ?? -1)
      || (a?.end ?? -1) - (b?.end ?? -1))
  let previous: RawSpanPatch | undefined
  for (const patch of patches) {
    if (!validRange(patch, source.bytes.length) || typeof patch.expected !== 'string' || typeof patch.replacement !== 'string'
      || (previous && (previous.end > patch.start || previous.start === patch.start))) return { status: 'error', code: 'validation' }
    try {
      if (retainedText(source, patch) !== patch.expected) return { status: 'error', code: 'conflict' }
      // Both boundaries must be valid UTF-8 boundaries, including insertions.
      utf8Text(source.bytes.slice(0, patch.start)); utf8Text(source.bytes.slice(patch.end))
      if (!wellFormedString(patch.replacement)) return { status: 'error', code: 'validation' }
    } catch { return { status: 'error', code: 'validation' } }
    previous = patch
  }
  const changed = patches.filter(patch => patch.expected !== patch.replacement)
  const purpose = copyPurpose(options.purpose)
  return { version: 1, expectedSourceHash: source.sourceHash, patches: changed,
    digest: rawSpanPreviewDigest(source.sourceHash, changed, purpose), lossReport: { lostBytes: 0, unsupported: [] },
    ...(purpose ? { purpose } : {}) }
}

export function applyRawSpanPatches(current: RetainedSource, preview: RawSpanPreview): RawSpanResult {
  if (!preview || preview.version !== 1 || !Array.isArray(preview.patches)
    || typeof preview.expectedSourceHash !== 'string' || !validPurpose(preview.purpose)
    || preview.patches.some(patch => !patch || typeof patch.expected !== 'string' || typeof patch.replacement !== 'string')
    || preview.digest !== rawSpanPreviewDigest(preview.expectedSourceHash, preview.patches, preview.purpose)) {
    return { status: 'error', code: 'validation' }
  }
  if (current.sourceHash !== preview.expectedSourceHash || retainedSourceHash(current.bytes) !== current.sourceHash) {
    return { status: 'error', code: 'conflict' }
  }
  const checked = previewRawSpanPatches(current, preview.patches, { purpose: preview.purpose })
  if ('status' in checked) return checked
  const chunks: Uint8Array[] = []
  let position = 0
  for (const patch of checked.patches) {
    chunks.push(current.bytes.slice(position, patch.start), utf8Bytes(patch.replacement))
    position = patch.end
  }
  chunks.push(current.bytes.slice(position))
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  position = 0
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length }
  return { status: 'ok', bytes, text: utf8Text(bytes), sourceHash: retainedSourceHash(bytes),
    changedSpans: checked.patches.map(({ start, end }) => ({ start, end })), noOp: checked.patches.length === 0 }
}

/** Explicit conservative rebase: a concurrent edit touching any selected span conflicts. */
export function rebaseRawSpanPreview(base: RetainedSource, current: RetainedSource, preview: RawSpanPreview): RawSpanPreview | RawSpanError {
  const verified = applyRawSpanPatches(base, preview)
  if (verified.status !== 'ok') return verified
  if (retainedSourceHash(current.bytes) !== current.sourceHash) return { status: 'error', code: 'conflict' }
  if (base.sourceHash === current.sourceHash) return previewRawSpanPatches(current, preview.patches, { purpose: preview.purpose })
  let prefix = 0
  while (prefix < base.bytes.length && prefix < current.bytes.length && base.bytes[prefix] === current.bytes[prefix]) prefix += 1
  let suffix = 0
  while (suffix < base.bytes.length - prefix && suffix < current.bytes.length - prefix
    && base.bytes[base.bytes.length - 1 - suffix] === current.bytes[current.bytes.length - 1 - suffix]) suffix += 1
  const oldEnd = base.bytes.length - suffix
  const delta = current.bytes.length - base.bytes.length
  const patches: RawSpanPatch[] = []
  for (const patch of preview.patches) {
    const touches = patch.start === patch.end
      ? prefix <= patch.start && patch.start <= oldEnd
      : oldEnd === prefix ? patch.start <= prefix && prefix <= patch.end : patch.start < oldEnd && patch.end > prefix
    if (touches) {
      return { status: 'error', code: 'conflict' }
    }
    patches.push(patch.start >= oldEnd ? { ...patch, start: patch.start + delta, end: patch.end + delta } : patch)
  }
  return previewRawSpanPatches(current, patches, { purpose: preview.purpose })
}
