/** W1-10 (#1507) — gate runner surface. */
export type { GateResult, GateStatus } from './types.ts'
export { pending, pendingUntilBrowserDriver, inputBroken, BROWSER_DRIVER_NOTE } from './types.ts'
export {
  checkDdlZodParity,
  extractTables,
  extractAddedColumns,
  extractUnifiedTables,
  extractZodKeys,
  extractZodObjects,
  normalizeFieldName,
  UNIFIED_MIGRATION_RE,
  DDL_ALLOWLIST_PATH,
} from './ddl-parity.ts'
export {
  runPermissionMatrixGate,
  checkPermissionMatrixRows,
  specAllowed,
  specEffectiveRole,
  PERMISSIONS_PATH,
  type PermissionMatrixRow,
} from './permission-matrix.ts'
export { checkRiskClassPresence, CATALOGUE_PATH } from './risk-class.ts'
export {
  checkNegativeTestPresence,
  NEGATIVE_TITLE_RE,
  NEGATIVE_CODE_TOKENS,
  DEFAULT_TEST_ROOTS,
  EXCLUDED_TEST_DIRS,
  coveredCommands,
} from './negative-tests.ts'
export {
  loadCatalogue,
  CATALOGUE_MODULE_PATH,
  COMMAND_REGISTRY_PATH,
  COMMAND_ALLOWLIST_PATH,
  COMMAND_ID_RE,
  type CatalogueCommand,
  type CatalogueReadout,
} from './catalogue.ts'
export {
  ALLOWLIST_DIR,
  parseAllowlist,
  readAllowlist,
  shrinkOnlyViolations,
  resolveAllowlist,
  type AllowlistInputs,
} from './allowlist.ts'
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
export { checkAgentPrivacy, checkAgentPrivacyGate, type AttachDecision, type AttachProvider } from './agent-privacy.ts'
export { checkProvenanceFiles, eeDeclarations, EE_DECLARATION_RES, type ProvenanceFile } from './provenance.ts'
export { runAllGates, gatesExitCode, formatGateResults, perfGate } from './run-all.ts'
