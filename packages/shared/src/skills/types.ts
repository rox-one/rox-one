/**
 * Skills Types
 *
 * Type definitions for workspace skills.
 * Skills are specialized instructions that extend Claude's capabilities.
 */

/**
 * Machine prerequisites declared by a skill under `metadata.openclaw.requires`
 * (or its ROX alias `metadata.rox.requires`). Every list is optional; a missing
 * field imposes no requirement.
 */
export interface SkillRequires {
  /** Executables that must resolve on PATH. */
  bins?: string[];
  /** Executables of which at least one must resolve on PATH. */
  anyBins?: string[];
  /** Environment variables satisfied through the ROX credential fabric. */
  env?: string[];
  /** Stored configuration keys that must be present. */
  config?: string[];
}

/**
 * Skill metadata from SKILL.md YAML frontmatter.
 *
 * The `metadata.openclaw` (upstream) and `metadata.rox` (ROX alias) blocks are
 * additive: existing packs already ship them, and a skill without a block keeps
 * every field undefined.
 */
export interface SkillMetadata {
  /** Display name for the skill */
  name: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔧")
   * - URL: auto-downloaded to icon.{ext} file
   * Note: Relative paths and inline SVG are NOT supported.
   */
  icon?: string;
  /** Optional source slugs to auto-enable when this skill is invoked */
  requiredSources?: string[];
  /** Machine prerequisites (bins / env / config) declared by the skill pack. */
  requires?: SkillRequires;
  /** Platforms the skill supports (e.g. `['darwin']`, `['linux','darwin']`). */
  os?: string[];
  /** Stable pack-scoped key, used when the on-disk slug is disambiguated. */
  skillKey?: string;
  /** Human-readable name of the primary secret this skill needs. */
  primaryEnv?: string;
  /** Mark the skill as always-on (informational; no gating effect). */
  always?: boolean;
  /** Project homepage advertised by the pack. */
  homepage?: string;
}

/** Source of a loaded skill */
export type SkillSource = 'global' | 'workspace' | 'project' | 'omp';

/**
 * Plugin name for project-level and global skills.
 *
 * The SDK derives plugin names from `path.basename()` of the registered plugin
 * directory. Both `{project}/.agents/` and `~/.agents/` share the basename
 * `.agents`, so skills from either tier resolve to `.agents:skillSlug`.
 */
export const AGENTS_PLUGIN_NAME = '.agents';

/**
 * A loaded skill with parsed content
 */
export interface LoadedSkill {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /**
   * Full SKILL.md content (without frontmatter). Empty in list summaries
   * (skills.GET / skills.CHANGED); load the body with skills.GET_DETAILS.
   */
  content: string;
  /** Length of the omitted body, set on list summaries only. */
  contentLength?: number;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
  /** Where this skill was loaded from */
  source: SkillSource;
  /**
   * Set for OMP skills whose slug is also provided by a craft skill
   * (global/workspace/project). Craft wins — the OMP variant is shown in the
   * skills panel as inactive with an explanation and is NOT used for
   * @-mention resolution.
   */
  shadowedByCraft?: boolean;
}
