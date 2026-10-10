#!/usr/bin/env bun
/**
 * scripts/audit-macos-signing.ts — macOS code-signing audit (row e2.8).
 *
 * Walks a packaged `.app`, lists every Mach-O file, and fails closed unless:
 *   1. exactly ONE TeamIdentifier appears across all of them (unsigned / ad-hoc
 *      = `not set` counts as missing, so it fails);
 *   2. `codesign --verify --deep --strict` succeeds;
 *   3. `spctl --assess --type execute` accepts the bundle;
 *   4. the entitlement split holds — the app's own main executable carries NO
 *      JIT keys (`com.apple.security.cs.allow-jit`,
 *      `com.apple.security.cs.allow-unsigned-executable-memory`), while at least
 *      one nested runtime binary DOES carry them (the runtime plist was applied).
 *
 * Every parser takes plain text so the verdict rules are fixture-testable
 * without a signed bundle: `auditMacOSSigning(appPath, { runner })` accepts an
 * injected command runner that returns canned `codesign -dv` / `spctl` output.
 *
 * Usage: bun run scripts/audit-macos-signing.ts <path/to/Rox.app>
 */
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const JIT_ENTITLEMENT_KEYS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
] as const;

/** Mach-O magics as read big-endian from the first 4 file bytes (incl. fat). */
const MACHO_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, // MH_MAGIC / MH_MAGIC_64 (big-endian reads)
  0xcefaedfe, 0xcffaedfe, // MH_CIGAM / MH_CIGAM_64 (little-endian hosts)
  0xcafebabe, 0xcafebabf, // FAT_MAGIC / FAT_MAGIC_64
  0xbebafeca, 0xbfbafeca, // FAT_CIGAM / FAT_CIGAM_64
]);

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Injectable command runner. `status` is a non-zero sentinel when unspawnable. */
export type CommandRunner = (file: string, args: string[]) => CommandResult;

export const defaultRunner: CommandRunner = (file, args) => {
  const result = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error.message) : ''),
  };
};

/** Read the first 4 bytes and classify the file as Mach-O. Never throws. */
export function isMachO(filePath: string): boolean {
  let fd: number | undefined;
  try {
    const buffer = Buffer.alloc(4);
    fd = openSync(filePath, 'r');
    if (readSync(fd, buffer, 0, 4, 0) < 4) return false;
    return MACHO_MAGICS.has(buffer.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Recursively list every Mach-O file under `appPath` (nested `.app`s included). */
export function walkMachOFiles(appPath: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && isMachO(full)) found.push(full);
    }
  };
  visit(appPath);
  return found.sort();
}

/**
 * Extract the TeamIdentifier from `codesign -dv --verbose=4` output.
 * Returns null for an unsigned / ad-hoc binary (`TeamIdentifier=not set`);
 * callers MUST treat null as a failure (fail closed).
 */
export function parseTeamIdentifier(codesignDvOutput: string): string | null {
  const match = codesignDvOutput.match(/^TeamIdentifier=(.*)$/m);
  const value = match?.[1]?.trim();
  if (!value || /^not set$/i.test(value)) return null;
  return value;
}

/** Extract entitlement keys from `codesign -d --entitlements :- <path>` XML. */
export function parseEntitlements(entitlementsXml: string): string[] {
  const keys = [...entitlementsXml.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]!.trim());
  return [...new Set(keys)];
}

export function hasJitEntitlements(entitlementKeys: string[]): boolean {
  return JIT_ENTITLEMENT_KEYS.some((key) => entitlementKeys.includes(key));
}

export interface MachOReport {
  path: string;
  teamId: string | null;
  entitlements: string[];
  /**
   * Set when `codesign --entitlements` failed for a reason OTHER than the
   * explicit "no entitlements" answer. The keys are then unknown, so the report
   * MUST fail closed: an empty `entitlements` array alone would let a binary
   * carrying JIT slip past the split rule.
   */
  entitlementsError?: string;
}

export interface AuditResult {
  ok: boolean;
  failures: string[];
  warnings: string[];
  teamId: string | null;
  machoCount: number;
  appJit: boolean;
  nestedJit: boolean;
}

/**
 * Pure verdict rules (no filesystem / process access) so canned fixtures can
 * assert every branch. `appExecutable` is the app's own main executable.
 */
export function evaluateAudit(input: {
  appExecutable: string;
  machoFiles: MachOReport[];
  verify: CommandResult;
  spctl: CommandResult;
}): AuditResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  if (input.machoFiles.length === 0) {
    failures.push('no Mach-O files found inside the app bundle');
  }

  // 1. Exactly one TeamIdentifier across every Mach-O (fail closed on null).
  const missingTeam = input.machoFiles.filter((f) => f.teamId === null).map((f) => f.path);
  if (missingTeam.length > 0) {
    failures.push(`unsigned / ad-hoc Mach-O (no TeamIdentifier): ${missingTeam.join(', ')}`);
  }
  const teamIds = [...new Set(input.machoFiles.map((f) => f.teamId).filter((t): t is string => t !== null))];
  if (teamIds.length > 1) {
    failures.push(`multiple TeamIdentifiers across Mach-O files: ${teamIds.join(', ')}`);
  }
  const teamId = teamIds.length === 1 ? teamIds[0]! : null;

  // 2. Deep strict signature verification.
  if (input.verify.status !== 0) {
    failures.push(`codesign --verify --deep --strict failed (status ${input.verify.status}): ${firstOutputLine(input.verify.stderr || input.verify.stdout)}`);
  }

  // 3. Gatekeeper assessment.
  const spctlText = `${input.spctl.stdout}\n${input.spctl.stderr}`;
  if (input.spctl.status !== 0 || !/accepted/i.test(spctlText)) {
    failures.push(`spctl assessment did not accept the bundle (status ${input.spctl.status}): ${firstOutputLine(spctlText)}`);
  }

  // 4. Entitlement split: JIT only on nested runtime binaries, never on the app.
  // A blob we could not read is a failure in its own right — its keys are
  // unknown, so treating it as "no entitlements" could hide a leaked JIT grant.
  for (const file of input.machoFiles) {
    if (file.entitlementsError) failures.push(file.entitlementsError);
  }
  const app = input.machoFiles.find((f) => resolve(f.path) === resolve(input.appExecutable));
  if (!app) {
    failures.push(`app main executable not among the Mach-O files: ${input.appExecutable}`);
  }
  const appJit = app ? hasJitEntitlements(app.entitlements) : false;
  const nested = input.machoFiles.filter((f) => resolve(f.path) !== resolve(input.appExecutable));
  const nestedJit = nested.some((f) => hasJitEntitlements(f.entitlements));
  failures.push(...checkEntitlementSplit(app?.entitlements ?? [], nested.map((f) => f.entitlements)));

  if (nested.some((f) => f.entitlements.length === 0)) {
    warnings.push('some nested Mach-O files carry no entitlements (dylibs/NAPI artifacts — expected)');
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    teamId,
    machoCount: input.machoFiles.length,
    appJit,
    nestedJit,
  };
}

