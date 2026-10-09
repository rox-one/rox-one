/**
 * Security block (03-SPEC-features §3.4, 02-SPEC-foundations §8.5): SBOM via the
 * optional syft runner and CVE via OSV strictly under `cveNetwork` consent.
 */
import { describe, expect, it } from 'bun:test'
import type { CommandRunner } from '@rox/shared/code-intelligence'
import { parseSyftPackages, runSecurityScan } from '../security/sbom-cve.ts'
import type { OsvQuery } from '../security/sbom-cve.ts'

const SBOM_JSON = JSON.stringify({
  artifacts: [
    { name: 'lodash', version: '4.17.20', type: 'npm' },
    { name: 'lodash', version: '4.17.20', type: 'npm' },
    { name: 'requests', version: '2.28.0', type: 'python' },
    { name: 'mystery', version: '1.0.0', type: 'not-an-osv-ecosystem' },
  ],
})

const okRunner: CommandRunner = async argv => {
  if (argv[0] !== 'syft') return { ok: false, stdout: '' }
  if (argv[1] === 'version') return { ok: true, stdout: 'Application: syft\nVersion: 1.9.0\n' }
  return { ok: true, stdout: SBOM_JSON }
}

const missingRunner: CommandRunner = async () => ({ ok: false, stdout: '' })

const signal = (): AbortSignal => new AbortController().signal

describe('parseSyftPackages', () => {
  it('maps syft types to OSV ecosystems, dedupes and drops unmappable types', () => {
   expect(parseSyftPackages(SBOM_JSON)).toEqual([
      { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
      { name: 'requests', version: '2.28.0', ecosystem: 'PyPI' },
    ])
  })

  it('returns an empty list on malformed input instead of throwing', () => {
    expect(parseSyftPackages('{ not json')).toEqual([])
    expect(parseSyftPackages('[]')).toEqual([])
  })
})

describe('runSecurityScan', () => {
  it('skips honestly when syft is absent (never installs, never fabricates)', async () => {
    const scan = await runSecurityScan({ cwd: '/repo', cveNetwork: true, signal: signal(), runCommand: missingRunner })
    expect(scan.summary.sbom).toEqual({ status: 'unavailable', packageCount: 0, reason: 'syft-unavailable' })
    expect(scan.summary.cve).toEqual({ status: 'skipped', vulnerabilityCount: 0, reason: 'sbom-unavailable' })
    expect(scan.summary.reasons).toContain('syft-unavailable')
    expect(scan.artifacts.map(artifact => artifact.name)).toEqual(['security-summary.json'])
  })

  it('writes the SBOM but skips CVE when cveNetwork consent is absent', async () => {
    const scan = await runSecurityScan({ cwd: '/repo', cveNetwork: false, signal: signal(), runCommand: okRunner })
    expect(scan.summary.sbom).toEqual({ status: 'ok', packageCount: 2 })
    expect(scan.summary.cve).toEqual({ status: 'skipped', vulnerabilityCount: 0, reason: 'cve-consent-denied' })
    expect(scan.summary.reasons).toContain('cve-consent-denied')
    const names = scan.artifacts.map(artifact => artifact.name)
    expect(names).toContain('sbom.json')
    expect(names).not.toContain('cve.json')
    expect(scan.artifacts.find(artifact => artifact.name === 'sbom.json')!.producedBy).toEqual({ providerId: 'syft', version: '1.9.0' })
  })

  it('queries OSV only under consent and records vulnerabilities', async () => {
    let queried: readonly { name: string; ecosystem: string }[] = []
    const queryOsv: OsvQuery = async packages => {
      queried = packages
      return { packages: packages.length, vulnerabilityCount: 1, vulnerabilities: [{ package: 'npm:lodash@4.17.20', ids: ['GHSA-x'], count: 1 }], errors: [] }
    }
    const scan = await runSecurityScan({ cwd: '/repo', cveNetwork: true, signal: signal(), runCommand: okRunner, queryOsv })
    expect(queried.map(pkg => `${pkg.ecosystem}:${pkg.name}`)).toEqual(['npm:lodash', 'PyPI:requests'])
    expect(scan.summary.cve).toEqual({ status: 'ok', vulnerabilityCount: 1 })
    expect(scan.summary.reasons).toEqual([])
    expect(scan.artifacts.find(artifact => artifact.name === 'cve.json')!.producedBy).toEqual({ providerId: 'osv', version: 'v1' })
  })

  it('degrades to an error status when OSV throws', async () => {
    const queryOsv: OsvQuery = async () => { throw new Error('offline') }
    const scan = await runSecurityScan({ cwd: '/repo', cveNetwork: true, signal: signal(), runCommand: okRunner, queryOsv })
    expect(scan.summary.cve).toEqual({ status: 'error', vulnerabilityCount: 0, reason: 'osv-error' })
    expect(scan.summary.reasons).toContain('osv-error')
  })
})