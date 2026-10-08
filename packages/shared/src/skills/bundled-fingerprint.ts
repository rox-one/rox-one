/**
 * Bundle identity for the bundled-skills startup short-circuit (PERF-02).
 *
 * Dependency-light on purpose (fs/crypto/path only) so the build script
 * (scripts/electron-build-resources.ts) can import it without loading config.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isSafeSkillName } from './managed.ts';

/**
 * Build-time content fingerprint written at the bundle root by
 * scripts/electron-build-resources.ts. A plain file (pack discovery only looks
 * at directories), not dot-prefixed, so packagers never drop it.
 */
export const BUNDLE_FINGERPRINT_FILE = 'bundle-fingerprint.json';
const SKILLS_LOCK_FILE = 'SKILLS.lock';
/** Part of the hashed preamble; bump to invalidate every stamped bundle. */
const FINGERPRINT_VERSION = 1;

function sha256OfEntry(path: string): string {
  return createHash('sha256').update(lstatSync(path).isSymbolicLink() ? `symlink:${readlinkSync(path)}` : readFileSync(path)).digest('hex');
}

/** Every file below the pack directories of a bundle, as sorted bundle-relative `/` paths. */
export function listBundleFiles(bundleRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 32) throw new Error('Skill bundle exceeds maximum depth');
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else out.push(relative(bundleRoot, full).split('\\').join('/'));
    }
  };
  for (const entry of readdirSync(bundleRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && isSafeSkillName(entry.name)) walk(join(bundleRoot, entry.name), 1);
  }
  return out.sort();
}

/**
 * Content fingerprint of a bundle (paths + sha256 of every pack file + SKILLS.lock).
 * Reads every file; run at build time, never on app startup.
 */
export function computeBundledSkillsContentFingerprint(bundleRoot: string): string {
  const hash = createHash('sha256');
  hash.update(`rox-bundled-skills-v${FINGERPRINT_VERSION}\n`);
  const lockPath = join(bundleRoot, SKILLS_LOCK_FILE);
  if (existsSync(lockPath)) hash.update(`lock\0${sha256OfEntry(lockPath)}\n`);
  for (const rel of listBundleFiles(bundleRoot)) hash.update(`${rel}\0${sha256OfEntry(join(bundleRoot, rel))}\n`);
  return hash.digest('hex');
}

/** Write the build-time fingerprint consumed by {@link readBundledSkillsFingerprint}. */
export function writeBundledSkillsFingerprint(bundleRoot: string): string {
  const fingerprint = computeBundledSkillsContentFingerprint(bundleRoot);
  writeFileSync(join(bundleRoot, BUNDLE_FINGERPRINT_FILE), `${JSON.stringify({ version: 1, fingerprint }, null, 2)}\n`, 'utf-8');
  return fingerprint;
}

/**
 * Cheap bundle identity for the startup check.
 * - Packaged builds: the build-time content fingerprint (one small read).
 * - Dev / unstamped bundles: a metadata walk (path + size + mtime, no content
 *   reads), so editing a vendored skill in a checkout still triggers a sync.
 */
export function readBundledSkillsFingerprint(bundleRoot: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(bundleRoot, BUNDLE_FINGERPRINT_FILE), 'utf-8')) as { version?: unknown; fingerprint?: unknown } | null;
    if (parsed?.version === 1 && typeof parsed.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(parsed.fingerprint)) {
      return `content:${parsed.fingerprint}`;
    }
  } catch {
    // Missing/corrupt build stamp → metadata walk below.
  }
  const hash = createHash('sha256');
  const lockPath = join(bundleRoot, SKILLS_LOCK_FILE);
  if (existsSync(lockPath)) {
    const stat = statSync(lockPath);
    hash.update(`lock\0${stat.size}\0${stat.mtimeMs}\n`);
  }
  for (const rel of listBundleFiles(bundleRoot)) {
    const stat = lstatSync(join(bundleRoot, rel));
    hash.update(`${rel}\0${stat.size}\0${stat.mtimeMs}\n`);
  }
  return `stat:${hash.digest('hex')}`;
}
