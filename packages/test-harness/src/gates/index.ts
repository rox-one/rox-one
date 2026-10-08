/** W1-10 (#1507) — gate runner surface. */
export type { GateResult, GateStatus } from './types.ts'
export { pending, pendingUntilBrowserDriver, inputBroken, BROWSER_DRIVER_NOTE } from './types.ts'
export { checkDdlZodParity, extractTables, extractZodKeys, extractZodObjects, normalizeFieldName, UNIFIED_MIGRATION_RE } from './ddl-parity.ts'
export { runPermissionMatrixGate, type PermissionMatrixRow } from './permission-matrix.ts'
export { checkRiskClassPresence, CATALOGUE_PATH } from './risk-class.ts'
export { checkNegativeTestPresence, NEGATIVE_KEYWORDS, DEFAULT_TEST_ROOTS, coveredCommands } from './negative-tests.ts'
export { readCatalogue, parseCatalogueSource, COMMAND_ID_RE, type CommandDefinitionSource } from './catalogue.ts'
export { runConfigPathsGate, CONFIG_PATHS_SCRIPT } from './config-paths.ts'
export { checkVisualGate, checkAxeGate } from './visual-axe.ts'
export {
  lintChromeSchemas,
  checkChromeLintGate,
  checkOneRailGate,
  checkOneRailGatePending,
  checkDockLayoutGate,
  type ChromeSchema,
} from './chrome-dock.ts'
export { checkAgentPrivacy, checkAgentPrivacyGate, type AttachDecision } from './agent-privacy.ts'
export { checkProvenanceFiles, type ProvenanceFile } from './provenance.ts'
export { runAllGates, gatesExitCode, formatGateResults } from './run-all.ts'
