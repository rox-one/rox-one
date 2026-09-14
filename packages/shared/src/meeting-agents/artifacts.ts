/**
 * Meeting author artifacts and coding handoff (issue #372 / I016, R34/R35).
 * Specialized author sessions write versioned files; verification requires
 * an actual open/parse, not a success string. Notes/Tasks stay their own stores.
 */

import { createHash } from 'node:crypto'
import {
  decodeRox2V2Result,
  isVerifiedEffect,
  type Rox2EntityRef,
  type Rox2V2Result,
} from '@craft-agent/core/rox2'
import {
  authorizeMeetingAction,
  type MeetingActor,
  type MeetingGrant,
} from './policies.ts'

export const ARTIFACT_FORMATS = ['markdown', 'docx', 'pdf', 'csv', 'xlsx', 'pptx', 'research'] as const
export type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number]

export type ArtifactKind = 'document' | 'research' | 'code-handoff'

export const AUTHOR_TOOL_NAMES = [
  'meeting.author',
  'meeting.author.code',
  'meeting.author.csv',
  'meeting.author.docx',
  'meeting.author.markdown',
  'meeting.author.pdf',
  'meeting.author.pptx',
  'meeting.author.research',
  'meeting.author.xlsx',
] as const

export type AuthorToolName = (typeof AUTHOR_TOOL_NAMES)[number]

export const FORBIDDEN_AUTHOR_TOOLS = [
  'bash',
  'mcp__session__bash',
  'shell',
  'merge',
  'deploy',
  'npx',
] as const

