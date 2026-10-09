/**
 * Dev Space security block (03-SPEC-features §3.4) — public surface.
 * Consumed by the `devSpace:generateQuestions` handler.
 */
export { defaultOsvQuery, defaultSbomRunner, parseSyftPackages, runSecurityScan } from './sbom-cve.ts'
export type {
  DevSpaceSecurityArtifact, DevSpaceSecurityScan, DevSpaceSecurityScanInput, OsvPackage, OsvQuery, OsvQueryResult, OsvVulnerability,
} from './sbom-cve.ts'