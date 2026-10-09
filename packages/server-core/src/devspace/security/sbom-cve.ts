/**
 * Dev Space security block (03-SPEC-features §3.4, 02-SPEC-foundations §8.5).
 *
 * SBOM is produced by the existing optional `runSyftSbom` (never installs a
 * tool); CVE data is fetched from OSV **only** under the per-repo
 * `consent.items.cveNetwork` grant. No silent egress: when the consent is absent
 * the CVE half is skipped with a machine-readable reason and the block degrades
 * honestly. A missing `syft` binary is a skip, never an install or a fabrication.
 *
 * Every result is returned as a serialisable JSON artifact so the handler can
 * persist it through `writeDevSpaceArtifact` (kind `sbom-cve`, dir `security/`).
 * Network and process access are injected seams, so the module is fully testable
 * without touching either.
 */
import { execFile } from 'node:child_process'
import { runSyftSbom, type CommandRunner } from '@rox/shared/code-intelligence'
import type { DevSpaceSecuritySummary } from '@rox/shared/dev-space'
import { parseToolVersion } from '../adapters/contract.ts'

/** syft can be slow on large repos; this is the ceiling, not a target. */
const SYFT_TIMEOUT_MS = 120_000
/** Generous cap so a large SBOM never trips `maxBuffer` (matches the tool adapters). */
const SYFT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
/** OSV batch endpoint; `querybatch` accepts up to 1000 queries per request. */
const OSV_ENDPOINT = 'https://api.osv.dev/v1/querybatch'
const OSV_BATCH_LIMIT = 100
const OSV_TIMEOUT_MS = 20_000
/** Bound the egress: at most this many packages are queried per scan. */
const OSV_MAX_PACKAGES = 500

/** One SBOM package mapped to an OSV ecosystem. */
export interface OsvPackage {
  readonly name: string
  readonly version: string
  readonly ecosystem: string
}

export interface OsvVulnerability {
  /** `<ecosystem>:<name>@<version>` of the affected package. */
  readonly package: string
  readonly ids: readonly string[]
  readonly count: number
}

export interface OsvQueryResult {
  readonly packages: number
  readonly vulnerabilityCount: number
  readonly vulnerabilities: readonly OsvVulnerability[]
  readonly errors: readonly string[]
}

/** Injectable OSV client; the default uses `fetch` against `api.osv.dev`. */
export type OsvQuery = (packages: readonly OsvPackage[], signal: AbortSignal) => Promise<OsvQueryResult>

/** One JSON artifact to persist (handler maps it to `writeDevSpaceArtifact`). */
export interface DevSpaceSecurityArtifact {
  readonly name: string
  readonly format: 'json'
  readonly content: string
  readonly producedBy: { readonly providerId: string; readonly version: string }
}

export interface DevSpaceSecurityScanInput {
  /** Repository working copy — the syft target. */
  readonly cwd: string
  /** `consent.items.cveNetwork`; `false` skips OSV entirely. */
  readonly cveNetwork: boolean
  readonly signal: AbortSignal
  /** SBOM command runner seam; defaults to a bounded `execFile` of the real `syft`. */
  readonly runCommand?: CommandRunner
  /** OSV client seam; defaults to the real HTTP client. */
  readonly queryOsv?: OsvQuery
}

export interface DevSpaceSecurityScan {
  readonly summary: DevSpaceSecuritySummary
  readonly artifacts: readonly DevSpaceSecurityArtifact[]
}

/** Real syft runner: no shell, bounded time and output. Never installs. */
export function defaultSbomRunner(argv: readonly string[]): Promise<{ ok: boolean; stdout: string }> {
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; stdout: string }>()
  execFile(argv[0] as string, [...argv.slice(1)], {
    timeout: SYFT_TIMEOUT_MS, maxBuffer: SYFT_MAX_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8',
  }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? '') }))
  return promise
}

/** syft artifact `type` → OSV ecosystem; unknown types are not queryable on OSV. */
const ECOSYSTEM_BY_SYFT_TYPE: Readonly<Record<string, string>> = {
  npm: 'npm', yarn: 'npm', pnpm: 'npm', node: 'npm', 'node-module': 'npm',
  python: 'PyPI', pip: 'PyPI', wheel: 'PyPI', egg: 'PyPI', poetry: 'PyPI',
  go: 'Go', 'go-module': 'Go',
  gem: 'RubyGems', ruby: 'RubyGems',
  cargo: 'crates.io', 'rust-crate': 'crates.io',
  'java-archive': 'Maven', 'jenkins-plugin': 'Maven', maven: 'Maven',
  nuget: 'NuGet', dotnet: 'NuGet',
}

/**
 * Parse syft JSON (`-o json`, syft-json shape: `artifacts[]`) into OSV-queryable
 * packages. Unmappable types are dropped; duplicates are collapsed. Malformed
 * input yields an empty list — never a throw.
 */
export function parseSyftPackages(raw: string): OsvPackage[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const value = parsed as Record<string, unknown>
  const list = Array.isArray(value.artifacts) ? value.artifacts : Array.isArray(value.packages) ? value.packages : []
  const seen = new Set<string>()
  const packages: OsvPackage[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const pkg = entry as Record<string, unknown>
    const name = typeof pkg.name === 'string' ? pkg.name : null
    const version = typeof pkg.version === 'string' ? pkg.version : null
    const ecosystem = typeof pkg.type === 'string' ? ECOSYSTEM_BY_SYFT_TYPE[pkg.type] : undefined
    if (!name || !version || !ecosystem) continue
    const key = `${ecosystem}:${name}@${version}`
    if (seen.has(key)) continue
    seen.add(key)
    packages.push({ name, version, ecosystem })
  }
  return packages
}

