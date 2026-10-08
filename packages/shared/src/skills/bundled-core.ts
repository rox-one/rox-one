/**
 * Bundled Skill Packs — merge engine (runtime-context-marketplace M3, plan §4)
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
 *
 * PERF-02 split: this module holds the merge engine and the sync stamp and only
 * depends on fs/crypto/path plus tiny helpers, so the worker_thread bundle
 * (bundled-sync.worker.ts) stays small. Ambient resolution (config dir, config
 * file, bundled assets root) and skills-cache invalidation live in bundled.ts.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  lstatSync,
  statSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { dirname, join, relative } from 'path';
import { debug } from '../utils/debug.ts';
import { safeJsonParse } from '../utils/files.ts';
import { chooseManagedSkillName, isSafeSkillName, isSkillLinkTo, linkManagedSkill, pathEntryExists, unlinkManagedSkill } from './managed.ts';
import { readBundledSkillsFingerprint } from './bundled-fingerprint.ts';

// ============================================================
// Types
// ============================================================

export const SKILLS_LOCK_FILE = 'SKILLS.lock';
export const STATE_DIR_NAME = '.bundled';

export interface SkillsLockPack {
  slug: string;
  origin?: string;
  commit?: string;
  license?: string;
  upstream?: { origin?: string; path?: string; commit?: string; note?: string };
  skills?: string[];
}

export interface SkillsLockFile {
  version?: number;
  packs?: SkillsLockPack[];
}

/** Per-pack sync state, persisted at `<skills-root>/.bundled/<pack-slug>.json`. */
export interface BundledPackState {
  version: number;
  pack: string;
  commit: string | null;
  syncedAt: string;
  /** `<skill-slug>/<relative-path>` → sha256 of file content as shipped by the bundle. */
  files: Record<string, string>;
  /** Original bundle directory → installed directory. Retained across upgrades. */
  aliases?: Record<string, string>;
}

export interface BundledSkillPackStatus {
  /** Pack slug = bundle directory name (also the `bundledSkills.disabled` key). */
  slug: string;
  origin: string | null;
  /** Pinned upstream commit this pack was vendored from (SKILLS.lock). */
  commit: string | null;
  /** Pack is listed in config `bundledSkills.disabled` — sync skipped it entirely. */
  disabled: boolean;
  /** True when at least one user-modified or foreign-owned file was preserved instead of overwritten. */
  localModified: boolean;
  /** Skill slugs shipped by the bundle. */
  skills: string[];
  /** Skill slugs present on disk after the sync. */
  installed: string[];
  /** Legacy status field; duplicate names receive aliases rather than being skipped. */
  conflicts: string[];
  /** Set when this pack failed to sync (status information only — not fatal). */
  error?: string;
}

/** Fully resolved sync inputs; safe to send to a worker thread (plain data). */
export interface ResolvedBundledSkillsTarget {
  bundleRoot: string | null;
  targetRoot: string;
  linksRoot: string | null;
  disabled: string[];
}

// ============================================================
// Internals
// ============================================================

export function sha256OfFile(path: string): string {
  return createHash('sha256').update(lstatSync(path).isSymbolicLink() ? `symlink:${readlinkSync(path)}` : readFileSync(path)).digest('hex');
}

/** Recursively list files of `dir` as relative paths. Dot entries are internal state, never content. */
export function listFilesRecursive(dir: string, rejectLinks = false): string[] {
  const out: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > 32) throw new Error('Skill tree exceeds maximum depth');
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (out.length >= 10_000) throw new Error('Skill tree exceeds maximum file count');
      const full = join(current, entry.name);
      if (entry.isSymbolicLink() && rejectLinks) throw new Error('Bundled skill contains a symbolic link');
      // User links count as local content without following targets or recursive cycles.
      if (entry.isDirectory()) walk(full, depth + 1);
      else out.push(relative(dir, full));
    }
  };
  walk(dir, 0);
  return out;
}

/** Direct child dirs of `packDir` that contain a SKILL.md (= installable skills). */
export function listPackSkillDirs(packDir: string): string[] {
  const skills: string[] = [];
  for (const entry of readdirSync(packDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSafeSkillName(entry.name)) continue;
    if (existsSync(join(packDir, entry.name, 'SKILL.md'))) {
      skills.push(entry.name);
    }
  }
  return skills.sort();
}

