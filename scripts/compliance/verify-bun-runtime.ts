import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_BINARY_BYTES = 128 * 1024 * 1024
const RANGE_BYTES = 1024 * 1024
const RANGE_CONCURRENCY = 6
const TIMEOUT_MS = 45_000
export const sha256 = (source: Uint8Array): string => createHash('sha256').update(source).digest('hex')
export function gitBlob(source: Uint8Array): string { return createHash('sha1').update('blob ' + source.length + '\0').update(source).digest('hex') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_UPSTREAM_METADATA')
  return value as Record<string, unknown>
}
async function responseBytes(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('UPSTREAM_READ_FAILED')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > maximum) { await reader.cancel(); throw new Error('UPSTREAM_BYTE_LIMIT') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}
export async function pinnedSource(options: { repository: string; revision: string; path: string; expectedBlob?: string }) {
  if (!['oven-sh/bun', 'sru-systems/rust-argon2', 'oven-sh/WebKit'].includes(options.repository) || !/^[a-f0-9]{40}$/.test(options.revision) || !options.path || !/^[A-Za-z0-9_./-]+$/.test(options.path) || options.path.startsWith('/') || options.path.split('/').some(part => part === '.' || part === '..' || !part)) throw new Error('UNTRUSTED_SOURCE_IDENTITY')
  const url = 'https://raw.githubusercontent.com/' + options.repository + '/' + options.revision + '/' + options.path
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
  const source = await responseBytes(response, 1024 * 1024)
  const blob = gitBlob(source)
  if (options.expectedBlob && blob !== options.expectedBlob) throw new Error('UPSTREAM_BLOB_MISMATCH')
  return { ...options, url, sha256: sha256(source), gitBlob: blob, bytes: source.length, text: new TextDecoder('utf-8', { fatal: true }).decode(source), legalApproval: false }
}
export function releaseAsset(input: unknown, tagInput: unknown, version: string, name: string) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^bun-[A-Za-z0-9-]+\.zip$/.test(name)) throw new Error('INVALID_RELEASE_IDENTITY')
  const release = record(input)
  const tag = record(record(tagInput).object)
  if (release.tag_name !== 'bun-v' + version || tag.type !== 'commit' || typeof tag.sha !== 'string' || !/^[a-f0-9]{40}$/.test(tag.sha) || release.target_commitish !== tag.sha) throw new Error('RELEASE_REVISION_MISMATCH')
  if (!Array.isArray(release.assets)) throw new Error('RELEASE_ASSETS_MISSING')
  const matches = release.assets.map(record).filter(asset => asset.name === name)
  const asset = matches[0]
  if (matches.length !== 1 || !asset || typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ARCHIVE_BYTES || typeof asset.browser_download_url !== 'string') throw new Error('UNSUPPORTED_RELEASE_ASSET')
  const url = new URL(asset.browser_download_url)
  const expectedPath = '/oven-sh/bun/releases/download/bun-v' + version + '/' + name
  if (url.origin !== 'https://github.com' || url.pathname !== expectedPath || url.search || url.hash || url.username || url.password) throw new Error('UNTRUSTED_RELEASE_ORIGIN')
  return { revision: tag.sha, name, size: asset.size, sha256: asset.digest.slice(7), url: url.href }
}
export function verifyReleaseArchive(asset: ReturnType<typeof releaseAsset>, source: Buffer): void {
  if (source.length !== asset.size || sha256(source) !== asset.sha256) throw new Error('OFFICIAL_RELEASE_DIGEST_MISMATCH')
}
export async function downloadRelease(asset: ReturnType<typeof releaseAsset>): Promise<Buffer> {
  const chunks = new Map<number, Buffer>()
  const starts = Array.from({ length: Math.ceil(asset.size / RANGE_BYTES) }, (_, index) => index * RANGE_BYTES)
  let cursor = 0
  async function worker() {
    while (cursor < starts.length) {
      const index = cursor++
      const start = starts[index]
      if (start === undefined) throw new Error('MISSING_RANGE')
      const end = Math.min(start + RANGE_BYTES, asset.size) - 1
      const response = await fetch(asset.url, { headers: { Range: 'bytes=' + start + '-' + end }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      const final = new URL(response.url)
      if (final.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com'].includes(final.hostname) || response.status !== 206 || response.headers.get('content-range') !== 'bytes ' + start + '-' + end + '/' + asset.size) throw new Error('INVALID_RELEASE_RANGE_RESPONSE')
      const buffer = await responseBytes(response, end - start + 1)
      if (buffer.length !== end - start + 1) throw new Error('INVALID_RELEASE_RANGE_SIZE')
      chunks.set(start, buffer)
    }
  }
  await Promise.all(Array.from({ length: RANGE_CONCURRENCY }, worker))
  const source = Buffer.concat(starts.map(start => { const chunk = chunks.get(start); if (!chunk) throw new Error('MISSING_RELEASE_RANGE'); return chunk }))
  verifyReleaseArchive(asset, source)
  return source
}
type ZipEntry = { fileName: string; uncompressedSize: number; externalFileAttributes: number }
type ZipPort = {
  on(event: 'entry', listener: (entry: ZipEntry) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
  readEntry(): void
  close(): void
  openReadStream(entry: ZipEntry, callback: (error: Error | null, stream?: Readable) => void): void
}
type YauzlPort = { fromBuffer(source: Buffer, options: { lazyEntries: boolean; validateEntrySizes: boolean }, callback: (error: Error | null, zip?: ZipPort) => void): void }
export function binaryMember(source: Buffer, member: string, toolsRoot: string): Promise<Buffer> {
  if (!/^bun-[A-Za-z0-9-]+\/bun$/.test(member)) throw new Error('INVALID_BINARY_MEMBER')
  const require = createRequire(toolsRoot + '/package.json')
  const parser = require('yauzl') as unknown as YauzlPort
  return new Promise((resolve, reject) => {
    parser.fromBuffer(source, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('OFFICIAL_ZIP_UNREADABLE')); return }
      let found: Buffer | undefined
      let entries = 0
      const seen = new Set<string>()
      function fail() { zip?.close(); reject(new Error('UNSUPPORTED_OFFICIAL_ZIP_ENTRY')) }
      zip.on('error', reject)
      zip.on('end', () => { if (!found) reject(new Error('OFFICIAL_BINARY_MEMBER_MISSING')); else resolve(found) })
      zip.on('entry', entry => {
        if (++entries > 100 || seen.has(entry.fileName) || entry.fileName.startsWith('/') || entry.fileName.includes('\\') || entry.fileName.split('/').some(part => part === '.' || part === '..') || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) { fail(); return }
        seen.add(entry.fileName)
        if (entry.fileName !== member) { if (!entry.fileName.endsWith('/')) { fail(); return } zip.readEntry(); return }
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > MAX_BINARY_BYTES) { fail(); return }
        zip.openReadStream(entry, (readError, stream) => {
          if (readError || !stream) { fail(); return }
          const chunks: Buffer[] = []
          let size = 0
          stream.on('error', reject)
          stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BINARY_BYTES) { stream.destroy(); fail() } else chunks.push(chunk) })
          stream.on('end', () => { if (size !== entry.uncompressedSize) { fail(); return } found = Buffer.concat(chunks); zip.readEntry() })
        })
      })
      zip.readEntry()
    })
  })
}
export function compareBinary(installed: Buffer, upstream: Buffer) {
  return { installedSha256: sha256(installed), upstreamSha256: sha256(upstream), installedBytes: installed.length, upstreamBytes: upstream.length, exactMatch: installed.equals(upstream), legalApproval: false }
}
type TarEntry = { path: string; type: string; size: number; on(event: 'data', listener: (source: Buffer) => void): void; on(event: 'end', listener: () => void): void; resume(): void }
type TarParser = { on(event: 'entry', listener: (entry: TarEntry) => void): void; on(event: 'error', listener: (error: Error) => void): void; on(event: 'end', listener: () => void): void; end(source: Buffer): void; abort(error: Error): void }
type TarPort = { Parser: new () => TarParser }
export function bottleMembers(source: Buffer, expectedSha256: string, members: string[], toolsRoot: string): Promise<Map<string, Buffer>> {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || sha256(source) !== expectedSha256 || source.length > MAX_ARCHIVE_BYTES || !members.length || new Set(members).size !== members.length || members.some(member => !/^bun\/\d+\.\d+\.\d+\/[A-Za-z0-9_./-]+$/.test(member) || member.split('/').some(part => part === '..' || part === '.'))) throw new Error('BOTTLE_IDENTITY_MISMATCH')
  const require = createRequire(toolsRoot + '/package.json')
  const tar = require('tar') as unknown as TarPort
  return new Promise((resolve, reject) => {
    const parser = new tar.Parser()
    const wanted = new Set(members)
    const output = new Map<string, Buffer>()
    let entries = 0
    parser.on('error', reject)
    parser.on('end', () => { if (output.size !== wanted.size) reject(new Error('BOTTLE_MEMBER_MISSING')); else resolve(output) })
    parser.on('entry', entry => {
      if (++entries > 1000 || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some(part => part === '..' || part === '.')) { parser.abort(new Error('UNSUPPORTED_BOTTLE_ENTRY')); return }
      if (!wanted.has(entry.path)) { entry.resume(); return }
      if (entry.type !== 'File' || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > MAX_BINARY_BYTES || output.has(entry.path)) { parser.abort(new Error('UNSUPPORTED_BOTTLE_MEMBER')); return }
      const chunks: Buffer[] = []
      let size = 0
      entry.on('data', chunk => { size += chunk.length; if (size > MAX_BINARY_BYTES) parser.abort(new Error('BOTTLE_MEMBER_LIMIT')); else chunks.push(chunk) })
      entry.on('end', () => { if (size !== entry.size) reject(new Error('BOTTLE_MEMBER_SIZE_MISMATCH')); else output.set(entry.path, Buffer.concat(chunks)) })
    })
    parser.end(source)
  })
}
