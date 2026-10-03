import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { IdentityDomainError } from '../../../../../packages/shared/src/workspace-domain/identity/contracts.ts'
import type { LicenseDecisionReference, LicenseEvidence } from '../../../../../packages/shared/src/workspace-domain/licenses/contracts.ts'
const MAX_REGISTRY_BYTES = 1048576
const MAX_AUDIT_BYTES = 33554432
const MAX_CHECKER_OUTPUT_BYTES = 65536
const CHECKER_TIMEOUT_MS = 30000
const MAX_RELEASE_RESOURCES = 64
const CHECKER_MODULES = ['generate-sbom.ts', 'collect-build-attribution.ts', 'verify-registry-attribution.ts']
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const revision = z.string().regex(/^[a-f0-9]{40}$/)
const uuid = z.string().uuid()
const absolute = z.string().min(1).max(4096).refine(isAbsolute)
const inputFile = z.object({ path: absolute, sha256: digest }).strict()
const policy = z.object({ mode: z.literal('owner_bootstrap'), read: z.boolean(), write: z.boolean(), action: z.boolean() }).strict()
const entrySchema = z.object({ resourceId: uuid, workspaceId: uuid, label: z.string().min(1).max(256), root: absolute, release: inputFile, lock: inputFile, review: inputFile, notices: inputFile, build: inputFile, policy }).strict()
const registrySchema = z.object({ schemaVersion: z.literal(1), stateDirectory: absolute, checker: z.object({ path: absolute, sha256: digest, revision, bunSha256: digest, modules: z.array(inputFile).min(3).max(16) }).strict(), resources: z.array(entrySchema).max(MAX_RELEASE_RESOURCES) }).strict()
const buildSchema = z.object({ schemaVersion: z.literal(1), artifactDigest: digest, sbomDigest: digest, releaseSha256: digest, lockSha256: digest, reviewSha256: digest, noticeSha256: digest, sourceRevision: revision, reviewRevision: revision, checkerRevision: revision, checkerSha256: digest, producerRevision: revision }).strict()
const evidenceSchema = z.object({ state: z.enum(['review_required', 'reviewed_exact_artifact']), findings: z.array(z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/), subject: z.string().max(4096) }).strict()).max(100000), components: z.array(z.object({ id: z.string().min(1).max(256), name: z.string().min(1).max(256), version: z.string().min(1).max(256), componentSha256: digest, licenseExpression: z.string().max(4096).nullable() }).strict()).max(100000) }).strict()
export const licenseHash = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex')
export function licenseCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(licenseCanonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => JSON.stringify(key) + ':' + licenseCanonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
export function validateLicenseEvidence(value: unknown): LicenseEvidence { try { return evidenceSchema.parse(value) } catch { throw new IdentityDomainError('PROVIDER_UNAVAILABLE') } }
export type TrustedLicenseResource = z.infer<typeof entrySchema> & { readonly bindingSha256: string; readonly buildReceipt: z.infer<typeof buildSchema> }
async function noSymlinks(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error('INVALID_TRUSTED_PATH')
  let cursor: string = sep
  for (const part of resolve(path).split(sep).filter(Boolean)) { cursor = join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error('INVALID_TRUSTED_PATH') }
}
async function boundedFile(path: string, maximum: number, protectedOnly = false): Promise<Buffer> {
  await noSymlinks(path)
  const info = await lstat(path, { bigint: true })
  if ((protectedOnly && (info.mode & 0o7777n) !== 0o600n) || !info.isFile() || info.size > BigInt(maximum) || (info.mode & 0o022n) !== 0n || typeof process.getuid !== 'function' || info.uid !== BigInt(process.getuid())) throw new Error('INVALID_TRUSTED_INPUT')
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await fd.stat({ bigint: true }); const bytes = await fd.readFile(); const after = await fd.stat({ bigint: true })
    if (before.dev !== info.dev || before.ino !== info.ino || before.size !== info.size || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || after.mode !== before.mode || bytes.length > maximum) throw new Error('TRUSTED_INPUT_CHANGED')
    return bytes
  } finally { await fd.close() }
}
const MAX_ARTIFACT_BYTES = 536870912
const MAX_ARTIFACT_FILES = 100000
const HASH_CHUNK_BYTES = 65536
async function artifactFileDigest(path: string): Promise<string> {
  await noSymlinks(path)
  const info=await lstat(path,{bigint:true})
  if(!info.isFile()||info.size>BigInt(MAX_ARTIFACT_BYTES))throw new Error('ARTIFACT_BINDING_UNAVAILABLE')
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try {
    const before=await fd.stat({bigint:true});if(before.ino!==info.ino||before.dev!==info.dev||before.size!==info.size)throw new Error('ARTIFACT_CHANGED')
    const hash=createHash('sha256');const buffer=Buffer.alloc(HASH_CHUNK_BYTES);let offset=0
    while(true){const next=await fd.read(buffer,0,buffer.length,offset);if(!next.bytesRead)break;offset+=next.bytesRead;if(offset>MAX_ARTIFACT_BYTES)throw new Error('ARTIFACT_SIZE_LIMIT');hash.update(buffer.subarray(0,next.bytesRead))}
    const after=await fd.stat({bigint:true});if(after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||BigInt(offset)!==after.size)throw new Error('ARTIFACT_CHANGED')
    return hash.digest('hex')
  } finally {await fd.close()}
}
async function trustedArtifactDigest(path:string):Promise<string>{
  await noSymlinks(path);const stat=await lstat(path);if(stat.isFile())return artifactFileDigest(path)
  if(!stat.isDirectory())throw new Error('ARTIFACT_BINDING_UNAVAILABLE')
  const files:{path:string;sha256:string}[]=[]
  async function walk(directory:string,prefix:string):Promise<void>{
    for(const entry of await readdir(directory,{withFileTypes:true})){const child=join(directory,entry.name);const name=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())await walk(child,name);else if(entry.isFile()){if(files.length>=MAX_ARTIFACT_FILES)throw new Error('ARTIFACT_ENTRY_LIMIT');files.push({path:name,sha256:await artifactFileDigest(child)})}else throw new Error('ARTIFACT_ENTRY_UNAVAILABLE')}
  }
  await walk(path,'');files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);return licenseHash(licenseCanonical(files))
}

