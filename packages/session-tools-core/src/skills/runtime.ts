/**
 * Skills Tool Runtime — the seam between the skills session tools
 * (`skills_search` / `skills_read`) and the skill catalog that actually lives
 * on disk.
 *
 * This package stays free of any skill-discovery implementation: the runtime is
 * REGISTERED by the process that owns the skills RPC layer (server-core
 * `registerSkillsHandlers` registers an implementation closing over
 * `loadAllSkills` + the eligibility gate). Claude, Pi and OMP all execute
 * session-tool handlers in that same process, so one registration covers every
 * backend.
 *
 * In processes without the skills layer, no runtime is registered and the
 * handlers answer with a typed SKILLS_UNAVAILABLE error — never a hang, never a
 * raw throw.
 */

export type SkillCatalogSource = 'global' | 'workspace' | 'project' | 'omp';

/** Catalog scope: the workspace + optional project root the tools resolve against. */
export interface SkillsRuntimeScope {
  /** Absolute workspace root (owns `{root}/skills`). */
  workspaceRoot: string;
  /** Optional project/working directory (owns `{project}/.agents/skills`). */
  projectRoot?: string;
}

/** One advertised skill (metadata only, no body). */
export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string;
  /** Absolute path to the skill directory. */
  path: string;
  /** Absolute path to the containing root (used to confine reads). */
  baseDir: string;
  source: SkillCatalogSource;
}

/** A search hit: catalog entry plus a bounded body excerpt. */
export interface SkillSearchHit extends SkillCatalogEntry {
  excerpt?: string;
}

/** A single loaded skill body. */
export interface SkillReadOutcome {
  slug: string;
  name: string;
  content: string;
  path: string;
}

export interface SkillsToolRuntime {
  /** Every eligible skill in the scope, in catalog order. */
  list(scope: SkillsRuntimeScope): Promise<SkillCatalogEntry[]>;
  /** Keyword search over the eligible catalog; implementations bound `limit`. */
  search(scope: SkillsRuntimeScope & { query: string; limit?: number }): Promise<SkillSearchHit[]>;
  /** Load one skill by slug, or null when absent/ineligible. */
  read(scope: SkillsRuntimeScope & { slug: string }): Promise<SkillReadOutcome | null>;
}

let registeredRuntime: SkillsToolRuntime | null = null;

/** Register the process-wide skills tool runtime. Last registration wins (server reload). */
export function registerSkillsToolRuntime(runtime: SkillsToolRuntime): void {
  registeredRuntime = runtime;
}

/** The registered runtime, or null when the skills layer is absent in this process. */
export function getSkillsToolRuntime(): SkillsToolRuntime | null {
  return registeredRuntime;
}

/** Test seam: drop the registration (afterEach) so suites don't leak into each other. */
export function clearSkillsToolRuntime(): void {
  registeredRuntime = null;
}