export const ARTIFACT_MIME: Record<ArtifactFormat, string> = {
  markdown: 'text/markdown',
  csv: 'text/csv',
  research: 'text/markdown',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export type ArtifactSource = {
  sourceId: string
  revision?: string
  quote: string
}

export type MeetingArtifactRecord = {
  id: string
  workspaceId: string
  meetingRef: Rox2EntityRef
  kind: ArtifactKind
  format: ArtifactFormat
  relativePath: string
  mimeType: string
  size: number
  sha256: string
  version: number
  revisionId: string
  sources: readonly ArtifactSource[]
  createdAt: number
}

export type ArtifactParseOk = {
  ok: true
  format: ArtifactFormat
  mimeType: string
  text: string
  size: number
}

export type ArtifactParseDenied = { ok: false; code: 'empty' | 'corrupt' | 'placeholder' }
export type ArtifactParseResult = ArtifactParseOk | ArtifactParseDenied

export type ArtifactDeniedCode =
  | 'empty'
  | 'corrupt'
  | 'placeholder'
  | 'unsupported-tool'
  | 'denied-source'
  | 'secret-access'
  | 'absolute-path'
  | 'author-disabled'
  | 'conflict'
  | 'grant-missing'
  | 'unauthenticated'
  | 'handoff-denied'

export type MeetingArtifactOk = {
  ok: true
  artifact: MeetingArtifactRecord
  result: Rox2V2Result
  parsed: ArtifactParseOk
  pullRequest?: DraftPullRequest
}

export type MeetingArtifactDenied = {
  ok: false
  code: ArtifactDeniedCode
  message: string
  result: Rox2V2Result
  artifact?: MeetingArtifactRecord
}

export type MeetingArtifactResult = MeetingArtifactOk | MeetingArtifactDenied

export type ArtifactSessionOutput = {
  bytes: Uint8Array
  format: ArtifactFormat
  relativePath: string
  toolsUsed: readonly string[]
}

export type ArtifactSessionAdapter = {
  run(input: {
    roleId: 'rox.meeting.author'
    tools: readonly string[]
    format: ArtifactFormat
    kind: ArtifactKind
    title: string
    body: string
    rows?: readonly (readonly string[])[]
    slides?: readonly string[]
    sources: readonly ArtifactSource[]
  }): Promise<ArtifactSessionOutput>
}

export type ArtifactFileStore = {
  read(relativePath: string): Uint8Array | undefined
  write(relativePath: string, bytes: Uint8Array, record: MeetingArtifactRecord): MeetingArtifactRecord
  get(relativePath: string): MeetingArtifactRecord | undefined
  list(): MeetingArtifactRecord[]
}

export type DraftPullRequest = {
  number: number
  url: string
  headSha: string
  draft: true
  merged: false
  repo: string
  branch: string
}

export type CodingHandoffAdapter = {
  createDraftPullRequest(input: {
    repo: string
    branch: string
    title: string
    body: string
  }): Promise<DraftPullRequest>
  readback(input: { repo: string; number: number }): Promise<DraftPullRequest | undefined>
  merge(): Promise<never>
  deploy(): Promise<never>
  shell(command: string): Promise<never>
}

export type ArtifactSourceInput = {
  sourceId: string
  revision?: string
  text: string
}

export type BuildMeetingArtifactInput = {
  actor: MeetingActor
  grants: readonly MeetingGrant[]
  now?: number
  meetingRef: Rox2EntityRef
  kind?: ArtifactKind
  format: ArtifactFormat
  title: string
  body?: string
  rows?: readonly (readonly string[])[]
  slides?: readonly string[]
  relativePath: string
  toolName?: string
  requestedTools?: readonly string[]
  sources?: readonly ArtifactSourceInput[]
  closedSourceIds?: readonly string[]
  conversation?: string
  expectedRevision?: string
  repo?: string
  branch?: string
  authorJobsEnabled?: boolean
  session?: ArtifactSessionAdapter
  files?: ArtifactFileStore
  git?: CodingHandoffAdapter
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let authorJobsEnabled = true

export function setMeetingAuthorJobsEnabled(enabled: boolean): void {
  authorJobsEnabled = enabled
}

export function meetingAuthorJobsEnabled(): boolean {
  return authorJobsEnabled
}

export function toolNameForArtifact(format: ArtifactFormat, kind: ArtifactKind): AuthorToolName {
  if (kind === 'code-handoff') return 'meeting.author.code'
  if (kind === 'research' || format === 'research') return 'meeting.author.research'
  if (format === 'markdown') return 'meeting.author.markdown'
  if (format === 'docx') return 'meeting.author.docx'
  if (format === 'pdf') return 'meeting.author.pdf'
  if (format === 'csv') return 'meeting.author.csv'
  if (format === 'xlsx') return 'meeting.author.xlsx'
  return 'meeting.author.pptx'
}

export function isRelativeArtifactPath(path: string): boolean {
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path)
}

export function isHostSecretPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return (
    normalized.includes('.ssh/')
    || normalized.endsWith('.ssh')
    || normalized.includes('id_rsa')
    || normalized.includes('id_ed25519')
    || normalized.includes('/credentials')
    || normalized.includes('infisical')
    || normalized.includes('access-token')
    || /(^|\/)\.env(\.|$)/.test(normalized)
    || normalized.includes('.gnupg')
    || normalized.startsWith('/etc/')
    || normalized.startsWith('/root/')
    || normalized.includes('/.config/')
    || normalized.includes('/.local/share/')
  )
}

export function isPlaceholderArtifactText(text: string): boolean {
  return /^(готово|done|success|ok|ready)$/i.test(text.trim())
}

export function conversationRequestsForbiddenEffect(text: string | undefined): boolean {
  if (!text) return false
  return /\b(merge\s+(this|the\s+pr|the\s+pull request|pull request)|git\s+merge|deploy|npx\s+convex\s+deploy|bash\s+-c|\/bin\/sh|allow-all)\b/i.test(text)
}

function failedResult(code: ArtifactDeniedCode, message: string): Rox2V2Result {
  return decodeRox2V2Result({
    ok: false,
    mode: 'live',
    lifecycle: 'failed',
    verification: 'unverified',
    code,
    message,
  })
}

function verifiedResult(entityId: string): Rox2V2Result {
  return decodeRox2V2Result({
    ok: true,
    mode: 'live',
    lifecycle: 'applied',
    verification: 'verified',
    entityId,
  })
}

