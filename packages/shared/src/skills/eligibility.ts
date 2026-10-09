/**
 * Skills Eligibility
 *
 * Honest gating for the skill catalog: a skill is eligible for the agent only
 * when the operator allowlist admits it, its bundled pack is enabled, the
 * current OS matches, and every declared machine prerequisite is satisfiable on
 * THIS machine.
 *
 * Environment requirements resolve through the ROX credential fabric
 * (CredentialManager) — never a parallel secret store and never raw
 * `process.env`. Binaries resolve through `Bun.which` when present, otherwise
 * the shared cross-platform PATH probe. Configuration keys resolve through the
 * one stored-config reader.
 *
 * The report is the single source of truth for three consumers: the
 * `<available_skills>` prompt block, the `skills_search`/`skills_read` host
 * tools, and the `skills:getEligibility` RPC handler.
 */

import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { whichTool } from '../toolchain/exec.ts';
import { getCredentialManager } from '../credentials/manager.ts';
import { loadStoredConfig } from '../config/storage.ts';
import { isInsideSkillStore } from './managed.ts';
import {
  APP_MANAGED_SKILLS_DIR,
  getDisabledBundledSkillSlugsFromDisk,
  getSkillRootPlan,
  loadAllSkills,
  loadSkillDetails,
  loadSkillFromDir,
  loadSkillsFromDir,
} from './storage.ts';
import type { LoadedSkill } from './types.ts';
import type { CredentialId } from '../credentials/types.ts';

/** Bun runtime global, absent under plain Node/Electron. */
declare const Bun: { which?(name: string): string | null } | undefined;

// ============================================================
// Report shapes
// ============================================================

export type SkillEligibilityReasonCode =
  | 'operator-not-allowed'
  | 'missing-bin'
  | 'missing-env'
  | 'missing-config'
  | 'os-mismatch'
  | 'disabled-pack';

export interface SkillEligibilityReason {
  code: SkillEligibilityReasonCode;
  detail: string;
}

export interface SkillEligibilityEntry {
  skill: LoadedSkill;
  reasons: SkillEligibilityReason[];
}

/** A slug provided by more than one tier: the highest-priority tier wins. */
export interface SkillCollision {
  name: string;
  winner: string;
  shadowed: string[];
}

export interface SkillEligibilityReport {
  /** Skills admitted by every gate, in catalog order. */
  eligible: LoadedSkill[];
  /** Skills rejected with at least one reason (includes hidden disabled packs). */
  ineligible: SkillEligibilityEntry[];
  /** Name collisions across the ordered root plan. */
  collisions: SkillCollision[];
}

// ============================================================
// Injectable checks (defaults probe the real machine)
// ============================================================

export interface SkillEligibilityChecks {
  binExists?(bin: string): boolean | Promise<boolean>;
  envExists?(env: string): boolean | Promise<boolean>;
  configExists?(key: string): boolean | Promise<boolean>;
}

/** `Bun.which` when running under Bun, otherwise the shared PATH probe. */
export async function defaultBinExists(bin: string): Promise<boolean> {
  const name = bin.trim();
  if (!name) return false;
  if (isAbsolute(name)) {
    try {
      return (await stat(name)).isFile();
    } catch {
      return false;
    }
  }
  if (typeof Bun !== 'undefined' && typeof Bun.which === 'function') {
    try {
      if (Bun.which(name) !== null) return true;
    } catch {
      // Fall through to the PATH probe.
    }
  }
  return (await whichTool(name)) !== null;
}

/**
 * Candidate environment-variable names a stored credential can satisfy: its
 * type name plus scope-derived `<SCOPE>_API_KEY` / `<SCOPE>_TOKEN` /
 * `<SCOPE>_KEY` aliases. Pure so it is testable without a credential store.
 */
export function credentialIdMatchesEnvName(id: CredentialId, envName: string): boolean {
  const target = envName.trim().toUpperCase();
  if (!target) return false;
  const aliases = new Set<string>([id.type.toUpperCase()]);
  const scopes = [id.connectionSlug, id.name, id.sourceId, id.hostId, id.runtimeId];
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !scope) continue;
    const normalized = scope.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!normalized) continue;
    aliases.add(normalized);
    aliases.add(`${normalized}_API_KEY`);
    aliases.add(`${normalized}_TOKEN`);
    aliases.add(`${normalized}_KEY`);
  }
  return aliases.has(target);
}