/**
 * Entitlement-split rule: the app must carry no JIT key, and at least one
 * nested runtime binary must carry one (proving the runtime plist was applied).
 */
export function checkEntitlementSplit(appEntitlements: string[], nestedEntitlements: string[][]): string[] {
  const failures: string[] = [];
  const appJit = JIT_ENTITLEMENT_KEYS.filter((key) => appEntitlements.includes(key));
  if (appJit.length > 0) {
    failures.push(`app executable carries JIT entitlements (${appJit.join(', ')}); they belong only on runtime binaries`);
  }
  const nestedJit = nestedEntitlements.some((keys) => hasJitEntitlements(keys));
  if (!nestedJit) {
    failures.push('no nested runtime binary carries JIT entitlements; the runtime plist was not applied');
  }
  return failures;
}

/** First non-empty, trimmed line of canned command output (report detail). */
export function firstOutputLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
}

/** Locate `<app>/Contents/MacOS/<productName>`. */
export function findAppExecutable(appPath: string): string {
  const macOsDir = join(appPath, 'Contents', 'MacOS');
  const entries = readdirSync(macOsDir, { withFileTypes: true }).filter((e) => e.isFile() && !e.isSymbolicLink());
  if (entries.length === 0) throw new Error(`no executable found in ${macOsDir} (fail closed)`);
  // The product executable is the one without the ` Helper` suffix.
  const exe = entries.find((e) => !e.name.endsWith(' Helper')) ?? entries[0]!;
  return join(macOsDir, exe.name);
}

/** Run the full audit against a real `.app` (or an injected fake runner). */
export function auditMacOSSigning(
  appPath: string,
  options: { runner?: CommandRunner } = {},
): AuditResult {
  const runner = options.runner ?? defaultRunner;
  const app = resolve(appPath);

  let stat;
  try {
    stat = statSync(app);
  } catch {
    return failClosedResult(`app bundle not found: ${app}`);
  }
  if (!stat.isDirectory()) return failClosedResult(`not a directory: ${app}`);

  const appExecutable = findAppExecutable(app);
  const machoFiles = walkMachOFiles(app).map((path) => {
    const dv = runner('codesign', ['-dv', '--verbose=4', path]);
    const ent = runner('codesign', ['-d', '--entitlements', ':-', path]);
    // Exit 0 ⇒ parse. A non-zero exit is only benign for the explicit
    // "no entitlements" answer; any other error means the blob is unreadable
    // and the file MUST fail closed (its JIT keys are unknown).
    const noEntitlements = ent.status !== 0 && /no entitlements/i.test(ent.stderr);
    const ok = ent.status === 0 || noEntitlements;
    return {
      path,
      teamId: dv.status === 0 ? parseTeamIdentifier(dv.stdout) : null,
      entitlements: ok ? parseEntitlements(ent.stdout) : [],
      entitlementsError: ok
        ? undefined
        : `could not read entitlements for ${path} (status ${ent.status}): ${firstOutputLine(ent.stderr || ent.stdout)}`,
    };
  });

  const verify = runner('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const spctl = runner('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);

  return evaluateAudit({ appExecutable, machoFiles, verify, spctl });
}

function failClosedResult(reason: string): AuditResult {
  return { ok: false, failures: [reason], warnings: [], teamId: null, machoCount: 0, appJit: false, nestedJit: false };
}

export function formatReport(appPath: string, result: AuditResult): string {
  const lines = [
    `macOS signing audit: ${resolve(appPath)}`,
    `  Mach-O files: ${result.machoCount}`,
    `  TeamIdentifier: ${result.teamId ?? '(none)'}`,
    `  app main has JIT: ${result.appJit}`,
    `  nested runtime has JIT: ${result.nestedJit}`,
  ];
  for (const warning of result.warnings) lines.push(`  warning: ${warning}`);
  if (result.ok) lines.push('  VERDICT: PASS');
  else {
    lines.push('  VERDICT: FAIL');
    for (const failure of result.failures) lines.push(`    - ${failure}`);
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const appPath = process.argv[2] ?? process.env.ROX_APP_PATH;
  if (!appPath) {
    console.error('Usage: bun run scripts/audit-macos-signing.ts <path/to/Rox.app>');
    process.exit(2);
  }
  const result = auditMacOSSigning(appPath);
  console.log(formatReport(appPath, result));
  // Fail closed: any unmet rule stops the release.
  process.exit(result.ok ? 0 : 1);
}