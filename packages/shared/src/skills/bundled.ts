/**
 * Bundled Skill Packs (runtime-context-marketplace M3, plan §4)
 *
 * Ships pinned snapshots of curated open skill packs under
 * `apps/electron/resources/skills/<pack-slug>/` (see SKILLS.lock there for
 * origin/commit pins) and syncs them into the application-owned skills tier
 * `<config>/skills/` on app startup, with optional links in `~/.agents/skills/`.
 *
 * Layout: skills discovery (storage.ts loadSkillsFromDir) is FLAT — a skill is
 * `<skills-root>/<skill-slug>/SKILL.md` with no recursion. Therefore each pack
 * installs its skills as top-level directories of `<config>/skills/`, and a
 * per-pack state file under `<config>/skills/.bundled/<pack-slug>.json`
 * (dot-prefixed, ignored by discovery) records the sha256 of every file we
 * wrote ("last known bundle version").
 *
 * Hash-merge semantics (user edits are never overwritten):
 * - target missing                        → write bundle file
 * - target hash == state hash             → managed by us, free to overwrite (upgrade)
 * - target hash != state hash             → user-modified → keep, flag localModified
 * - file removed from newer bundle        → delete only if target still matches state
 * - target unknown to state               → overwrite only if identical to bundle
 * - same name from another pack or user   → stable qualified name; both survive
 *
 * Atomicity: for every changed skill dir we stage the merged result under a
 * dot-prefixed tmp dir and swap via rename (existing dir moved to a dot-prefixed
 * backup first, restored on failure). Packs listed in
 * `config.bundledSkills.disabled` are skipped entirely — their files on disk
 * are left untouched (we never delete user data).
 *
 * The whole sync degrades gracefully: any failure is logged and reported in
 * the returned status, never thrown — app startup must not crash on skills.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { APP_MANAGED_SKILLS_DIR, GLOBAL_AGENT_SKILLS_DIR, invalidateSkillsCache } from './storage.ts';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { loadStoredConfig } from '../config/storage.ts';
import { isSafeSkillName } from './managed.ts';
import { invalidateOmpSkillsCache } from './omp-discovery.ts';
import {
  disabledPackSet,
  listPackSkillDirs,
  readPackState,
  readSkillsLock,
  sha256OfFile,
  syncBundledSkillPacks,
  type BundledSkillPackStatus,
  type ResolvedBundledSkillsTarget,
  type SkillsLockPack,
} from './bundled-core.ts';

export {
  isBundledSkillsSyncCurrent,
  runBundledSkillsSyncJob,
  type BundledSkillPackStatus,
  type BundledSkillsJobResult,
  type ResolvedBundledSkillsTarget,
} from './bundled-core.ts';

// ============================================================
// Options
// ============================================================

export interface EnsureBundledSkillsOptions {
  /** Bundle root (default: getBundledAssetsDir('skills')). */
  bundleRoot?: string;
  /** Install target (default: APP_MANAGED_SKILLS_DIR — `<config>/skills`). */
  targetRoot?: string;
  /** Optional external agent links. Explicit targets default to no links; null disables links. */
  linksRoot?: string | null;
  /** Disabled pack slugs (default: config `bundledSkills.disabled`). */
  disabled?: string[];
  /**
   * Skip all work when the sync stamp proves the install already matches this
   * bundle (PERF-02). Defaults to true for the ambient startup call and false
   * for explicit option injection (tests/tools always run the full merge).
   */
  skipIfCurrent?: boolean;
}

export interface EnsureBundledSkillsResult {
  packs: BundledSkillPackStatus[];
  bundleRoot: string | null;
  targetRoot: string;
  /** True when the sync stamp matched and no file was read, hashed or written. */
  upToDate?: boolean;
}

// ============================================================
// Session guard (same pattern as initializeDocs/ensureDefaultPermissions)
// ============================================================

let bundledSkillsInitialized = false;

/** Test hook: reset the per-session init guard. */
export function resetBundledSkillsInitialized(): void {
  bundledSkillsInitialized = false;
}

