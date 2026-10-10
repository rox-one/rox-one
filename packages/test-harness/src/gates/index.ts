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
  STRONG_NEGATIVE_RE,
  TEST_TITLE_NEGATIVE_RE,
  TEST_SHAPES_HELP,
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
export {
  runProvenanceGate,
  runVersionParityGate,
  runIpcSendsGate,
  runToolNameChecksGate,
  PROVENANCE_SCRIPT,
  VERSION_PARITY_SCRIPT,
  IPC_SENDS_SCRIPT,
  TOOL_NAME_CHECKS_SCRIPT,
  PROVENANCE_TIMEOUT_MS,
  VERSION_PARITY_TIMEOUT_MS,
  IPC_SENDS_TIMEOUT_MS,
  TOOL_NAME_CHECKS_TIMEOUT_MS,
} from './script-gates.ts'
export { checkVisualGate, checkAxeGate, VISUAL_CAPTURE_COMMAND, VISUAL_CAPTURE_UPDATE_COMMAND, MAX_REPORTED_KEYS } from './visual-axe.ts'
export {
  lintChromeSchemas,
  checkChromeLintGate,
  checkOneRailGate,
  checkOneRailGatePending,
  checkOneRailGateAll,
  checkDockLayoutGate,
  type ChromeSchema,
} from './chrome-dock.ts'
export { checkAgentPrivacy, checkAgentPrivacyGate, type AttachDecision, type AttachProvider } from './agent-privacy.ts'
export { checkProvenanceFiles, eeDeclarations, EE_DECLARATION_RES, type ProvenanceFile } from './provenance.ts'
export { runAllGates, gatesExitCode, formatGateResults, perfGate } from './run-all.ts'