async function protectedRegistryFile(path: string, maximum: number): Promise<Buffer> { return boundedFile(path, maximum, true) }
export class TrustedLicenseRegistry {
  private constructor(private readonly input: z.infer<typeof registrySchema>, readonly resources: readonly TrustedLicenseResource[]) {}
  static async load(path: string): Promise<TrustedLicenseRegistry> {
    try {
      await noSymlinks(path)
      const input = registrySchema.parse(JSON.parse((await protectedRegistryFile(path, MAX_REGISTRY_BYTES)).toString('utf8')))
      if (new Set(input.resources.map(row => row.resourceId)).size !== input.resources.length) throw new Error('DUPLICATE_RESOURCE')
      if (new Set(input.checker.modules.map(row => row.path)).size !== input.checker.modules.length || CHECKER_MODULES.some(name => !input.checker.modules.some(row => row.path === join(dirname(input.checker.path), name)))) throw new Error('CHECKER_MODULE_BINDING_REQUIRED')
      if (input.checker.path !== join(dirname(input.checker.path), 'generate-sbom.ts')) throw new Error('CHECKER_BINDING_REQUIRED')
      await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 }); await noSymlinks(input.stateDirectory)
      const state = await lstat(input.stateDirectory); if (!state.isDirectory() || (state.mode & 0o777) !== 0o700 || typeof process.getuid !== 'function' || state.uid !== process.getuid()) throw new Error('INVALID_STATE_DIRECTORY')
      const resources: TrustedLicenseResource[] = []
      for (const row of input.resources) {
        await noSymlinks(row.root)
        const bytes = await protectedRegistryFile(row.build.path, MAX_REGISTRY_BYTES)
        if (licenseHash(bytes) !== row.build.sha256) throw new Error('BUILD_BINDING_CHANGED')
        const buildReceipt = buildSchema.parse(JSON.parse(bytes.toString('utf8')))
        if (buildReceipt.releaseSha256 !== row.release.sha256 || buildReceipt.lockSha256 !== row.lock.sha256 || buildReceipt.reviewSha256 !== row.review.sha256 || buildReceipt.noticeSha256 !== row.notices.sha256 || buildReceipt.checkerSha256 !== input.checker.sha256 || buildReceipt.checkerRevision !== input.checker.revision) throw new Error('BUILD_BINDING_MISMATCH')
        resources.push(Object.freeze({ ...row, bindingSha256: licenseHash(licenseCanonical({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'policy')), checker: input.checker })), buildReceipt }))
      }
      const registry = new TrustedLicenseRegistry(input, resources); await registry.verifyChecker(); return registry
    } catch { throw new IdentityDomainError('PROVIDER_UNAVAILABLE') }
  }
  resource(resourceId: string, workspaceId: string): TrustedLicenseResource {
    const row = this.resources.find(item => item.resourceId === resourceId && item.workspaceId === workspaceId)
    if (!row) throw new IdentityDomainError('NOT_FOUND')
    return row
  }
  reference(row: TrustedLicenseResource, policyEpoch: string): LicenseDecisionReference {
    return { resourceId: row.resourceId, policyEpoch, reviewRevision: row.buildReceipt.reviewRevision, reviewSha256: row.review.sha256, checkerRevision: this.input.checker.revision, checkerSha256: this.input.checker.sha256, buildSha256: row.build.sha256 }
  }
  private async verifyChecker(): Promise<void> {
    if (licenseHash(await boundedFile(process.execPath, MAX_AUDIT_BYTES * 4)) !== this.input.checker.bunSha256 || licenseHash(await boundedFile(this.input.checker.path, MAX_AUDIT_BYTES)) !== this.input.checker.sha256) throw new Error('TRUSTED_CHECKER_CHANGED')
    for (const row of this.input.checker.modules) if (licenseHash(await boundedFile(row.path, MAX_AUDIT_BYTES)) !== row.sha256) throw new Error('TRUSTED_MODULE_CHANGED')
  }
  private async verifyInputs(row: TrustedLicenseResource): Promise<void> {
    await this.verifyChecker(); await noSymlinks(row.root)
    for (const file of [row.release, row.lock, row.review, row.notices]) if (licenseHash(await boundedFile(file.path, MAX_AUDIT_BYTES)) !== file.sha256) throw new Error('TRUSTED_EVIDENCE_CHANGED')
    if (licenseHash(await protectedRegistryFile(row.build.path, MAX_REGISTRY_BYTES)) !== row.build.sha256) throw new Error('TRUSTED_BUILD_CHANGED')
    const release=z.object({artifacts:z.array(z.object({path:z.string().min(1),sha256:digest}).passthrough()).min(1).max(128)}).passthrough().parse(JSON.parse((await boundedFile(row.release.path,MAX_AUDIT_BYTES)).toString('utf8')))
    for(const artifact of release.artifacts){const target=resolve(row.root,artifact.path);const rel=relative(row.root,target);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)||artifact.path.includes('\\'))throw new Error('TRUSTED_ARTIFACT_ESCAPE');if(await trustedArtifactDigest(target)!==artifact.sha256)throw new Error('TRUSTED_ARTIFACT_CHANGED')}
  }
  /** Execute the fixed independently trusted checker, not an injected callback or client executable. */
  async evaluate(row: TrustedLicenseResource): Promise<LicenseEvidence> {
    let directory: string | undefined
    try {
      await this.verifyInputs(row); directory = await mkdtemp(join(this.input.stateDirectory, 'audit-'))
      const output = join(directory, 'audit.json'); const exec = promisify(execFile)
      let exitCode = 0
      try { await exec(process.execPath, [this.input.checker.path, 'check', '--release', row.release.path, '--root', row.root, '--lock', row.lock.path, '--decisions', row.review.path, '--notices', row.notices.path, '--source-revision', row.buildReceipt.sourceRevision, '--review-revision', row.buildReceipt.reviewRevision, '--auditor-revision', this.input.checker.revision, '--output', output], { timeout: CHECKER_TIMEOUT_MS, maxBuffer: MAX_CHECKER_OUTPUT_BYTES }) }
      catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 1) throw new Error('CHECKER_EXECUTION_FAILED')
        exitCode = 1
      }
      const audit = z.object({ state: z.enum(['LICENSE_REVIEW_REQUIRED', 'REVIEWED_EXACT_ARTIFACT']), sbomSha256: digest, artifactDigests: z.array(z.object({ id: z.string(), sha256: digest }).strict()), findings: evidenceSchema.shape.findings, sbom: z.object({ sourceRevision: revision, lockSha256: digest, components: z.array(z.object({ id: z.string(), name: z.string(), version: z.string(), componentSha256: digest, licenseExpression: z.string().nullable() }).passthrough()) }).passthrough(), reviewBinding: z.object({ reviewRevision: revision, auditorRevision: revision, decisionManifestSha256: digest, noticeBundleSha256: digest }).strict() }).passthrough().parse(JSON.parse((await boundedFile(output, MAX_AUDIT_BYTES)).toString('utf8')))
      const artifactDigest = licenseHash(licenseCanonical([...audit.artifactDigests].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
      if (artifactDigest !== row.buildReceipt.artifactDigest || audit.sbomSha256 !== row.buildReceipt.sbomDigest || audit.sbom.sourceRevision !== row.buildReceipt.sourceRevision || audit.sbom.lockSha256 !== row.lock.sha256 || audit.reviewBinding.reviewRevision !== row.buildReceipt.reviewRevision || audit.reviewBinding.auditorRevision !== this.input.checker.revision || audit.reviewBinding.decisionManifestSha256 !== row.review.sha256 || audit.reviewBinding.noticeBundleSha256 !== row.notices.sha256 || (exitCode === 0) !== (audit.state === 'REVIEWED_EXACT_ARTIFACT')) throw new Error('CHECKER_BINDING_MISMATCH')
      await this.verifyInputs(row)
      return validateLicenseEvidence({ state: audit.state === 'REVIEWED_EXACT_ARTIFACT' ? 'reviewed_exact_artifact' : 'review_required', findings: audit.findings, components: audit.sbom.components.map(c => ({ id: c.id, name: c.name, version: c.version, componentSha256: c.componentSha256, licenseExpression: c.licenseExpression })) })
    } catch { throw new IdentityDomainError('PROVIDER_UNAVAILABLE') }
    finally { if (directory) await rm(directory, { recursive: true, force: true }) }
  }
}