/** Preserve legacy disabled preferences after the first-party pack rename. */
export function disabledPackSet(slugs: string[]): Set<string> {
  return new Set(slugs.map(slug => slug === 'craft-knowledge' ? 'rox-knowledge' : slug));
}

export function readSkillsLock(bundleRoot: string): Map<string, SkillsLockPack> {
  const map = new Map<string, SkillsLockPack>();
  const lockPath = join(bundleRoot, SKILLS_LOCK_FILE);
  if (!existsSync(lockPath)) return map;
  try {
    // Lock is a repo-maintained JSON file we control — a typed cast is enough here.
    const parsed = safeJsonParse(readFileSync(lockPath, 'utf-8')) as SkillsLockFile | null;
    for (const pack of parsed?.packs ?? []) {
      if (pack && typeof pack.slug === 'string') map.set(pack.slug, pack);
    }
  } catch {
    // Corrupt lock — fall back to directory scan with null metadata.
  }
  return map;
}


export function readPackState(targetRoot: string, packSlug: string): BundledPackState | null {
  if (!isSafeSkillName(packSlug)) return null;
  const path = join(targetRoot, STATE_DIR_NAME, `${packSlug}.json`);
  if (!existsSync(path)) return null;
  try {
    // State file is written by us below — validate shape minimally and bail on mismatch.
    const parsed = safeJsonParse(readFileSync(path, 'utf-8')) as BundledPackState | null;
    if (!parsed || parsed.pack !== packSlug || typeof parsed.files !== 'object' || parsed.files === null) {
      return null;
    }
    if (Object.keys(parsed.files).some(key => !isSafeSkillName(key.split('/')[0]!) || key.split('/').some(part => part === '..') || key.includes('\\'))) return null;
    return parsed;
  } catch {
    return null; // corrupt state → unknown ownership → conservative sync
  }
}