/**
 * Claim the once-per-process ambient sync without running it (the background
 * scheduler runs it later). Returns false when an ambient sync already ran or
 * was claimed, so a second host (e.g. server bootstrap inside Electron) skips.
 */
export function claimAmbientBundledSkillsSync(): boolean {
  if (bundledSkillsInitialized) return false;
  bundledSkillsInitialized = true;
  return true;
}

/**
 * A disposable OMP profile needs the shipped skills immediately, independently
 * of global installation or edited copies. Link pinned bundle directories
 * rather than copying every script/data file for every process restart.
 * OMP's other discovery tiers retain the user's authored skills and overrides.
 */
export function linkBundledSkillsForOmp(options: EnsureBundledSkillsOptions & { targetRoot: string; userSkillRoots?: string[] }): string[] {
  const bundleRoot = options.bundleRoot ?? getBundledAssetsDir('skills');
  const disabled = disabledPackSet(options.disabled ?? loadStoredConfig()?.bundledSkills?.disabled ?? []);
  const lock = bundleRoot && existsSync(bundleRoot) ? readSkillsLock(bundleRoot) : new Map<string, SkillsLockPack>();
  mkdirSync(options.targetRoot, { recursive: true });
  const linked = new Set<string>();
  const hidden = new Set([...lock.values()].filter(pack => disabled.has(pack.slug)).flatMap(pack => pack.skills ?? []));
  for (const pack of [...lock.keys()].sort()) {
    if (disabled.has(pack)) continue;
    const packDir = join(bundleRoot!, pack);
    for (const skill of listPackSkillDirs(packDir)) {
      const target = join(options.targetRoot, skill);
      if (existsSync(target)) throw new Error(`Bundled OMP skill collision: ${skill}`);
      symlinkSync(join(packDir, skill), target, process.platform === 'win32' ? 'junction' : 'dir');
      linked.add(skill);
    }
  }
  // The profile is our disposable directory; replacing these links never
  // writes to the user's global skill directories. Later authored tiers win,
  // matching ROX's global OMP -> shared -> workspace discovery precedence.
  for (const root of options.userSkillRoots ?? []) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || hidden.has(entry.name)) continue;
      const source = join(root, entry.name);
      if (!existsSync(join(source, 'SKILL.md'))) continue;
      const target = join(options.targetRoot, entry.name);
      rmSync(target, { recursive: true, force: true });
      symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
      linked.add(entry.name);
    }
  }
  return [...linked];
}

/** Resolve the ambient (startup) sync inputs exactly as `ensureBundledSkills()` would. */
export function resolveBundledSkillsTarget(options?: EnsureBundledSkillsOptions): ResolvedBundledSkillsTarget {
  const targetRoot = options?.targetRoot ?? APP_MANAGED_SKILLS_DIR;
  const linksRoot = options?.linksRoot === undefined ? (options?.targetRoot ? null : GLOBAL_AGENT_SKILLS_DIR) : options.linksRoot;
  const bundleRoot = options?.bundleRoot ?? getBundledAssetsDir('skills') ?? null;
  let disabled = options?.disabled;
  if (!disabled) {
    try {
      disabled = loadStoredConfig()?.bundledSkills?.disabled ?? [];
    } catch {
      disabled = [];
    }
  }
  return { bundleRoot: bundleRoot && existsSync(bundleRoot) ? bundleRoot : null, targetRoot, linksRoot, disabled: [...disabled] };
}

// ============================================================
// Public API
// ============================================================

/**
 * Sync all bundled skill packs into the application skills tier. Called once at app
 * startup from Electron main (next to initializeDocs). Never throws.
 */