function deny(code: ArtifactDeniedCode, message: string): MeetingArtifactDenied {
  return { ok: false, code, message, result: failedResult(code, message) }
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

export function writeStoredZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, raw] of Object.entries(files)) {
    const data = typeof raw === 'string' ? encoder.encode(raw) : raw
    const nameBytes = encoder.encode(name)
    const checksum = crc32(data)
    const local = concat([
      encoder.encode('PK\u0003\u0004'),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    ])
    const central = concat([
      encoder.encode('PK\u0001\u0002'),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralDir = concat(centrals)
  const end = concat([
    encoder.encode('PK\u0005\u0006'),
    u16(0),
    u16(0),
    u16(centrals.length),
    u16(centrals.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ])
  return concat([...locals, centralDir, end])
}

export function readStoredZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  let i = 0
  while (i + 30 <= bytes.length) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) break
    const nameLen = bytes[i + 26]! | (bytes[i + 27]! << 8)
    const extraLen = bytes[i + 28]! | (bytes[i + 29]! << 8)
    const size = bytes[i + 18]! | (bytes[i + 19]! << 8) | (bytes[i + 20]! << 16) | (bytes[i + 21]! << 24)
    const nameStart = i + 30
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLen))
    const dataStart = nameStart + nameLen + extraLen
    out[name] = bytes.slice(dataStart, dataStart + size)
    i = dataStart + size
  }
  return out
}

function xmlText(xml: string): string {
  return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildMarkdownArtifact(body: string): Uint8Array {
  return encoder.encode(body)
}

export function buildCsvArtifact(rows: readonly (readonly string[])[]): Uint8Array {
  const lines = rows.map((row) => row.map(csvEscape).join(','))
  return encoder.encode(lines.join('\n') + (lines.length ? '\n' : ''))
}

export function buildPdfArtifact(text: string): Uint8Array {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(body.length)
    body += `${object}\n`
  }
  const xrefStart = body.length
  let xref = 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  body += `${xref}trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return encoder.encode(body)
}

export function buildDocxArtifact(text: string): Uint8Array {
  return writeStoredZip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p></w:body>
</w:document>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  })
}

export function buildXlsxArtifact(rows: readonly (readonly string[])[]): Uint8Array {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, col) => {
      const ref = `${String.fromCharCode(65 + col)}${rowIndex + 1}`
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return writeStoredZip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  })
}

export function buildPptxArtifact(slides: readonly string[]): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
    'ppt/slides/slide1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${xmlEscape(slides[0] ?? '')}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  }
  return writeStoredZip(files)
}

export function parseMeetingArtifact(format: ArtifactFormat, bytes: Uint8Array): ArtifactParseResult {
  if (bytes.length === 0) return { ok: false, code: 'empty' }
  const mimeType = ARTIFACT_MIME[format]
  let text = ''
  if (format === 'markdown' || format === 'research') {
    text = decoder.decode(bytes).trim()
  } else if (format === 'csv') {
    text = decoder.decode(bytes).trim()
    if (!text.includes(',') && !text.includes('\n') && text.split(/\s+/).length < 1) {
      return { ok: false, code: 'corrupt' }
    }
  } else if (format === 'pdf') {
    const raw = decoder.decode(bytes)
    if (!raw.startsWith('%PDF-')) return { ok: false, code: 'corrupt' }
    text = raw.replace(/\\([()\\])/g, '$1')
    const match = /\(([^)]*)\)\s*Tj/.exec(raw)
    text = match ? match[1]!.replace(/\\([()\\])/g, '$1') : xmlText(raw)
  } else {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, code: 'corrupt' }
    const files = readStoredZip(bytes)
    if (format === 'docx') {
      const xml = files['word/document.xml']
      if (!xml) return { ok: false, code: 'corrupt' }
      text = xmlText(decoder.decode(xml))
    } else if (format === 'xlsx') {
      const xml = files['xl/worksheets/sheet1.xml'] ?? files['xl/workbook.xml']
      if (!xml) return { ok: false, code: 'corrupt' }
      text = xmlText(decoder.decode(xml))
    } else {
      const xml = files['ppt/slides/slide1.xml'] ?? files['ppt/presentation.xml']
      if (!xml) return { ok: false, code: 'corrupt' }
      text = xmlText(decoder.decode(xml))
    }
  }
  if (!text) return { ok: false, code: 'empty' }
  if (isPlaceholderArtifactText(text)) return { ok: false, code: 'placeholder' }
  return { ok: true, format, mimeType, text, size: bytes.length }
}

export function createMemoryArtifactStore(initial: readonly MeetingArtifactRecord[] = []): ArtifactFileStore {
  const files = new Map<string, Uint8Array>()
  const records = new Map<string, MeetingArtifactRecord>()
  for (const record of initial) records.set(record.relativePath, { ...record, sources: [...record.sources] })
  return {
    read(relativePath) {
      if (!isRelativeArtifactPath(relativePath) || isHostSecretPath(relativePath)) return undefined
      const found = files.get(relativePath)
      return found ? Uint8Array.from(found) : undefined
    },
    write(relativePath, bytes, record) {
      if (!isRelativeArtifactPath(relativePath)) {
        throw new Error('absolute-path')
      }
      if (isHostSecretPath(relativePath)) {
        throw new Error('secret-access')
      }
      files.set(relativePath, Uint8Array.from(bytes))
      const saved = { ...record, sources: [...record.sources] }
      records.set(relativePath, saved)
      return { ...saved }
    },
    get(relativePath) {
      const found = records.get(relativePath)
      return found ? { ...found, sources: [...found.sources] } : undefined
    },
    list() {
      return [...records.values()].map((record) => ({ ...record, sources: [...record.sources] }))
    },
  }
}

export function createMemoryCodingHandoff(): CodingHandoffAdapter {
  const prs = new Map<string, DraftPullRequest>()
  let next = 1
  return {
    async createDraftPullRequest(input) {
      const number = next++
      const pr: DraftPullRequest = {
        number,
        url: `https://github.com/${input.repo}/pull/${number}`,
        headSha: sha256Bytes(encoder.encode(`${input.repo}:${input.branch}:${input.body}`)).slice(0, 40),
        draft: true,
        merged: false,
        repo: input.repo,
        branch: input.branch,
      }
      prs.set(`${input.repo}#${number}`, pr)
      return { ...pr }
    },
    async readback(input) {
      const found = prs.get(`${input.repo}#${input.number}`)
      return found ? { ...found } : undefined
    },
    async merge() {
      throw new Error('merge-forbidden')
    },
    async deploy() {
      throw new Error('deploy-forbidden')
    },
    async shell() {
      throw new Error('shell-forbidden')
    },
  }
}