export function writePackState(targetRoot: string, state: BundledPackState): void {
  const dir = join(targetRoot, STATE_DIR_NAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${state.pack}.json`);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  renameSync(tmp, path);
}

/**
 * Build a manifest for a directory tree: `<skill>/<rel>` → { abs path, sha256 }.
 * Works for both the bundle pack dir and the skills target root (missing skill
 * dirs contribute nothing, which naturally models first-install and removals).
 */
export function buildManifest(rootDir: string, skillSlugs: string[], rejectLinks = false): Map<string, { abs: string; sha: string }> {
  const manifest = new Map<string, { abs: string; sha: string }>();
  for (const skill of skillSlugs) {
    const skillDir = join(rootDir, skill);
    if (!existsSync(skillDir)) continue; // disk variant: skill absent → empty manifest
    if (lstatSync(skillDir).isSymbolicLink()) continue;
    for (const rel of listFilesRecursive(skillDir, rejectLinks)) {
      const abs = join(skillDir, rel);
      manifest.set(`${skill}/${rel}`, { abs, sha: sha256OfFile(abs) });
    }
  }
  return manifest;
}

// ============================================================
// Sync stamp: O(1) "nothing changed" short-circuit (PERF-02)
// ============================================================

/** Stamp lives in the state dir but is not `*.json`, so pack-state scans ignore it. */
export const SYNC_STAMP_FILE = 'sync-stamp';
const SYNC_STAMP_VERSION = 1;
/** Bump whenever merge semantics change so every install re-runs one full sync. */
const SYNC_ALGORITHM_VERSION = 1;

interface BundledSyncStamp {
  version: number;
  algorithm: number;
  fingerprint: string;
  targetRoot: string;
  linksRoot: string | null;
  disabled: string[];
  /** Every `<state-dir>/*.json` present after the sync → its size/mtime. */
  states: Record<string, { size: number; mtimeMs: number }>;
  /** Skill directories present in targetRoot after the sync. */
  installed: string[];
  /** External agent links created by the sync: [link, target]. */
  links: Array<[string, string]>;
  writtenAt: string;
}

export function normalizedDisabled(disabled: string[]): string[] {
  return [...disabledPackSet(disabled)].sort();
}

function stateFileStats(targetRoot: string): Record<string, { size: number; mtimeMs: number }> {
  const out: Record<string, { size: number; mtimeMs: number }> = {};
  const dir = join(targetRoot, STATE_DIR_NAME);
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const stat = statSync(join(dir, file));
    out[file] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  return out;
}

function readSyncStamp(targetRoot: string): BundledSyncStamp | null {
  try {
    const parsed = safeJsonParse(readFileSync(join(targetRoot, STATE_DIR_NAME, SYNC_STAMP_FILE), 'utf-8')) as BundledSyncStamp | null;
    if (!parsed || parsed.version !== SYNC_STAMP_VERSION || typeof parsed.fingerprint !== 'string') return null;
    if (!Array.isArray(parsed.disabled) || !Array.isArray(parsed.installed) || !Array.isArray(parsed.links)) return null;
    if (typeof parsed.states !== 'object' || parsed.states === null) return null;
    if (parsed.installed.some(skill => typeof skill !== 'string' || !isSafeSkillName(skill))) return null;
    if (parsed.links.some(pair => !Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string')) return null;
    return parsed;
  } catch {
    return null; // missing/corrupt stamp → full sync
  }
}

function clearSyncStamp(targetRoot: string): void {
  try { rmSync(join(targetRoot, STATE_DIR_NAME, SYNC_STAMP_FILE), { force: true }); } catch { /* best effort */ }
}

function writeSyncStamp(stamp: Omit<BundledSyncStamp, 'version' | 'algorithm' | 'writtenAt' | 'states'>): void {
  const dir = join(stamp.targetRoot, STATE_DIR_NAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const full: BundledSyncStamp = {
    version: SYNC_STAMP_VERSION,
    algorithm: SYNC_ALGORITHM_VERSION,
    ...stamp,
    states: stateFileStats(stamp.targetRoot),
    writtenAt: new Date().toISOString(),
  };
  const path = join(dir, SYNC_STAMP_FILE);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(full), 'utf-8');
  renameSync(tmp, path);
}

/**
 * True when the last full sync used exactly this bundle and configuration and
 * the files it produced are still in place. Cost: one small read for the stamp
 * (plus the bundle fingerprint), one readdir + stat per pack-state file, and one
 * lstat per installed skill / link. No content reads, no hashing.
 *
 * Deliberately conservative: anything unexpected (missing/corrupt stamp or
 * state file, edited state, removed skill dir or link, changed disabled list,
 * different roots, algorithm bump) returns false and the full hash-merge runs.
 */
export function isBundledSkillsSyncCurrent(target: ResolvedBundledSkillsTarget, fingerprint?: string): boolean {
  try {
    if (!target.bundleRoot || !existsSync(target.bundleRoot)) return false;
    const stamp = readSyncStamp(target.targetRoot);
    if (!stamp || stamp.algorithm !== SYNC_ALGORITHM_VERSION) return false;
    if (stamp.targetRoot !== target.targetRoot || stamp.linksRoot !== target.linksRoot) return false;
    if (JSON.stringify(stamp.disabled) !== JSON.stringify(normalizedDisabled(target.disabled))) return false;
    if (stamp.fingerprint !== (fingerprint ?? readBundledSkillsFingerprint(target.bundleRoot))) return false;
    const states = stateFileStats(target.targetRoot);
    const recorded = Object.keys(stamp.states);
    if (recorded.length !== Object.keys(states).length) return false;
    for (const file of recorded) {
      const now = states[file];
      const then = stamp.states[file];
      if (!now || !then || now.size !== then.size || now.mtimeMs !== then.mtimeMs) return false;
    }
    for (const skill of stamp.installed) {
      if (!existsSync(join(target.targetRoot, skill))) return false;
    }
    for (const [link, linkTarget] of stamp.links) {
      if (!isSkillLinkTo(link, linkTarget)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Merge engine
// ============================================================

/**
 * Run the full hash-merge for explicit, resolved inputs (no config/env lookups).
 * With `skipIfCurrent`, returns `upToDate` without touching any skill file when
 * the sync stamp vouches for the install. Never throws.
 */
export function syncBundledSkillPacks(input: {
  bundleRoot: string;
  targetRoot: string;
  linksRoot: string | null;
  disabled: string[];
  skipIfCurrent: boolean;
}): { packs: BundledSkillPackStatus[]; upToDate: boolean } {
  const { bundleRoot, targetRoot, linksRoot, disabled, skipIfCurrent } = input;
  const result: { packs: BundledSkillPackStatus[]; upToDate: boolean } = { packs: [], upToDate: false };
  let fingerprint: string | null = null;
  let syncFailed = false;
  const createdLinks: Array<[string, string]> = [];

  try {
    // PERF-02: fingerprint first; when the stamp proves nothing changed, return
    // without walking, hashing or writing a single skill file.
    try {
      fingerprint = readBundledSkillsFingerprint(bundleRoot);
    } catch (error) {
      fingerprint = null; // unreadable bundle metadata → never write a stamp
      debug('[bundled-skills] fingerprint failed:', error instanceof Error ? error.message : error);
    }
    if (skipIfCurrent && fingerprint && isBundledSkillsSyncCurrent({ bundleRoot, targetRoot, linksRoot, disabled }, fingerprint)) {
      debug('[bundled-skills] Bundle unchanged since last sync — skipped');
      result.upToDate = true;
      return result;
    }
    // A full merge is about to rewrite state files; drop the stamp first so an
    // interrupted sync can never leave a stamp that vouches for partial state.
    clearSyncStamp(targetRoot);

    const disabledSet = disabledPackSet(disabled);
    const lock = readSkillsLock(bundleRoot);
    const packSlugs = readdirSync(bundleRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && isSafeSkillName(e.name))
      .map(e => e.name)
      .sort();

    if (!existsSync(targetRoot)) {
      mkdirSync(targetRoot, { recursive: true });
    }

    // Ownership map: skill dir → owning pack, from previously written states.
    // Prevents one pack from clobbering another pack's same-named skill dir.
    const ownerOf = new Map<string, string>();
    const stateDir = join(targetRoot, STATE_DIR_NAME);
    if (existsSync(stateDir)) {
      for (const file of readdirSync(stateDir)) {
        if (!file.endsWith('.json')) continue;
        const state = readPackState(targetRoot, file.slice(0, -'.json'.length));
        if (!state) continue;
        for (const key of Object.keys(state.files)) {
          const slash = key.indexOf('/');
          if (slash > 0) ownerOf.set(key.slice(0, slash), state.pack === 'craft-knowledge' ? 'rox-knowledge' : state.pack);
        }
      }
    }

    for (const slug of packSlugs) {
      const meta = lock.get(slug);
      const status: BundledSkillPackStatus = {
        slug,
        origin: meta?.origin ?? null,
        commit: meta?.commit ?? meta?.upstream?.commit ?? null,
        disabled: disabledSet.has(slug),
        localModified: false,
        skills: [],
        installed: [],
        conflicts: [],
      };
      result.packs.push(status);

      if (status.disabled) {
        if (linksRoot) {
          for (const key of Object.keys(readPackState(targetRoot, slug)?.files ?? {})) {
            unlinkManagedSkill(join(targetRoot, key.split('/')[0]!), linksRoot);
          }
        }
        debug(`[bundled-skills] Pack "${slug}" disabled via config — skipped`);
        continue;
      }

      try {
        const previousFiles = readPackState(targetRoot, slug)?.files ?? {};
        const aliases: Record<string, string> = {};
        const bundleManifest = syncPack(bundleRoot, targetRoot, slug, status, ownerOf, aliases, linksRoot);
        writePackState(targetRoot, {
          version: 1,
          pack: slug,
          commit: status.commit,
          syncedAt: new Date().toISOString(),
          files: Object.fromEntries([...bundleManifest].map(([key, { sha }]) => [key, sha])),
          aliases,
        });
        for (const skill of status.installed) ownerOf.set(skill, slug);
        if (linksRoot) {
          for (const oldSkill of new Set(Object.keys(previousFiles).map(key => key.split('/')[0]!))) {
            if (!status.installed.includes(oldSkill)) unlinkManagedSkill(join(targetRoot, oldSkill), linksRoot);
          }
          for (const skill of status.installed) {
            const target = join(targetRoot, skill);
            const link = linkManagedSkill(target, linksRoot, skill);
            if (link) createdLinks.push([link, target]);
          }
        }
        debug(`[bundled-skills] Synced pack "${slug}": ${status.installed.length} skills${status.localModified ? ' (local modifications preserved)' : ''}`);
      } catch (error) {
        syncFailed = true;
        status.error = error instanceof Error ? error.message : String(error);
        debug(`[bundled-skills] Pack "${slug}" sync failed:`, status.error);
      }
    }

    // Only a fully successful merge may vouch for the next launch; any pack
    // failure leaves no stamp, so the next launch retries the full sync.
    if (!syncFailed && fingerprint) {
      try {
        writeSyncStamp({
          fingerprint,
          targetRoot,
          linksRoot,
          disabled: normalizedDisabled(disabled),
          installed: [...new Set(result.packs.flatMap(pack => pack.installed))].sort(),
          links: createdLinks,
        });
      } catch (error) {
        debug('[bundled-skills] sync stamp write failed:', error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    // Startup must never crash on skills sync — degrade to a debug log line.
    debug('[bundled-skills] ensureBundledSkills failed:', error instanceof Error ? error.message : error);
  }
  return result;
}

/**
 * Merge one pack into the target root. Returns the bundle manifest (used by the
 * caller to persist the pack state). Throws on hard IO errors — the caller
 * catches per-pack and reports via status.error.
 */
function syncPack(
  bundleRoot: string,
  targetRoot: string,
  slug: string,
  status: BundledSkillPackStatus,
  ownerOf: ReadonlyMap<string, string>,
  aliasesOut: Record<string, string>,
  linksRoot: string | null,
): Map<string, { abs: string; sha: string }> {
  const packDir = join(bundleRoot, slug);
  const originals = listPackSkillDirs(packDir);
  const previousState = readPackState(targetRoot, slug);
  const reserved = new Set<string>();
  const aliases = new Map(originals.map((skill) => {
    const legacyAlias = ownerOf.get(`${slug}--${skill}`) === slug ? `${slug}--${skill}` : ownerOf.get(skill) === slug ? skill : undefined;
    const previous = previousState?.aliases?.[skill] ?? legacyAlias;
    const installed = chooseManagedSkillName(slug, skill, (candidate) => {
      if (reserved.has(candidate)) return false;
      const target = join(targetRoot, candidate);
      if (ownerOf.has(candidate) && ownerOf.get(candidate) !== slug) return false;
      if (pathEntryExists(target) && (ownerOf.get(candidate) !== slug || lstatSync(target).isSymbolicLink())) return false;
      // An established application identity stays stable if a user later adds a global skill.
      // Discovery gives that application skill an explicit alias without rewriting local edits.
      const link = linksRoot ? join(linksRoot, candidate) : null;
      return previous === candidate || !link || !pathEntryExists(link) || isSkillLinkTo(link, target);
    }, previous);
    reserved.add(installed);
    aliasesOut[skill] = installed;
    return [skill, installed] as const;
  }));
  const skills = [...aliases.values()];
  status.skills = skills;
  const bundleManifest = new Map([...buildManifest(packDir, originals, true)].map(([key, value]) => {
    const slash = key.indexOf('/');
    return [`${aliases.get(key.slice(0, slash))}${key.slice(slash)}`, value] as const;
  }));
  const stateFiles = previousState?.files ?? {};

  const tmpRoot = join(targetRoot, `.bundled-tmp-${slug}-${process.pid}`);
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });

  try {
    for (const skill of skills) {
      const disk = buildManifest(targetRoot, [skill]);
      const writes: { rel: string; from: string }[] = [];
      const deletes: string[] = [];

      // 1. Bundle files: decide per file whether the bundle version may land.
      for (const [key, { abs, sha }] of bundleManifest) {
        if (!key.startsWith(`${skill}/`)) continue;
        const rel = key.slice(skill.length + 1);
        const diskSha = disk.get(key)?.sha;

        if (diskSha === undefined) {
          writes.push({ rel, from: abs }); // new file
        } else if (diskSha === sha) {
          continue; // identical already
        } else if (stateFiles[key] !== undefined && diskSha === stateFiles[key]) {
          writes.push({ rel, from: abs }); // managed by us and unmodified → upgrade
        } else {
          status.localModified = true; // user-modified or foreign — preserve
        }
      }

      // 2. Bundle removals: file tracked by state but gone from the bundle.
      for (const key of Object.keys(stateFiles)) {
        if (!key.startsWith(`${skill}/`) || bundleManifest.has(key)) continue;
        const rel = key.slice(skill.length + 1);
        const diskSha = disk.get(key)?.sha;
        if (diskSha === undefined) continue; // user already deleted it
        if (diskSha === stateFiles[key]) {
          deletes.push(rel); // unmodified → safe to drop
        } else {
          status.localModified = true; // user edited a file the pack dropped — keep
        }
      }

      if (writes.length === 0 && deletes.length === 0) {
        if (disk.size > 0) status.installed.push(skill); // already in sync / preserved
        continue;
      }

      // Stage: start from the current target so user-added files survive, then
      // apply bundle ops and swap atomically via rename (dot-prefixed backup).
      const targetDir = join(targetRoot, skill);
      const stagedDir = join(tmpRoot, skill);
      const hadTarget = existsSync(targetDir);
      if (hadTarget) {
        cpSync(targetDir, stagedDir, { recursive: true });
      } else {
        mkdirSync(stagedDir, { recursive: true });
      }
      for (const { rel, from } of writes) {
        const dest = join(stagedDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(from, dest);
      }
      for (const rel of deletes) {
        rmSync(join(stagedDir, rel), { force: true });
      }

      const backupDir = join(targetRoot, `.rox-bak-${skill}-${process.pid}`);
      if (hadTarget) {
        renameSync(targetDir, backupDir);
      }
      try {
        renameSync(stagedDir, targetDir);
      } catch (error) {
        // Roll back: restore the previous dir so the user never loses content.
        if (hadTarget && existsSync(backupDir) && !existsSync(targetDir)) {
          try {
            renameSync(backupDir, targetDir);
          } catch {
            // leave backup on disk for manual recovery
          }
        }
        throw error;
      }
      if (hadTarget) {
        rmSync(backupDir, { recursive: true, force: true });
      }
      status.installed.push(skill);
    }

    // 3. Whole-skill removals: skill tracked by state but no longer in the bundle.
    const previouslyOwned = new Set<string>();
    for (const key of Object.keys(stateFiles)) {
      const slash = key.indexOf('/');
      if (slash > 0) previouslyOwned.add(key.slice(0, slash));
    }
    for (const skill of previouslyOwned) {
      if (skills.includes(skill)) continue;
      const targetDir = join(targetRoot, skill);
      if (!existsSync(targetDir)) continue;
      const disk = buildManifest(targetRoot, [skill]);
      const managedKeys = Object.keys(stateFiles).filter(key => key.startsWith(`${skill}/`));
      const allMatch = managedKeys.every(key => disk.get(key)?.sha === stateFiles[key]);
      const noExtras = [...disk.keys()].every(key => managedKeys.includes(key));
      if (allMatch && noExtras) {
        rmSync(targetDir, { recursive: true, force: true }); // entirely ours → remove
        debug(`[bundled-skills] Removed skill "${skill}" (dropped from pack "${slug}")`);
      } else {
        status.installed.push(skill);
        status.localModified = true; // user touched it — keep
        // Preserve ownership so a later disable/update still recognizes retained user content.
        for (const key of managedKeys) bundleManifest.set(key, { abs: join(targetRoot, key), sha: stateFiles[key]! });
      }
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  return bundleManifest;
}

/** Summary of one background sync job (plain data; crosses the worker boundary). */
export interface BundledSkillsJobResult {
  status: 'up-to-date' | 'synced' | 'no-bundle' | 'failed';
  packs: number;
  failedPacks: number;
  localModifiedPacks: number;
  error?: string;
}

/**
 * The unit of work shared by the worker entry and the inline fallback:
 * stamp check first, full hash-merge only when needed. Never throws.
 * Callers on the main thread must invalidate the skills caches on `synced`.
 */
export function runBundledSkillsSyncJob(target: ResolvedBundledSkillsTarget): BundledSkillsJobResult {
  try {
    if (!target.bundleRoot || !existsSync(target.bundleRoot)) {
      return { status: 'no-bundle', packs: 0, failedPacks: 0, localModifiedPacks: 0 };
    }
    const synced = syncBundledSkillPacks({
      bundleRoot: target.bundleRoot,
      targetRoot: target.targetRoot,
      linksRoot: target.linksRoot,
      disabled: target.disabled,
      skipIfCurrent: true,
    });
    if (synced.upToDate) return { status: 'up-to-date', packs: 0, failedPacks: 0, localModifiedPacks: 0 };
    return {
      status: 'synced',
      packs: synced.packs.length,
      failedPacks: synced.packs.filter(pack => pack.error).length,
      localModifiedPacks: synced.packs.filter(pack => pack.localModified).length,
    };
  } catch (error) {
    return { status: 'failed', packs: 0, failedPacks: 0, localModifiedPacks: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