/**
 * Environment requirement default: satisfied when the ROX credential fabric
 * holds a credential whose type or scope maps onto the variable name.
 */
export async function defaultEnvExists(env: string): Promise<boolean> {
  const name = env.trim();
  if (!name) return false;
  try {
    const credentials: CredentialId[] = await getCredentialManager().list();
    return credentials.some(id => credentialIdMatchesEnvName(id, name));
  } catch {
    return false;
  }
}

/** Config requirement default: the dotted key exists in the stored config. */
export function defaultConfigExists(key: string): boolean {
  const segments = key.split('.').filter(Boolean);
  if (segments.length === 0) return false;
  let cursor: unknown = loadStoredConfig();
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor !== undefined && cursor !== null;
}

// ============================================================
// OS matching
// ============================================================

const PLATFORM_ALIASES: Record<string, string> = {
  darwin: 'macos',
  macos: 'macos',
  mac: 'macos',
  osx: 'macos',
  win32: 'windows',
  win: 'windows',
  windows: 'windows',
  linux: 'linux',
};

export function osMatches(required: readonly string[], platform: NodeJS.Platform): boolean {
  const current = PLATFORM_ALIASES[platform] ?? platform;
  return required.some(entry => {
    const want = PLATFORM_ALIASES[entry.trim().toLowerCase()] ?? entry.trim().toLowerCase();
    return want === current;
  });
}

// ============================================================
// Evaluation
// ============================================================

export interface SkillEligibilityInput {
  /** Catalog to gate — normally the merged `loadAllSkills` output. */
  skills: readonly LoadedSkill[];
  /** Operator allowlist; null/undefined admits every slug. */
  allowedSlugs?: readonly string[] | null;
  /** Slugs owned by disabled bundled packs (see getDisabledBundledSkillSlugsFromDisk). */
  disabledPackSlugs?: readonly string[];
  /** Scope for disabled-pack detection: only app-managed skills count. */
  appManagedSkill?: (skill: LoadedSkill) => boolean;
  platform?: NodeJS.Platform;
  checks?: SkillEligibilityChecks;
}

/**
 * Gate one catalog. A `shadowedByCraft` OMP variant, if a caller passes one, is
 * skipped rather than gated — the report's full scan never requests shadowed
 * variants, and collisions are computed separately from the ordered root plan.
 */
export async function evaluateSkillEligibility(input: SkillEligibilityInput): Promise<SkillEligibilityReport> {
  const checks = input.checks ?? {};
  const platform = input.platform ?? process.platform;
  const allowed = input.allowedSlugs == null ? null : new Set(input.allowedSlugs);
  const disabled = new Set(input.disabledPackSlugs ?? []);

  const eligible: LoadedSkill[] = [];
  const ineligible: SkillEligibilityEntry[] = [];

  for (const skill of input.skills) {
    if (skill.shadowedByCraft) continue;
    const reasons: SkillEligibilityReason[] = [];

    if (allowed && !allowed.has(skill.slug)) {
      reasons.push({ code: 'operator-not-allowed', detail: `"${skill.slug}" is not in the operator allowlist` });
    }

    if (disabled.has(skill.slug) && (input.appManagedSkill ? input.appManagedSkill(skill) : true)) {
      reasons.push({ code: 'disabled-pack', detail: `the pack providing "${skill.slug}" is disabled in settings` });
    }

    const requiredOs = skill.metadata.os;
    if (requiredOs && requiredOs.length > 0 && !osMatches(requiredOs, platform)) {
      reasons.push({ code: 'os-mismatch', detail: `requires ${requiredOs.join(' | ')}; this machine is ${platform}` });
    }

    const requires = skill.metadata.requires;
    if (requires?.bins?.length) {
      const missing: string[] = [];
      for (const bin of requires.bins) if (!(await (checks.binExists ?? defaultBinExists)(bin))) missing.push(bin);
      if (missing.length > 0) reasons.push({ code: 'missing-bin', detail: `missing executable(s): ${missing.join(', ')}` });
    }
    if (requires?.anyBins?.length) {
      let found = false;
      for (const bin of requires.anyBins) {
        if (await (checks.binExists ?? defaultBinExists)(bin)) {
          found = true;
          break;
        }
      }
      if (!found) reasons.push({ code: 'missing-bin', detail: `none of these executables is available: ${requires.anyBins.join(', ')}` });
    }
    if (requires?.env?.length) {
      const missing: string[] = [];
      for (const env of requires.env) if (!(await (checks.envExists ?? defaultEnvExists)(env))) missing.push(env);
      if (missing.length > 0) reasons.push({ code: 'missing-env', detail: `missing credential(s): ${missing.join(', ')}` });
    }
    if (requires?.config?.length) {
      const missing: string[] = [];
      for (const key of requires.config) if (!(await (checks.configExists ?? defaultConfigExists)(key))) missing.push(key);
      if (missing.length > 0) reasons.push({ code: 'missing-config', detail: `missing configuration: ${missing.join(', ')}` });
    }

    if (reasons.length === 0) eligible.push(skill);
    else ineligible.push({ skill, reasons });
  }

  return { eligible, ineligible, collisions: [] };
}

