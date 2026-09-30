#!/usr/bin/env bun
/**
 * WP-48 standalone, read-only release audit. No user store or parallel command authority.
 * generate/check --release <json> --root <artifact staging> --lock <bun.lock>
 *   --decisions <json> --notices <text> --source-revision <40-hex SHA> --output <json>
 * Generate emits deterministic evidence; check additionally requires exact scoped review.
 * Archive producers must provide the actual extracted contentRoot, not a lock-only list.
 * Final signed/archive/image bytes must be audited AFTER packaging (no self digest).
 */
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import { Parser } from 'tar'
import ts from 'typescript'
import { z } from 'zod'
import { collect } from './collect-build-attribution'
import { verifyPackageArchive } from './verify-registry-attribution'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const revision = z.string().regex(/^[a-f0-9]{40}$/)
const text = z.string().min(1)
const safePath = text.refine(p => !isAbsolute(p) && !p.includes('\\') && p.split('/').every(s => s !== '..' && s !== '.' && s !== ''), 'Relative, non-traversing path required')
const originSchema = z.object({ repository: text, revision, path: safePath, sha256: digest, modifications: z.string(), transfer: z.enum(['independent', 'dependency', 'copy']) }).strict()
const noticeSchema = z.object({ path: safePath, sha256: digest }).strict()
const componentSchema = z.object({ id: text, kind: z.enum(['workspace', 'dependency', 'runtime', 'codec', 'model', 'plugin', 'source']), name: text, version: text, lockKey: text.optional(), integrity: text.optional(), licenseExpression: text.nullable(), origin: originSchema, notices: z.array(noticeSchema).min(1) }).strict()
// Extend this finite public contract only with a real producer's reviewed variant fields.
const publicBuildFlagsSchema = z.object({
  format: z.enum(['esm', 'cjs', 'compiled']).optional(),
  minify: z.boolean().optional(),
  devRuntime: z.boolean().optional(),
  compress: z.boolean().optional(),
  bundled: z.boolean().optional(),
}).strict()
const MAX_ARCHIVE_BYTES = 536870912
const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 1073741824
const MAX_ARCHIVE_ENTRIES = 100000
const contributionSchema = z.object({ componentId: text, scopeSha256: digest, inputs: z.array(z.object({ path: safePath, sha256: digest, bytesInOutput: z.number().int().positive() }).strict()).min(1) }).strict()
const fileSchema = z.object({ path: safePath, sha256: digest, componentId: text.optional(), contributions: z.array(contributionSchema).min(1).optional() }).strict().refine(f => (f.componentId !== undefined) !== (f.contributions !== undefined), 'Exactly one ownership form required')
const bundleSchema = z.object({ sourceRoot: safePath, sourceSha256: digest, buildCwd: safePath, outputRoot: safePath, artifactPrefix: safePath.optional(), lock: noticeSchema, metafile: noticeSchema, scopes: z.array(z.object({ componentId: text, root: safePath, manifestSha256: digest, registryArchive: noticeSchema.optional() }).strict()).min(1) }).strict()
const artifactSchema = z.object({ id: text, kind: z.enum(['web', 'electron', 'workspace', 'sync', 'media', 'transcriber', 'ffmpeg', 'container']), path: safePath, contentRoot: safePath, sha256: digest, platform: text, arch: text, buildFlags: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])), files: z.array(fileSchema).min(1), bundle: bundleSchema.optional() }).strict()
export const ReleaseSchema = z.object({ schemaVersion: z.literal(1), sourceRevision: revision, lockSha256: digest, artifacts: z.array(artifactSchema).min(1), components: z.array(componentSchema).min(1) }).strict()
const decisionSchema = z.object({ artifactId: text, artifactSha256: digest, sbomSha256: digest, buildFlagsSha256: digest, componentId: text, componentSha256: digest, origin: originSchema, licenseExpression: text, notices: z.array(noticeSchema).min(1), reviewer: text, reviewedAt: z.string().datetime(), outcome: z.enum(['approved', 'rejected', 'review_required']), evidence: text, conflictResolution: text.optional() }).strict()
export const DecisionManifestSchema = z.object({ schemaVersion: z.literal(1), policy: z.literal('LICENSE_REVIEW_REQUIRED'), reviewers: z.array(text), requiredBundleArtifacts: z.array(text).optional(), preservedNotices: z.array(noticeSchema), knownScopes: z.array(z.object({ repository: text, revision, path: z.union([z.literal(''), safePath]), licenseExpression: text, evidencePath: safePath, evidenceSha256: digest }).strict()), decisions: z.array(decisionSchema) }).strict()
export type Release = z.infer<typeof ReleaseSchema>
export type Component = z.infer<typeof componentSchema>
export type DecisionManifest = z.infer<typeof DecisionManifestSchema>
export type Decision = z.infer<typeof decisionSchema>
export type Finding = { code: string; subject: string }
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value)
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
function inside(root: string, path: string): string {
  const base = realpathSync(root)
  const target = resolve(base, path)
  const rel = relative(base, target)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('PATH_ESCAPE')
  // Reject symlink ancestors as well as symlink leaves. An unresolved link is not audited bytes.
  let cursor = base
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment)
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('SYMLINK_REVIEW_REQUIRED')
  }
  return target
}
export function inventory(root: string): { path: string; sha256: string }[] {
  const result: { path: string; sha256: string }[] = []
  function visit(dir: string, prefix: string) {
    for (const entry of readdirSync(dir).sort()) {
      const path = prefix ? prefix + '/' + entry : entry
      const abs = join(dir, entry)
      const stat = lstatSync(abs)
      if (stat.isDirectory()) visit(abs, path)
      else if (stat.isFile()) result.push({ path, sha256: sha256(readFileSync(abs)) })
      else throw new Error('UNSUPPORTED_ARTIFACT_ENTRY:' + path)
    }
  }
  visit(root, '')
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}
export function artifactDigest(path: string): string {
  const stat = lstatSync(path)
  if (stat.isFile()) return sha256(readFileSync(path))
  if (stat.isDirectory()) return sha256(canonical(inventory(path)))
  throw new Error('UNSUPPORTED_ARTIFACT')
}
/** Hash members directly from final tar bytes; no extraction, filesystem links or producer assertion. */
export function archiveInventory(bytes: Buffer): { path: string; sha256: string }[] {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_SIZE_LIMIT')
  const payload = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes, { maxOutputLength: MAX_UNCOMPRESSED_ARCHIVE_BYTES }) : bytes
  if (payload.length > MAX_UNCOMPRESSED_ARCHIVE_BYTES) throw new Error('ARCHIVE_SIZE_LIMIT')
  const result: { path: string; sha256: string }[] = []
  const paths = new Set<string>()
  let ended = false
  let count = 0
  const parser = new Parser({ strict: true, onReadEntry: entry => {
    count += 1
    if (count > MAX_ARCHIVE_ENTRIES) throw new Error('ARCHIVE_ENTRY_LIMIT')
    // Tar's conventional './' prefix and directory suffix have one canonical spelling.
    const path = entry.path.replace(/^\.\//, '').replace(/\/$/, '')
    if (entry.type === 'Directory' && (path === '' || path === '.')) { entry.resume(); return }
    safePath.parse(path)
    if (paths.has(path)) throw new Error('DUPLICATE_ARCHIVE_ENTRY')
    paths.add(path)
    if (entry.type === 'Directory') { entry.resume(); return }
    if (entry.type !== 'File' || entry.linkpath) throw new Error('UNSUPPORTED_ARCHIVE_ENTRY')
    const hash = createHash('sha256')
    entry.on('data', (chunk: Buffer) => hash.update(chunk))
    entry.on('end', () => result.push({ path, sha256: hash.digest('hex') }))
    entry.resume()
  } })
  parser.on('error', () => { throw new Error('INVALID_ARCHIVE') })
  parser.on('end', () => { ended = true })
  parser.end(payload)
  if (!ended || !result.length) throw new Error('INVALID_ARCHIVE')
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

function unique(ids: string[], subject: string) {
  if (new Set(ids).size !== ids.length) throw new Error('DUPLICATE_' + subject)
}
export function parseLock(lockText: string) {
  const parsed = ts.parseConfigFileTextToJson('bun.lock', lockText)
  if (parsed.error) throw new Error('INVALID_LOCK_JSONC')
  const lock = z.object({ lockfileVersion: z.number().int(), workspaces: z.record(z.string(), z.record(z.string(), z.unknown())), packages: z.record(z.string(), z.array(z.unknown()).min(1)) }).passthrough().parse(parsed.config)
  const packages = Object.entries(lock.packages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, row]) => {
    const locator = z.string().parse(row[0])
    const split = locator.lastIndexOf('@')
    const metadata = row[2] && typeof row[2] === 'object' ? row[2] as Record<string, unknown> : {}
    return { key, locator, name: split > 0 ? locator.slice(0, split) : locator, version: split > 0 ? locator.slice(split + 1) : '', integrity: typeof row[3] === 'string' ? row[3] : null, resolution: row[1] ?? null, dependencies: metadata, licenseReview: 'LICENSE_REVIEW_REQUIRED' as const }
  })
  return { lockfileVersion: lock.lockfileVersion, workspaces: lock.workspaces, packages }
}
export function fileComponentIds(file: Release['artifacts'][number]['files'][number]): string[] {
  return file.componentId === undefined ? (file.contributions ?? []).map(c => c.componentId) : [file.componentId]
}
function normalizedBundle(bundle: Release['artifacts'][number]['bundle']) {
  return bundle ? { ...bundle, scopes: [...bundle.scopes].sort((a, b) => a.root.localeCompare(b.root)) } : undefined
}
function normalizedFile(file: Release['artifacts'][number]['files'][number]) {
  return file.contributions ? { ...file, contributions: file.contributions.map(c => ({ ...c, inputs: [...c.inputs].sort((a, b) => a.path.localeCompare(b.path)) })).sort((a, b) => a.componentId.localeCompare(b.componentId)) } : file
}
export function componentDigest(release: Release, component: Component): string {
  return sha256(canonical({ component, files: release.artifacts.flatMap(a => a.files.filter(f => fileComponentIds(f).includes(component.id)).map(f => ({ artifactId: a.id, ...normalizedFile(f), ...(a.bundle ? { bundle: normalizedBundle(a.bundle) } : {}) }))).sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0) }))
}
/** Reconstruct every emitted scope from audited snapshot bytes; producer claims are never decisions. */
export function bundleScopeDigest(pkg: ReturnType<typeof collect>['packages'][number], lockSha256: string, registryProof: ReturnType<typeof verifyPackageArchive> | null): string {
  return sha256(canonical({ root: pkg.root, name: pkg.name, version: pkg.version, manifestSha256: pkg.manifestSha256, lockSha256, lockMatches: pkg.lockMatches, workspaceLock: pkg.workspaceLock, inputs: pkg.inputs, registryProof }))
}
export type BundleIdentitySet = { lockSha256: string; components: readonly Pick<Component, 'id' | 'kind' | 'name' | 'version' | 'lockKey'>[] }
export function ValidateBundleLinkage(release: BundleIdentitySet, artifact: Release['artifacts'][number], lockText: string, root: string): Finding[] {
  const bundledFiles = artifact.files.filter(f => f.contributions !== undefined)
  if (!artifact.bundle) return bundledFiles.length || artifact.buildFlags.bundled === true ? [{ code: 'BUNDLE_PROOF_REQUIRED', subject: artifact.id }] : []
  const findings: Finding[] = []
  const fail = (code: string, subject = artifact.id) => { findings.push({ code, subject }) }
  try {
    if (artifact.buildFlags.bundled !== true) fail('BUNDLE_VARIANT_REQUIRED')
    const proof = artifact.bundle
    unique(proof.scopes.map(s => s.root), 'BUNDLE_SCOPE')
    unique(proof.scopes.map(s => s.componentId), 'BUNDLE_COMPONENT')
    const sourceRoot = inside(root, proof.sourceRoot)
    if (artifactDigest(sourceRoot) !== proof.sourceSha256) fail('BUNDLE_SOURCE_DIGEST_MISMATCH')
    const lockPath = inside(sourceRoot, proof.lock.path)
    const metafile = inside(sourceRoot, proof.metafile.path)
    if (sha256(readFileSync(lockPath)) !== proof.lock.sha256 || proof.lock.sha256 !== release.lockSha256 || readFileSync(lockPath).toString('utf8') !== lockText) fail('BUNDLE_LOCK_MISMATCH')
    if (sha256(readFileSync(metafile)) !== proof.metafile.sha256) fail('BUNDLE_METAFILE_MISMATCH')
    const evidence = collect({ root: sourceRoot, buildCwd: inside(sourceRoot, proof.buildCwd), outputRoot: inside(sourceRoot, proof.outputRoot), metafile, lock: lockPath })
    const meta = z.object({ outputs: z.record(z.string(), z.object({ inputs: z.record(z.string(), z.object({ bytesInOutput: z.number().int().nonnegative() }).strict()) }).passthrough()) }).passthrough().parse(JSON.parse(readFileSync(metafile).toString('utf8')))
    unique(evidence.outputs.map(o => o.path), 'BUNDLE_OUTPUT_PATH')
    unique(evidence.packages.flatMap(p => p.inputs.map(i => i.path)), 'BUNDLE_INPUT_PATH')
    const scopes = new Map<string, { componentId: string; scopeSha256: string; inputs: typeof evidence.packages[number]['inputs'] }>()
    for (const pkg of evidence.packages) {
      const scope = proof.scopes.find(s => s.root === pkg.root)
      if (!scope) { fail('BUNDLE_SCOPE_MISSING', pkg.root); continue }
      const component = release.components.find(c => c.id === scope.componentId)
      if (!component || component.name !== pkg.name || component.version !== pkg.version || scope.manifestSha256 !== pkg.manifestSha256) { fail('BUNDLE_SCOPE_IDENTITY_MISMATCH', pkg.root); continue }
      const installed = pkg.root.split('/').includes('node_modules')
      let registryProof: ReturnType<typeof verifyPackageArchive> | null = null
      if (installed) {
        if (component.kind !== 'dependency' || !scope.registryArchive || pkg.lockMatches.length !== 1 || pkg.lockMatches[0]?.key !== component.lockKey) { fail('BUNDLE_REGISTRY_PROOF_REQUIRED', pkg.root); continue }
        const archive = readFileSync(inside(root, scope.registryArchive.path))
        if (sha256(archive) !== scope.registryArchive.sha256) fail('BUNDLE_REGISTRY_DIGEST_MISMATCH', pkg.root)
        registryProof = verifyPackageArchive(pkg, archive)
        if (registryProof.findings.length) { fail('BUNDLE_REGISTRY_BYTES_MISMATCH', pkg.root); continue }
      } else {
        const workspace = z.object({ name: text, version: text }).passthrough().safeParse(pkg.workspaceLock)
        if (component.kind !== 'workspace' || scope.registryArchive || !workspace.success || workspace.data.name !== pkg.name || workspace.data.version !== pkg.version) { fail('BUNDLE_WORKSPACE_SCOPE_MISMATCH', pkg.root); continue }
      }
      const scopeSha256 = bundleScopeDigest(pkg, evidence.lockSha256, registryProof)
      scopes.set(pkg.root, { componentId: component.id, scopeSha256, inputs: pkg.inputs })
    }
    for (const scope of proof.scopes) if (!evidence.packages.some(p => p.root === scope.root)) fail('BUNDLE_SCOPE_EXTRA', scope.root)
    const emittedPaths = new Set<string>()
    for (const output of evidence.outputs) {
      const outputPath = relative(inside(sourceRoot, proof.outputRoot), inside(sourceRoot, output.path)).split(sep).join('/')
      const path = proof.artifactPrefix ? proof.artifactPrefix + '/' + outputPath : outputPath
      emittedPaths.add(path)
      const file = artifact.files.find(f => f.path === path)
      const graph = Object.entries(meta.outputs).find(([key]) => resolve(inside(sourceRoot, proof.outputRoot), key) === inside(sourceRoot, output.path))?.[1]
      if (!file || !file.contributions || file.sha256 !== output.sha256 || !graph) { fail('BUNDLE_OUTPUT_UNBOUND', path); continue }
      unique(file.contributions.map(c => c.componentId), 'FILE_CONTRIBUTION')
      const expected = [...scopes.values()].flatMap(scope => {
        const inputs = scope.inputs.flatMap(input => {
          const graphInput = Object.entries(graph.inputs).find(([key]) => resolve(inside(sourceRoot, proof.buildCwd), key) === inside(sourceRoot, input.path))?.[1]
          const bytesInOutput = graphInput?.bytesInOutput ?? 0
          return bytesInOutput > 0 ? [{ path: input.path, sha256: input.sha256, bytesInOutput }] : []
        }).sort((a, b) => a.path.localeCompare(b.path))
        return inputs.length ? [{ componentId: scope.componentId, scopeSha256: scope.scopeSha256, inputs }] : []
      }).sort((a, b) => a.componentId.localeCompare(b.componentId))
      const claimed = file.contributions.map(c => ({ ...c, inputs: [...c.inputs].sort((a, b) => a.path.localeCompare(b.path)) })).sort((a, b) => a.componentId.localeCompare(b.componentId))
      if (!equal(claimed, expected)) fail('BUNDLE_CONTRIBUTIONS_MISMATCH', path)
    }
    for (const file of bundledFiles) if (!emittedPaths.has(file.path)) fail('BUNDLE_OUTPUT_EXTRA', file.path)
    if (artifactDigest(sourceRoot) !== proof.sourceSha256) fail('BUNDLE_SOURCE_CHANGED')
    if (sha256(readFileSync(metafile)) !== proof.metafile.sha256 || sha256(readFileSync(lockPath)) !== release.lockSha256) fail('BUNDLE_EVIDENCE_CHANGED')
  } catch { fail('BUNDLE_PROOF_UNVERIFIED') }
  return findings
}