export function createDefaultArtifactSession(): ArtifactSessionAdapter {
  return {
    async run(input) {
      const body = input.body.trim()
      const rows = input.rows ?? [['item', 'status'], [body || input.title, 'open']]
      const slides = input.slides ?? [body || input.title]
      let bytes: Uint8Array
      if (input.format === 'docx') bytes = buildDocxArtifact(body || input.title)
      else if (input.format === 'xlsx') bytes = buildXlsxArtifact(rows)
      else if (input.format === 'pptx') bytes = buildPptxArtifact(slides)
      else if (input.format === 'pdf') bytes = buildPdfArtifact(body || input.title)
      else if (input.format === 'csv') bytes = buildCsvArtifact(rows)
      else {
        const citations = input.sources.map((source) => `- ${source.sourceId}: ${source.quote}`).join('\n')
        bytes = buildMarkdownArtifact(
          input.kind === 'research' || input.format === 'research'
            ? `# ${input.title}\n\n${body}\n\n## Sources\n${citations}\n`
            : body || `# ${input.title}\n`,
        )
      }
      return {
        bytes,
        format: input.format,
        relativePath: '',
        toolsUsed: [toolNameForArtifact(input.format, input.kind)],
      }
    },
  }
}

function allowedSources(
  sources: readonly ArtifactSourceInput[],
  closed: readonly string[],
): { ok: true; sources: ArtifactSource[] } | { ok: false; code: 'denied-source' | 'secret-access' } {
  const allowed: ArtifactSource[] = []
  for (const source of sources) {
    if (closed.includes(source.sourceId)) {
      return { ok: false, code: 'denied-source' }
    }
    if (isHostSecretPath(source.sourceId)) {
      return { ok: false, code: 'secret-access' }
    }
    if (/SECRET_|BEGIN (OPENSSH |RSA )?PRIVATE KEY/.test(source.text)) {
      return { ok: false, code: 'secret-access' }
    }
    allowed.push({ sourceId: source.sourceId, revision: source.revision, quote: source.text.slice(0, 280) })
  }
  return { ok: true, sources: allowed }
}

