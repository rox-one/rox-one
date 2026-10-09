/**
 * Skills Module
 *
 * Workspace skills are specialized instructions that extend Claude's capabilities.
 */

export * from './types.ts';
export {
  GLOBAL_AGENT_SKILLS_DIR,
  APP_MANAGED_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  loadSkill,
  loadAllSkills,
  loadSkillDetails,
  toSkillSummary,
  toSkillSummaries,
  invalidateSkillsCache,
  getDisabledBundledSkillSlugsFromDisk,
  loadSkillBySlug,
  getSkillIconPath,
  updateSkillContent,
  resolveWorkspaceSkillDir,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
  type UpdateSkillContentInput,
} from './storage.ts';
export {
  OMP_GLOBAL_SKILLS_DIR,
  OMP_WORKSPACE_SKILLS_DIR,
  listOmpSkills,
  isOmpSkillPath,
  invalidateOmpSkillsCache,
  type OmpSkillInfo,
} from './omp-discovery.ts';
export {
  ensureBundledSkills,
  isBundledSkillsSyncCurrent,
  listBundledSkillPacks,
  resetBundledSkillsInitialized,
  resolveBundledSkillsTarget,
  runBundledSkillsSyncJob,
  type BundledSkillsJobResult,
  type ResolvedBundledSkillsTarget,
  type BundledSkillPackStatus,
  type EnsureBundledSkillsOptions,
  type EnsureBundledSkillsResult,
} from './bundled.ts';
export {
  BUNDLE_FINGERPRINT_FILE,
  computeBundledSkillsContentFingerprint,
  readBundledSkillsFingerprint,
  writeBundledSkillsFingerprint,
} from './bundled-fingerprint.ts';
export {
  ensureBundledSkillsInBackground,
  whenBundledSkillsSettled,
  whenBundledSkillsReadyForAgents,
  type BundledSkillsBackgroundOptions,
  type BundledSkillsBackgroundOutcome,
} from './bundled-background.ts';
export {
  AVAILABLE_SKILLS_MAX_BYTES,
  AVAILABLE_SKILLS_MAX_DESCRIPTION_CHARS,
  AVAILABLE_SKILLS_MAX_ENTRIES,
  SKILLS_READ_HOST_TOOL,
  SKILLS_SEARCH_HOST_TOOL,
  buildAvailableSkillsBlock,
  type AvailableSkillsPromptOptions,
} from './prompt.ts';
export {
  buildSkillEligibilityReport,
  credentialIdMatchesEnvName,
  defaultBinExists,
  defaultConfigExists,
  defaultEnvExists,
  detectSkillCollisions,
  detectSkillCollisionsForSlugs,
  evaluateSkillEligibility,
  osMatches,
  type BuildSkillEligibilityInput,
  type SkillCollision,
  type SkillEligibilityChecks,
  type SkillEligibilityEntry,
  type SkillEligibilityInput,
  type SkillEligibilityReason,
  type SkillEligibilityReasonCode,
  type SkillEligibilityReport,
  type SkillRootScan,
} from './eligibility.ts';
export {
  getSkillRootPlan,
  loadSkillFromDir,
  loadSkillsFromDir,
  type SkillRootPlanEntry,
} from './storage.ts';