/** Conflicting parent/child scopes remain visible; root license never overrides web notice. */
export function AuditFileOrigin(component: Component, manifest: DecisionManifest, decision?: Decision): Finding[] {
  const scopes = manifest.knownScopes.filter(s => s.repository === component.origin.repository && s.revision === component.origin.revision && (!s.path || component.origin.path === s.path || component.origin.path.startsWith(s.path + '/')))
  const conflict = new Set(scopes.map(s => s.licenseExpression)).size > 1
  const findings: Finding[] = []
  if (component.origin.transfer === 'copy' && (!decision || decision.outcome !== 'approved' || !equal(decision.origin, component.origin))) findings.push({ code: 'COPIED_SOURCE_UNREVIEWED', subject: component.id })
  if (conflict && !decision?.conflictResolution) findings.push({ code: 'ROOT_WEB_SCOPE_CONFLICT', subject: component.id })
  return findings
}
export function ProduceSBOM(input: unknown, lockText: string, root: string, expectedSourceRevision: string, manifestInput: unknown) {
  const release = ReleaseSchema.parse(input)
  const manifest = DecisionManifestSchema.parse(manifestInput)
  if (release.sourceRevision !== expectedSourceRevision) throw new Error('SOURCE_REVISION_MISMATCH')
  if (sha256(lockText) !== release.lockSha256) throw new Error('LOCK_DIGEST_MISMATCH')
  unique(release.artifacts.map(a => a.id), 'ARTIFACT')
  unique(release.components.map(c => c.id), 'COMPONENT')
  unique(manifest.reviewers, 'REVIEWER')
  const lock = parseLock(lockText)
  const findings: Finding[] = []
  unique(manifest.requiredBundleArtifacts ?? [], 'REQUIRED_BUNDLE_ARTIFACT')
  for (const id of manifest.requiredBundleArtifacts ?? []) {
    const artifact = release.artifacts.find(a => a.id === id)
    if (!artifact || !artifact.bundle || artifact.buildFlags.bundled !== true) findings.push({ code: 'TRUSTED_BUNDLE_POLICY_REQUIRED', subject: id })
  }
  for (const artifact of release.artifacts) {
    unique(artifact.files.map(f => f.path), 'FILE')
    const actual = inventory(inside(root, artifact.contentRoot))
    const claimed = artifact.files.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    if (!equal(actual, claimed)) findings.push({ code: 'ARTIFACT_INVENTORY_MISMATCH', subject: artifact.id })
    const distributedPath = inside(root, artifact.path)
    const distributedStat = lstatSync(distributedPath)
    if (distributedStat.isFile()) {
      const bytes = readFileSync(distributedPath)
      if (sha256(bytes) !== artifact.sha256) findings.push({ code: 'ARTIFACT_DIGEST_MISMATCH', subject: artifact.id })
      try {
        if (!/\.(?:tar|tgz|tar\.gz)$/.test(artifact.path)) throw new Error('UNSUPPORTED_ARCHIVE_FORMAT')
        if (!equal(archiveInventory(bytes), claimed)) findings.push({ code: 'ARCHIVE_INVENTORY_MISMATCH', subject: artifact.id })
      } catch { findings.push({ code: 'ARCHIVE_CONTENT_UNVERIFIED', subject: artifact.id }) }
    } else {
      if (artifactDigest(distributedPath) !== artifact.sha256) findings.push({ code: 'ARTIFACT_DIGEST_MISMATCH', subject: artifact.id })
      if (distributedPath !== inside(root, artifact.contentRoot)) findings.push({ code: 'ARTIFACT_CONTENT_ROOT_MISMATCH', subject: artifact.id })
    }
    if (Object.keys(artifact.buildFlags).length === 0) findings.push({ code: 'BUILD_FLAGS_MISSING', subject: artifact.id })
    // Producers must pass an explicit nonsecret allowlisted build variant, never environment dumps.
    if (Object.keys(artifact.buildFlags).some(k => /secret|token|password|credential|oauth|api.?key/i.test(k))) throw new Error('SECRET_BUILD_FLAG_FORBIDDEN')
    if (!publicBuildFlagsSchema.safeParse(artifact.buildFlags).success) throw new Error('UNSUPPORTED_BUILD_FLAGS')
    findings.push(...ValidateBundleLinkage(release, artifact, lockText, root))
    for (const file of artifact.files) for (const id of fileComponentIds(file)) if (!release.components.some(c => c.id === id)) findings.push({ code: 'UNKNOWN_COMPONENT', subject: artifact.id + ':' + file.path })
  }
  for (const component of release.components) {
    if (!release.artifacts.some(a => a.files.some(f => fileComponentIds(f).includes(component.id)))) findings.push({ code: 'UNSHIPPED_COMPONENT', subject: component.id })
    if (component.kind === 'dependency') {
      const pin = lock.packages.find(p => p.key === component.lockKey)
      if (!pin || pin.name !== component.name || pin.version !== component.version || !pin.integrity || pin.integrity !== component.integrity) findings.push({ code: 'LOCK_COMPONENT_MISMATCH', subject: component.id })
    }
    if (component.kind === 'workspace' && !Object.values(lock.workspaces).some(w => w.name === component.name && w.version === component.version)) findings.push({ code: 'WORKSPACE_LOCK_MISMATCH', subject: component.id })
    if (!component.licenseExpression || /unknown|NOASSERTION|review.required/i.test(component.licenseExpression)) findings.push({ code: 'LICENSE_REVIEW_REQUIRED', subject: component.id })
  }
  const sbom = {
    schemaVersion: 1,
    sourceRevision: release.sourceRevision,
    lockSha256: release.lockSha256,
    lock,
    artifacts: release.artifacts.map(a => ({ ...a, ...(a.bundle ? { bundle: normalizedBundle(a.bundle) } : {}), files: a.files.map(normalizedFile).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    components: release.components.map(component => ({
      ...component,
      componentSha256: componentDigest(release, component),
      scopeEvidence: manifest.knownScopes.filter(s => s.repository === component.origin.repository && s.revision === component.origin.revision).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      reviewStatus: 'LICENSE_REVIEW_REQUIRED',
    })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    preservedNotices: [...manifest.preservedNotices].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  }
  return { release, manifest, sbom, sbomSha256: sha256(canonical(sbom)), findings }
}
export function ValidateReleaseNotices(release: Release, manifest: DecisionManifest, root: string, noticeBundle: string): Finding[] {
  const findings: Finding[] = []
  const required = [...manifest.preservedNotices, ...release.components.flatMap(c => c.notices)]
  for (const notice of required) {
    try {
      const bytes = readFileSync(inside(root, notice.path))
      if (sha256(bytes) !== notice.sha256) findings.push({ code: 'NOTICE_DIGEST_MISMATCH', subject: notice.path })
      if (!bytes.length || !noticeBundle.includes(bytes.toString('utf8'))) findings.push({ code: 'NOTICE_TEXT_MISSING', subject: notice.path })
      // A staging notice must actually ship in each audited artifact, not only sit next to it.
      for (const artifact of release.artifacts) {
        const applies = manifest.preservedNotices.some(n => equal(n, notice)) || release.components.some(c => c.notices.some(n => equal(n, notice)) && artifact.files.some(f => fileComponentIds(f).includes(c.id)))
        if (applies && !artifact.files.some(f => f.sha256 === notice.sha256)) findings.push({ code: 'NOTICE_NOT_SHIPPED', subject: artifact.id + ':' + notice.path })
      }
    } catch { findings.push({ code: 'NOTICE_UNREADABLE', subject: notice.path }) }
  }
  return findings.filter((f, i, all) => all.findIndex(x => equal(x, f)) === i)
}
export function CheckRelease(input: unknown, lockText: string, root: string, sourceRevision: string, manifestInput: unknown, noticeBundle: string) {
  const produced = ProduceSBOM(input, lockText, root, sourceRevision, manifestInput)
  const { release, manifest, sbomSha256 } = produced
  const findings = [...produced.findings, ...ValidateReleaseNotices(release, manifest, root, noticeBundle)]
  for (const artifact of release.artifacts) {
    for (const componentId of new Set(artifact.files.flatMap(fileComponentIds))) {
      const component = release.components.find(c => c.id === componentId)
      if (!component) continue
      const candidates = manifest.decisions.filter(d => d.artifactId === artifact.id && d.componentId === component.id)
      const decision = candidates.length === 1 ? candidates[0] : undefined
      const valid = decision && decision.outcome === 'approved' && manifest.reviewers.includes(decision.reviewer) && decision.artifactSha256 === artifact.sha256 && decision.sbomSha256 === sbomSha256 && decision.buildFlagsSha256 === sha256(canonical(artifact.buildFlags)) && decision.componentSha256 === componentDigest(release, component) && equal(decision.origin, component.origin) && decision.licenseExpression === component.licenseExpression && equal(decision.notices, component.notices)
      if (!valid) findings.push({ code: 'SCOPED_DECISION_REQUIRED', subject: artifact.id + ':' + component.id })
      findings.push(...AuditFileOrigin(component, manifest, valid ? decision : undefined))
    }
  }
  return { schemaVersion: 1, state: findings.length ? 'LICENSE_REVIEW_REQUIRED' : 'REVIEWED_EXACT_ARTIFACT', sourceRevision: release.sourceRevision, artifactDigests: release.artifacts.map(a => ({ id: a.id, sha256: a.sha256 })), sbomSha256, findings, sbom: produced.sbom }
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: Object.fromEntries(['release', 'root', 'lock', 'decisions', 'notices', 'source-revision', 'review-revision', 'auditor-revision', 'output'].map(k => [k, { type: 'string' as const }])) })
    const mode = positionals[0]
    if (positionals.length !== 1 || (mode !== 'generate' && mode !== 'check')) throw new Error('Expected generate or check')
    function requiredArgument(key: string): string {
      const value = values[key]
      if (typeof value !== 'string' || value.length === 0) throw new Error('Missing --' + key)
      return value
    }
    const releasePath = requiredArgument('release')
    const decisionsPath = requiredArgument('decisions')
    const lockPath = requiredArgument('lock')
    const artifactRoot = requiredArgument('root')
    const sourceRevision = requiredArgument('source-revision')
    const noticesPath = requiredArgument('notices')
    const outputPath = requiredArgument('output')
    const release: unknown = JSON.parse(readFileSync(releasePath, 'utf8'))
    const decisionBytes = readFileSync(decisionsPath, 'utf8')
    const decisions: unknown = JSON.parse(decisionBytes)
    const noticeBytes = readFileSync(noticesPath, 'utf8')
    const reviewBinding = mode === 'check' ? {
      reviewRevision: revision.parse(requiredArgument('review-revision')),
      auditorRevision: revision.parse(requiredArgument('auditor-revision')),
      decisionManifestSha256: sha256(decisionBytes),
      noticeBundleSha256: sha256(noticeBytes),
    } : undefined
    const lock = readFileSync(lockPath, 'utf8')
    const result = mode === 'check' ? CheckRelease(release, lock, artifactRoot, sourceRevision, decisions, noticeBytes) : ProduceSBOM(release, lock, artifactRoot, sourceRevision, decisions)
    writeFileSync(outputPath, JSON.stringify({ ...result, ...(reviewBinding ? { reviewBinding } : {}) }, null, 2) + '\n')
    if (mode === 'check' && 'state' in result && result.state !== 'REVIEWED_EXACT_ARTIFACT') process.exitCode = 1
  } catch (error) {
    // Do not echo producer payload, paths, environment, or secret build values.
    const failure = error instanceof z.ZodError ? 'INVALID_COMPLIANCE_SCHEMA' : error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message) ? error.message : 'COMPLIANCE_AUDIT_FAILED'
    console.error(failure)
    process.exitCode = 2
  }
}