function requestedToolsAreAllowed(tools: readonly string[], allowed: readonly string[]): boolean {
  for (const tool of tools) {
    if ((FORBIDDEN_AUTHOR_TOOLS as readonly string[]).includes(tool)) return false
    if (!allowed.includes(tool) && tool !== 'meeting.author') return false
  }
  return true
}

export async function buildMeetingArtifact(input: BuildMeetingArtifactInput): Promise<MeetingArtifactResult> {
  const kind = input.kind ?? (input.format === 'research' ? 'research' : 'document')
  const enabled = input.authorJobsEnabled ?? authorJobsEnabled
  if (!enabled) return deny('author-disabled', 'Author jobs are disabled; existing files are kept')
  if (!isRelativeArtifactPath(input.relativePath) || input.relativePath.startsWith('/') || input.relativePath.includes('..')) {
    return deny('absolute-path', 'Artifact writes must use a relative path')
  }
  if (isHostSecretPath(input.relativePath)) {
    return deny('secret-access', 'Sandbox cannot read host credentials')
  }

  const capability = kind === 'code-handoff' ? 'action.external' : 'archive.durable'
  const source = kind === 'code-handoff' ? 'external' : 'archive'
  const authz = authorizeMeetingAction({
    actor: input.actor,
    capability,
    operation: kind === 'code-handoff' ? 'artifact_code_handoff' : 'artifact_build',
    source,
    target: kind === 'code-handoff' ? input.repo : input.relativePath,
    payloadHash: input.relativePath,
    now: input.now ?? Date.now(),
    permissionMode: 'ask',
    grants: input.grants,
  })
  if (!authz.ok) {
    const code = authz.code === 'unauthenticated' ? 'unauthenticated' : 'grant-missing'
    return deny(code, authz.message)
  }

  const toolName = input.toolName ?? toolNameForArtifact(input.format, kind)
  const allowedTools = [...AUTHOR_TOOL_NAMES]
  const requested = input.requestedTools ?? [toolName]
  if (!requestedToolsAreAllowed(requested, allowedTools) || (FORBIDDEN_AUTHOR_TOOLS as readonly string[]).includes(toolName)) {
    return deny('unsupported-tool', `Tool ${toolName} is not allowed in the author session`)
  }
  if (conversationRequestsForbiddenEffect(input.conversation)) {
    return deny('unsupported-tool', 'Conversation text cannot authorize shell, merge, or deploy')
  }

  const closed = input.closedSourceIds ?? []
  const sourced = allowedSources(input.sources ?? [], closed)
  if (!sourced.ok) {
    return deny(sourced.code, sourced.code === 'secret-access'
      ? 'Sandbox cannot read host credentials'
      : 'Denied sources cannot grant artifact rights')
  }

  const files = input.files ?? createMemoryArtifactStore()
  const existing = files.get(input.relativePath)
  if (existing && input.expectedRevision != null && existing.revisionId !== input.expectedRevision) {
    return deny('conflict', 'Artifact changed since the proposal base revision')
  }

  if (kind === 'code-handoff') {
    if (!input.repo || !input.branch) {
      return deny('handoff-denied', 'Coding handoff requires an approved repo and branch')
    }
    const git = input.git ?? createMemoryCodingHandoff()
    if (input.conversation && /\b(merge|deploy|shell)\b/i.test(input.conversation) && conversationRequestsForbiddenEffect(input.conversation)) {
      return deny('unsupported-tool', 'Conversation text cannot authorize shell, merge, or deploy')
    }
    const pr = await git.createDraftPullRequest({
      repo: input.repo,
      branch: input.branch,
      title: input.title,
      body: input.body ?? '',
    })
    const readback = await git.readback({ repo: input.repo, number: pr.number })
    if (!readback || readback.merged || !readback.draft || readback.branch !== input.branch) {
      return deny('handoff-denied', 'Draft pull request readback failed')
    }
    const body = `# ${input.title}\n\n${input.body ?? ''}\n\n${readback.url}\n`
    const bytes = encoder.encode(body)
    const parsed = parseMeetingArtifact('markdown', bytes)
    if (!parsed.ok) return deny(parsed.code, 'Handoff note failed verification')
    const version = (existing?.version ?? 0) + 1
    const record: MeetingArtifactRecord = {
      id: `artifact-${input.meetingRef.entityId}-${input.relativePath.replace(/[^\w.-]+/g, '-')}`,
      workspaceId: input.actor.workspaceId,
      meetingRef: { ...input.meetingRef },
      kind,
      format: 'markdown',
      relativePath: input.relativePath,
      mimeType: ARTIFACT_MIME.markdown,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
      version,
      revisionId: String(version),
      sources: sourced.sources,
      createdAt: input.now ?? Date.now(),
    }
    const saved = files.write(input.relativePath, bytes, record)
    const result = verifiedResult(saved.id)
    if (!isVerifiedEffect(result)) return deny('corrupt', 'Handoff result is not a verified effect')
    return { ok: true, artifact: saved, result, parsed, pullRequest: readback }
  }

  const session = input.session ?? createDefaultArtifactSession()
  const produced = await session.run({
    roleId: 'rox.meeting.author',
    tools: requested,
    format: input.format,
    kind,
    title: input.title,
    body: input.body ?? '',
    rows: input.rows,
    slides: input.slides,
    sources: sourced.sources,
  })
  if (!requestedToolsAreAllowed(produced.toolsUsed, allowedTools)) {
    return deny('unsupported-tool', 'Author session used a tool that is not on the allowlist')
  }

  const parsed = parseMeetingArtifact(input.format, produced.bytes)
  if (!parsed.ok) {
    return deny(parsed.code, parsed.code === 'empty'
      ? 'Artifact file is empty'
      : parsed.code === 'placeholder'
        ? 'Placeholder success text is not a verified artifact'
        : 'Artifact file is corrupt or unreadable')
  }

  const readPath = produced.relativePath || input.relativePath
  if (!isRelativeArtifactPath(readPath) || isHostSecretPath(readPath)) {
    return deny(isHostSecretPath(readPath) ? 'secret-access' : 'absolute-path', 'Sandbox cannot read host credentials')
  }

  const version = (existing?.version ?? 0) + 1
  const record: MeetingArtifactRecord = {
    id: `artifact-${input.meetingRef.entityId}-${input.relativePath.replace(/[^\w.-]+/g, '-')}`,
    workspaceId: input.actor.workspaceId,
    meetingRef: { ...input.meetingRef },
    kind,
    format: input.format,
    relativePath: input.relativePath,
    mimeType: parsed.mimeType,
    size: produced.bytes.length,
    sha256: sha256Bytes(produced.bytes),
    version,
    revisionId: String(version),
    sources: sourced.sources,
    createdAt: input.now ?? Date.now(),
  }
  const saved = files.write(input.relativePath, produced.bytes, record)
  const readback = files.read(input.relativePath)
  if (!readback || sha256Bytes(readback) !== saved.sha256) {
    return deny('corrupt', 'Artifact readback hash does not match')
  }
  const parsedReadback = parseMeetingArtifact(input.format, readback)
  if (!parsedReadback.ok) {
    return deny(parsedReadback.code, 'Artifact readback failed to parse')
  }
  const result = verifiedResult(saved.id)
  if (!isVerifiedEffect(result)) return deny('corrupt', 'Artifact result is not a verified effect')
  return { ok: true, artifact: saved, result, parsed: parsedReadback }
}