// ============================================================
// Collisions over the ordered root plan
// ============================================================

export interface SkillRootScan {
  /** Tier label (from getSkillRootPlan). */
  label: string;
  /** Skills discovered in this tier. */
  skills: readonly LoadedSkill[];
  /** Skip skills physically inside APP_MANAGED_SKILLS_DIR (application links). */
  excludeAppManaged?: boolean;
}

/**
 * Attribute each slug to the highest-priority tier that provides it. Scans must
 * be ordered LOWEST priority first; lower-priority providers are reported as
 * shadowed in that same order.
 */
export function detectSkillCollisions(scans: readonly SkillRootScan[]): SkillCollision[] {
  const bySlug = new Map<string, { label: string; path: string }[]>();
  for (const scan of scans) {
    for (const skill of scan.skills) {
      if (scan.excludeAppManaged && isInsideSkillStore(skill.path, APP_MANAGED_SKILLS_DIR)) continue;
      const providers = bySlug.get(skill.slug) ?? [];
      providers.push({ label: scan.label, path: skill.path });
      bySlug.set(skill.slug, providers);
    }
  }

  const collisions: SkillCollision[] = [];
  for (const [slug, providers] of bySlug) {
    if (providers.length < 2) continue;
    collisions.push({
      name: slug,
      winner: providers[providers.length - 1]!.label,
      shadowed: providers.slice(0, -1).map(provider => provider.label),
    });
  }
  return collisions.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Slug-scoped form of {@link detectSkillCollisions}: report collisions only for
 * the requested slugs, reading just those slugs out of each tier instead of
 * walking every tier. Used by the per-skill eligibility RPC, whose ceiling is a
 * single slug (a full tier walk would cost a whole-store scan per open).
 */
export function detectSkillCollisionsForSlugs(
  workspaceRoot: string,
  slugs: readonly string[],
  projectRoot?: string,
): SkillCollision[] {
  const plan = getSkillRootPlan(workspaceRoot, projectRoot);
  const scans: SkillRootScan[] = plan.map(entry => ({
    label: entry.label,
    excludeAppManaged: entry.excludeAppManaged,
    skills: slugs
      .map(slug => loadSkillFromDir(entry.root, slug, entry.source))
      .filter((skill): skill is LoadedSkill => skill !== null),
  }));
  return detectSkillCollisions(scans);
}

// ============================================================
// Convenience: full report from the workspace root plan
// ============================================================

export interface BuildSkillEligibilityInput {
  workspaceRoot: string;
  projectRoot?: string;
  /** Include OMP tiers (default true — the report is the agent-facing catalog). */
  includeOmp?: boolean;
  allowedSlugs?: readonly string[] | null;
  /**
   * Resolve ONLY these slugs instead of the full catalog. Used when the caller
   * already knows the ceiling (a per-skill RPC query, a profile allowlist) so a
   * large install is not scanned on every call.
   */
  slugs?: readonly string[];
  /**
   * Compute name collisions across the ordered root plan. Default true. On a
   * scoped request this is a slug-scoped check over the plan (only the
   * requested slugs are read per tier), so it stays O(slugs × tiers) instead
   * of walking every tier.
   */
  includeCollisions?: boolean;
  /** Defaults to the disabled packs recorded in bundled-skill state. */
  disabledPackSlugs?: readonly string[];
  platform?: NodeJS.Platform;
  checks?: SkillEligibilityChecks;
}

/**
 * Build the report for a workspace. The catalog comes from ONE discovery path:
 * `loadSkillDetails` for an allowlisted/scoped request (O(allowlist)), otherwise
 * the merged `loadAllSkills` output. The full-scan catalog keeps shadowed OMP
 * variants OUT (`includeShadowedOmp` is never set) so its cache key is the same
 * one the agent's mention resolution uses — a cold spawn walks the store once.
 * Collisions use the per-tier root walk on a full scan and a slug-scoped read
 * on a scoped request; hidden disabled packs are re-surfaced from the canonical
 * app-managed tier in both cases.
 */
export async function buildSkillEligibilityReport(input: BuildSkillEligibilityInput): Promise<SkillEligibilityReport> {
  const disabledPackSlugs = input.disabledPackSlugs ?? [...getDisabledBundledSkillSlugsFromDisk()];

  // Fast path: a known ceiling resolves only those slugs.
  const scopeSlugs = input.slugs ?? (input.allowedSlugs != null ? input.allowedSlugs : null);
  const fullScan = scopeSlugs === null;
  const wantCollisions = input.includeCollisions !== false;

  let catalog: LoadedSkill[];
  if (fullScan) {
    catalog = loadAllSkills(input.workspaceRoot, input.projectRoot, { includeOmp: input.includeOmp ?? true });
  } else {
    const resolved = await Promise.all(
      scopeSlugs.map(slug => loadSkillDetails(input.workspaceRoot, slug, input.projectRoot)),
    );
    catalog = resolved.filter((skill): skill is LoadedSkill => skill !== null);
  }

  // The per-tier root plan backs the collision report; a full scan only needs
  // it when collisions were requested (its app-managed tier also feeds the
  // disabled-pack re-surface below, so skipping it matches "no collision walk").
  const planScans: SkillRootScan[] | null = fullScan && wantCollisions
    ? getSkillRootPlan(input.workspaceRoot, input.projectRoot).map(entry => ({
        label: entry.label,
        skills: loadSkillsFromDir(entry.root, entry.source),
        excludeAppManaged: entry.excludeAppManaged,
      }))
    : null;

  // Disabled bundled skills are removed from discovery before the gate runs;
  // re-surface them from the canonical app-managed tier so the reason is still
  // reported. The full scan reuses its plan walk; a scoped request reads the
  // requested slugs that are both disabled and not already resolved.
  const disabled = new Set(disabledPackSlugs);
  const catalogSlugs = new Set(catalog.map(skill => skill.slug));
  const appManagedSkills: readonly LoadedSkill[] = planScans
    ? planScans.find(scan => scan.label === 'app-managed')?.skills ?? []
    : (scopeSlugs ?? [])
        .filter(slug => disabled.has(slug) && !catalogSlugs.has(slug))
        .map(slug => loadSkillFromDir(APP_MANAGED_SKILLS_DIR, slug, 'global'))
        .filter((skill): skill is LoadedSkill => skill !== null);
  for (const skill of appManagedSkills) {
    if (!disabled.has(skill.slug) || catalogSlugs.has(skill.slug)) continue;
    catalogSlugs.add(skill.slug);
    catalog.push(skill);
  }

  const report = await evaluateSkillEligibility({
    skills: catalog,
    allowedSlugs: input.allowedSlugs,
    disabledPackSlugs,
    appManagedSkill: skill => skill.source === 'global' && isInsideSkillStore(skill.path, APP_MANAGED_SKILLS_DIR),
    platform: input.platform,
    checks: input.checks,
  });

  if (planScans) {
    report.collisions = detectSkillCollisions(planScans);
  } else if (wantCollisions && scopeSlugs) {
    report.collisions = detectSkillCollisionsForSlugs(input.workspaceRoot, scopeSlugs, input.projectRoot);
  }

  return report;
}