export function ensureBundledSkills(options?: EnsureBundledSkillsOptions): EnsureBundledSkillsResult {
  // Per-session guard fires only for the ambient (no-options) startup call;
  // explicit option injection (tests, tools) always runs.
  if (!options) {
    if (bundledSkillsInitialized) {
      return { packs: [], bundleRoot: null, targetRoot: APP_MANAGED_SKILLS_DIR };
    }
    bundledSkillsInitialized = true;
  }

  const targetRoot = options?.targetRoot ?? APP_MANAGED_SKILLS_DIR;
  const linksRoot = options?.linksRoot === undefined ? (options?.targetRoot ? null : GLOBAL_AGENT_SKILLS_DIR) : options.linksRoot;
  const result: EnsureBundledSkillsResult = { packs: [], bundleRoot: null, targetRoot };

  try {
    const bundleRoot = options?.bundleRoot ?? getBundledAssetsDir('skills');
    if (!bundleRoot || !existsSync(bundleRoot)) {
      debug('[bundled-skills] Bundle root not found — skipping sync');
      return result;
    }
    result.bundleRoot = bundleRoot;

    let disabled = options?.disabled;
    if (!disabled) {
      try {
        disabled = loadStoredConfig()?.bundledSkills?.disabled ?? [];
      } catch {
        disabled = []; // config unreadable — treat as "nothing disabled"
      }
    }

    const synced = syncBundledSkillPacks({
      bundleRoot,
      targetRoot,
      linksRoot,
      disabled,
      skipIfCurrent: options?.skipIfCurrent ?? !options,
    });
    result.packs = synced.packs;
    if (synced.upToDate) {
      // Nothing on disk changed, so the skills caches stay valid.
      result.upToDate = true;
      return result;
    }
  } catch (error) {
    // Startup must never crash on skills sync — degrade to a debug log line.
    debug('[bundled-skills] ensureBundledSkills failed:', error instanceof Error ? error.message : error);
  }

  invalidateSkillsCache();
  invalidateOmpSkillsCache();
  return result;
}

/**
 * Read-only status of bundled packs without re-running a full disk sync.
 * Uses the same pack discovery as ensureBundledSkills; disabled flag comes
 * from config (or options). installed/localModified are best-effort from
 * on-disk .bundled state + target dirs.
 */
export function listBundledSkillPacks(options?: EnsureBundledSkillsOptions): BundledSkillPackStatus[] {
  const targetRoot = options?.targetRoot ?? APP_MANAGED_SKILLS_DIR;
  const bundleRoot = options?.bundleRoot ?? getBundledAssetsDir('skills');
  if (!bundleRoot || !existsSync(bundleRoot)) return [];

  let disabled = options?.disabled;
  if (!disabled) {
    try {
      disabled = loadStoredConfig()?.bundledSkills?.disabled ?? [];
    } catch {
      disabled = [];
    }
  }
  const disabledSet = disabledPackSet(disabled);
  const lock = readSkillsLock(bundleRoot);
  const packSlugs = readdirSync(bundleRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && isSafeSkillName(e.name))
    .map(e => e.name)
    .sort();

  return packSlugs.map((slug) => {
    const meta = lock.get(slug);
    const packDir = join(bundleRoot, slug);
    const state = readPackState(targetRoot, slug);
    const originals = listPackSkillDirs(packDir);
    const installedAliases = state ? [...new Set(Object.keys(state.files).map((key) => key.split('/')[0]!))] : [];
    const skills = [...new Set([...originals.map((skill) => state?.aliases?.[skill] ?? (installedAliases.includes(`${slug}--${skill}`) ? `${slug}--${skill}` : skill)), ...installedAliases])];
    const installed: string[] = [];
    let localModified = false;
    for (const skill of skills) {
      const skillDir = join(targetRoot, skill);
      if (!existsSync(skillDir)) continue;
      installed.push(skill);
      if (state) {
        const keys = Object.keys(state.files).filter((k) => k.startsWith(`${skill}/`));
        for (const key of keys) {
          const rel = key.slice(skill.length + 1);
          const filePath = join(skillDir, rel);
          if (!existsSync(filePath)) {
            localModified = true;
            continue;
          }
          try {
            if (sha256OfFile(filePath) !== state.files[key]) localModified = true;
          } catch {
            localModified = true;
          }
        }
      }
    }
    return {
      slug,
      origin: meta?.origin ?? null,
      commit: meta?.commit ?? meta?.upstream?.commit ?? null,
      disabled: disabledSet.has(slug),
      localModified,
      skills,
      installed,
      conflicts: [],
    } satisfies BundledSkillPackStatus;
  });
}