interface OsvVulnResponse { readonly id?: unknown }
interface OsvQueryResponse { readonly results?: readonly { readonly vulns?: readonly OsvVulnResponse[] }[] }

/** `fetch` bounded by a caller `AbortSignal` and a hard timeout. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal: AbortSignal): Promise<Response> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
}

/** Default OSV client: batched `POST /v1/querybatch`, bounded and cancellable. */
export const defaultOsvQuery: OsvQuery = async (packages, signal) => {
  const vulnerabilities: OsvVulnerability[] = []
  const errors: string[] = []
  const bounded = packages.slice(0, OSV_MAX_PACKAGES)
  for (let offset = 0; offset < bounded.length; offset += OSV_BATCH_LIMIT) {
    const batch = bounded.slice(offset, offset + OSV_BATCH_LIMIT)
    const response = await fetchWithTimeout(OSV_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: batch.map(pkg => ({ package: { name: pkg.name, ecosystem: pkg.ecosystem }, version: pkg.version })) }),
    }, OSV_TIMEOUT_MS, signal)
    if (!response.ok) { errors.push(`osv-http-${response.status}`); continue }
    const body = await response.json() as OsvQueryResponse
    const results = body.results ?? []
    batch.forEach((pkg, index) => {
      const ids = (results[index]?.vulns ?? []).map(vuln => (typeof vuln.id === 'string' ? vuln.id : 'unknown'))
      if (ids.length > 0) vulnerabilities.push({ package: `${pkg.ecosystem}:${pkg.name}@${pkg.version}`, ids, count: ids.length })
    })
  }
  return {
    packages: bounded.length,
    vulnerabilityCount: vulnerabilities.reduce((sum, entry) => sum + entry.count, 0),
    vulnerabilities,
    errors,
  }
}

/** Presence of `syft` without running a scan (version probe via the same runner). */
async function probeSyftVersion(run: CommandRunner): Promise<string | undefined> {
  try {
    const result = await run(['syft', 'version'])
    return result.ok ? parseToolVersion(result.stdout) : undefined
  } catch { return undefined }
}

/**
 * Run the local SBOM and (under consent) the OSV CVE query, returning a summary
 * and the JSON artifacts to persist. Never installs, never egresses without the
 * `cveNetwork` grant, never fails on a missing tool.
 */
export async function runSecurityScan(input: DevSpaceSecurityScanInput): Promise<DevSpaceSecurityScan> {
  const run = input.runCommand ?? defaultSbomRunner
  const cveNetwork = input.cveNetwork
  const artifacts: DevSpaceSecurityArtifact[] = []
  const reasons: string[] = []

  const scan = await runSyftSbom(input.cwd, run)
  let sbomStatus: 'ok' | 'unavailable' = 'unavailable'
  let sbomReason: string | undefined
  let packageCount = 0
  let packages: OsvPackage[] = []
  if (!scan.available) {
    sbomReason = 'syft-unavailable'
    reasons.push(sbomReason)
  } else {
    const raw = scan.documents[0] ?? ''
    packages = parseSyftPackages(raw)
    packageCount = packages.length
    sbomStatus = 'ok'
    artifacts.push({
      name: 'sbom.json', format: 'json', content: raw,
      producedBy: { providerId: 'syft', version: (await probeSyftVersion(run)) ?? 'unknown' },
    })
  }

  let cveStatus: 'ok' | 'skipped' | 'error' = 'skipped'
  let vulnerabilityCount = 0
  let cveReason: string | undefined
  if (sbomStatus !== 'ok') {
    cveReason = 'sbom-unavailable'
  } else if (!cveNetwork) {
    cveReason = 'cve-consent-denied'
    reasons.push(cveReason)
  } else if (packages.length === 0) {
    cveReason = 'no-packages'
  } else {
    try {
      const result = await (input.queryOsv ?? defaultOsvQuery)(packages, input.signal)
      cveStatus = 'ok'
      vulnerabilityCount = result.vulnerabilityCount
      if (result.errors.length > 0) reasons.push(...result.errors)
      artifacts.push({
        name: 'cve.json', format: 'json',
        content: JSON.stringify({ schemaVersion: 1, packageCount: result.packages, vulnerabilityCount, vulnerabilities: result.vulnerabilities, errors: result.errors }, null, 2),
        producedBy: { providerId: 'osv', version: 'v1' },
      })
    } catch {
      cveStatus = 'error'
      cveReason = 'osv-error'
      reasons.push(cveReason)
    }
  }

  const summary: DevSpaceSecuritySummary = {
    sbom: { status: sbomStatus, packageCount, ...(sbomReason ? { reason: sbomReason } : {}) },
    cve: { status: cveStatus, vulnerabilityCount, ...(cveReason ? { reason: cveReason } : {}) },
    reasons,
  }
  artifacts.push({
    name: 'security-summary.json', format: 'json', content: JSON.stringify(summary, null, 2),
    producedBy: { providerId: 'devspace-security', version: '1' },
  })
  return { summary, artifacts }
}