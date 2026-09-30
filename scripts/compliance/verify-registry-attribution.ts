import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { archiveInventory } from './generate-sbom'
import { collect, digest } from './collect-build-attribution'

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
const FETCH_TIMEOUT_MS = 45_000
type Package = ReturnType<typeof collect>['packages'][number]
type Finding = { code: string; subject: string }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REGISTRY_METADATA')
  return value as Record<string, unknown>
}
export function verifyIntegrity(source: Buffer, expected: unknown): string {
  if (typeof expected !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(expected)) throw new Error('UNSUPPORTED_REGISTRY_INTEGRITY')
  const actual = 'sha512-' + createHash('sha512').update(source).digest('base64')
  if (actual !== expected) throw new Error('REGISTRY_INTEGRITY_MISMATCH')
  return actual
}
export function verifyPackageArchive(pkg: Package, source: Buffer) {
  if (pkg.lockMatches.length !== 1) throw new Error('UNIQUE_LOCK_LOCATOR_REQUIRED')
  const lock = pkg.lockMatches[0]
  if (!lock) throw new Error('UNIQUE_LOCK_LOCATOR_REQUIRED')
  const integrity = verifyIntegrity(source, lock.row[3])
  const inventory = archiveInventory(source)
  const hashes = new Map(inventory.map(entry => [entry.path, entry.sha256]))
  const findings: Finding[] = []
  if (hashes.get('package/package.json') !== pkg.manifestSha256) findings.push({ code: 'REGISTRY_MANIFEST_MISMATCH', subject: pkg.root })
  const inputs = pkg.inputs.map(input => {
    const member = 'package/' + relative(pkg.root, input.path)
    const matches = hashes.get(member) === input.sha256
    if (!matches) findings.push({ code: 'REGISTRY_INPUT_MISMATCH', subject: input.path })
    return { path: input.path, archiveMember: member, sha256: input.sha256, matches, bytesInOutput: input.bytesInOutput }
  })
  const notices = pkg.notices.map(notice => {
    const member = 'package/' + relative(pkg.root, notice.path)
    const matches = hashes.get(member) === notice.sha256
    if (!matches) findings.push({ code: 'INSTALLED_NOTICE_NOT_REGISTRY_MEMBER', subject: notice.path })
    return { path: notice.path, archiveMember: member, sha256: notice.sha256, matches }
  })
  return { name: pkg.name, version: pkg.version, packageRoot: pkg.root, lockKey: lock.key, archiveSha256: digest(source), archiveIntegrity: integrity, archiveBytes: source.length, archiveMemberCount: inventory.length, manifestMatches: hashes.get('package/package.json') === pkg.manifestSha256, inputs, notices, findings, legalApproval: false }
}
async function download(url: URL, maxBytes: number): Promise<Buffer> {
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || url.search || url.hash) throw new Error('UNSUPPORTED_REGISTRY_ORIGIN')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok || !response.body) throw new Error('REGISTRY_READ_FAILED')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > maxBytes) { await reader.cancel(); throw new Error('REGISTRY_DOWNLOAD_LIMIT') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}
export async function readRegistryPackage(pkg: Package, destination: string) {
  if (!/^(@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(pkg.name) || !/^[A-Za-z0-9_.+-]+$/.test(pkg.version)) throw new Error('UNSUPPORTED_REGISTRY_PACKAGE')
  const metadataUrl = new URL('https://registry.npmjs.org/' + encodeURIComponent(pkg.name) + '/' + encodeURIComponent(pkg.version))
  const metadataBytes = await download(metadataUrl, 1024 * 1024)
  const metadata = record(JSON.parse(metadataBytes.toString('utf8')))
  if (metadata.name !== pkg.name || metadata.version !== pkg.version) throw new Error('REGISTRY_IDENTITY_MISMATCH')
  const distribution = record(metadata.dist)
  if (typeof distribution.tarball !== 'string') throw new Error('REGISTRY_TARBALL_MISSING')
  const tarballUrl = new URL(distribution.tarball)
  const source = await download(tarballUrl, MAX_DOWNLOAD_BYTES)
  const verified = verifyPackageArchive(pkg, source)
  if (distribution.integrity !== verified.archiveIntegrity) throw new Error('REGISTRY_METADATA_INTEGRITY_MISMATCH')
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const basename = pkg.name.replace('/', '__').replace('@', '') + '-' + pkg.version
  writeFileSync(join(destination, basename + '.tgz'), source, { flag: 'wx', mode: 0o600 })
  writeFileSync(join(destination, basename + '.metadata.json'), metadataBytes, { flag: 'wx', mode: 0o600 })
  return { ...verified, metadataUrl: metadataUrl.href, metadataSha256: digest(metadataBytes), tarballUrl: tarballUrl.href, declaredLicense: metadata.license ?? null, declaredRepository: metadata.repository ?? null, declaredGitHead: metadata.gitHead ?? null, sourceOrigin: 'PINNED_NPM_REGISTRY_ARCHIVE', upstreamGitHistoryVerified: false }
}
