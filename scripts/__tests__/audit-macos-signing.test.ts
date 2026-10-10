/**
 * Row e2.8 — macOS signing audit fixtures.
 *
 * The verdict rules are exercised with canned `codesign -dv` / `codesign
 * --entitlements` / `spctl` output injected through a fake CommandRunner, so
 * every branch (single Team-ID, wrong Team-ID, missing Team-ID, JIT split)
 * is asserted without a signed bundle.
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditMacOSSigning,
  checkEntitlementSplit,
  evaluateAudit,
  firstOutputLine,
  formatReport,
  hasJitEntitlements,
  isMachO,
  parseEntitlements,
  parseTeamIdentifier,
  walkMachOFiles,
  type CommandResult,
  type CommandRunner,
} from '../audit-macos-signing.ts';

const TEAM = 'ABCDE12345';

function codesignDv(teamId: string | null): string {
  return [
    'Executable=/tmp/Rox.app/Contents/MacOS/Rox',
    'Identifier=one.rox.app',
    'Format=app bundle with Mach-O thin (arm64)',
    'CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=1+3',
    `TeamIdentifier=${teamId ?? 'not set'}`,
  ].join('\n');
}

function entitlementsXml(keys: string[]): string {
  const body = keys.map((key) => `<key>${key}</key><true/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>`;
}

const OK: CommandResult = { status: 0, stdout: '', stderr: '' };
const OK_SPCTL: CommandResult = { status: 0, stdout: 'accepted\nsource=Developer ID', stderr: '' };

function makeRunner(spec: {
  dv: Record<string, string>;
  ent: Record<string, string>;
  verify?: CommandResult;
  spctl?: CommandResult;
}): CommandRunner {
  return (file, args) => {
    const path = args[args.length - 1]!;
    if (file === 'codesign' && args.includes('-dv')) return { status: 0, stdout: spec.dv[path] ?? '', stderr: '' };
    if (file === 'codesign' && args.includes('--entitlements')) return { status: 0, stdout: spec.ent[path] ?? '', stderr: '' };
    if (file === 'codesign' && args.includes('--verify')) return spec.verify ?? OK;
    if (file === 'spctl') return spec.spctl ?? OK_SPCTL;
    return { status: 1, stdout: '', stderr: `unexpected command: ${file} ${args.join(' ')}` };
  };
}

const APP_EXE = '/fake/Rox.app/Contents/MacOS/Rox';
const NESTED_BUN = '/fake/Rox.app/Contents/Resources/app/vendor/bun/bun';

function withFixtureApp(fn: (appPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'rox-signing-fixture-'));
  try {
    const exec = join(root, 'Rox.app', 'Contents', 'MacOS', 'Rox');
    const nested = join(root, 'Rox.app', 'Contents', 'Resources', 'app', 'vendor', 'bun', 'bun');
    mkdirSync(join(exec, '..'), { recursive: true });
    mkdirSync(join(nested, '..'), { recursive: true });
    // 64-bit little-endian Mach-O magic + padding.
    writeFileSync(exec, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    writeFileSync(nested, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    writeFileSync(join(root, 'Rox.app', 'Contents', 'Resources', 'notes.txt'), 'not a binary');
    fn(join(root, 'Rox.app'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('audit-macos-signing parsing', () => {
  it('reads a TeamIdentifier from canned codesign -dv output', () => {
    expect(parseTeamIdentifier(codesignDv(TEAM))).toBe(TEAM);
  });

  it('treats "not set" and unsigned output as missing (fail closed)', () => {
    expect(parseTeamIdentifier(codesignDv(null))).toBeNull();
    expect(parseTeamIdentifier('code object is not signed at all')).toBeNull();
  });

  it('extracts entitlement keys from codesign entitlements XML', () => {
    expect(parseEntitlements(entitlementsXml(['com.apple.security.cs.allow-jit']))).toEqual([
      'com.apple.security.cs.allow-jit',
    ]);
    expect(hasJitEntitlements(['com.apple.security.device.audio-input'])).toBe(false);
    expect(hasJitEntitlements(['com.apple.security.cs.allow-unsigned-executable-memory'])).toBe(true);
  });

  it('detects Mach-O by magic bytes and skips plain files', () => {
    withFixtureApp((appPath) => {
      const exec = join(appPath, 'Contents', 'MacOS', 'Rox');
      expect(isMachO(exec)).toBe(true);
      expect(isMachO(join(appPath, 'Contents', 'Resources', 'notes.txt'))).toBe(false);
      expect(walkMachOFiles(appPath).map((p) => p.slice(appPath.length))).toEqual([
        '/Contents/MacOS/Rox',
        '/Contents/Resources/app/vendor/bun/bun',
      ]);
    });
  });

  it('reports the first non-empty output line', () => {
    expect(firstOutputLine('\n  bad signature\nmore')).toBe('bad signature');
    expect(firstOutputLine('')).toBe('');
  });
});

describe('audit-macos-signing verdict rules', () => {
  it('passes a correct single-Team-ID bundle with the JIT split', () => {
    const result = evaluateAudit({
      appExecutable: APP_EXE,
      machoFiles: [
        { path: APP_EXE, teamId: TEAM, entitlements: ['com.apple.security.device.audio-input'] },
        { path: NESTED_BUN, teamId: TEAM, entitlements: ['com.apple.security.cs.allow-jit'] },
      ],
      verify: OK,
      spctl: OK_SPCTL,
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.teamId).toBe(TEAM);
    expect(result.appJit).toBe(false);
    expect(result.nestedJit).toBe(true);
  });

  it('fails a bundle with a wrong second TeamIdentifier', () => {
    const result = evaluateAudit({
      appExecutable: APP_EXE,
      machoFiles: [
        { path: APP_EXE, teamId: TEAM, entitlements: ['com.apple.security.device.audio-input'] },
        { path: NESTED_BUN, teamId: 'ZZZZZ99999', entitlements: ['com.apple.security.cs.allow-jit'] },
      ],
      verify: OK,
      spctl: OK_SPCTL,
    });
    expect(result.ok).toBe(false);
    expect(result.teamId).toBeNull();
    expect(result.failures.join('\n')).toContain('multiple TeamIdentifiers');
  });

  it('fails a bundle with a missing (ad-hoc) TeamIdentifier', () => {
    const result = evaluateAudit({
      appExecutable: APP_EXE,
      machoFiles: [
        { path: APP_EXE, teamId: TEAM, entitlements: ['com.apple.security.device.audio-input'] },
        { path: NESTED_BUN, teamId: null, entitlements: ['com.apple.security.cs.allow-jit'] },
      ],
      verify: OK,
      spctl: OK_SPCTL,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('unsigned / ad-hoc Mach-O');
  });

  it('fails closed when codesign --verify or spctl rejects the bundle', () => {
    const verified = evaluateAudit({
      appExecutable: APP_EXE,
      machoFiles: [{ path: APP_EXE, teamId: TEAM, entitlements: ['com.apple.security.device.audio-input'] }],
      verify: { status: 1, stdout: '', stderr: 'invalid signature' },
      spctl: OK_SPCTL,
    });
    expect(verified.ok).toBe(false);
    expect(verified.failures.join('\n')).toContain('codesign --verify');

    const gatekeeper = evaluateAudit({
      appExecutable: APP_EXE,
      machoFiles: [{ path: APP_EXE, teamId: TEAM, entitlements: ['com.apple.security.device.audio-input'] }],
      verify: OK,
      spctl: { status: 3, stdout: 'rejected', stderr: '' },
    });
    expect(gatekeeper.ok).toBe(false);
    expect(gatekeeper.failures.join('\n')).toContain('spctl');
  });
});

describe('entitlement split', () => {
  const APP_NO_JIT = ['com.apple.security.device.audio-input'];
  const APP_JIT = ['com.apple.security.cs.allow-jit'];
  const NESTED_JIT = ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory'];
  const NESTED_NO_JIT = ['com.apple.security.cs.disable-library-validation'];

  it('passes when a nested runtime binary has JIT and the app does not', () => {
    expect(checkEntitlementSplit(APP_NO_JIT, [NESTED_JIT])).toEqual([]);
  });

  it('fails when the app has JIT while nested binaries do not', () => {
    const failures = checkEntitlementSplit(APP_JIT, [NESTED_NO_JIT]);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join('\n')).toContain('app executable carries JIT entitlements');
    expect(failures.join('\n')).toContain('no nested runtime binary carries JIT');
  });

  it('leaks are visible through the full verdict', () => {
    const leaked = evaluateAudit({
      appExecutable: APP_EXE,
      machoFiles: [
        { path: APP_EXE, teamId: TEAM, entitlements: APP_JIT },
        { path: NESTED_BUN, teamId: TEAM, entitlements: NESTED_NO_JIT },
      ],
      verify: OK,
      spctl: OK_SPCTL,
    });
    expect(leaked.ok).toBe(false);
    expect(leaked.appJit).toBe(true);
    expect(leaked.nestedJit).toBe(false);
  });
});

describe('auditMacOSSigning driver (injected runner)', () => {
  it('walks a packaged app and passes a correct bundle', () => {
    withFixtureApp((appPath) => {
      const exec = join(appPath, 'Contents', 'MacOS', 'Rox');
      const nested = join(appPath, 'Contents', 'Resources', 'app', 'vendor', 'bun', 'bun');
      const result = auditMacOSSigning(appPath, {
        runner: makeRunner({
          dv: { [exec]: codesignDv(TEAM), [nested]: codesignDv(TEAM) },
          ent: {
            [exec]: entitlementsXml(['com.apple.security.device.audio-input']),
            [nested]: entitlementsXml(['com.apple.security.cs.allow-jit']),
          },
        }),
      });
      expect(result.ok).toBe(true);
      expect(result.machoCount).toBe(2);
      expect(formatReport(appPath, result)).toContain('VERDICT: PASS');
    });
  });

  it('fails closed on a wrong nested TeamIdentifier', () => {
    withFixtureApp((appPath) => {
      const exec = join(appPath, 'Contents', 'MacOS', 'Rox');
      const nested = join(appPath, 'Contents', 'Resources', 'app', 'vendor', 'bun', 'bun');
      const result = auditMacOSSigning(appPath, {
        runner: makeRunner({
          dv: { [exec]: codesignDv(TEAM), [nested]: codesignDv('ZZZZZ99999') },
          ent: {
            [exec]: entitlementsXml(['com.apple.security.device.audio-input']),
            [nested]: entitlementsXml(['com.apple.security.cs.allow-jit']),
          },
        }),
      });
      expect(result.ok).toBe(false);
      expect(formatReport(appPath, result)).toContain('VERDICT: FAIL');
    });
  });

  it('fails closed when the app path does not exist', () => {
    const result = auditMacOSSigning('/definitely/not/here/Rox.app', { runner: makeRunner({ dv: {}, ent: {} }) });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('not found');
  });

  it('fails closed when codesign cannot read an entitlements blob (not the "no entitlements" case)', () => {
    withFixtureApp((appPath) => {
      const exec = join(appPath, 'Contents', 'MacOS', 'Rox');
      const nested = join(appPath, 'Contents', 'Resources', 'app', 'vendor', 'bun', 'bun');
      const runner: CommandRunner = (file, args) => {
        const path = args[args.length - 1]!;
        if (file === 'codesign' && args.includes('-dv')) return { status: 0, stdout: codesignDv(TEAM), stderr: '' };
        if (file === 'codesign' && args.includes('--entitlements')) {
          // The app binary's blob is unreadable for a reason other than "no
          // entitlements" — previously collapsed to [], hiding a possible JIT grant.
          if (path === exec) return { status: 1, stdout: '', stderr: 'the codesign_allocate helper tool cannot be found' };
          return { status: 0, stdout: entitlementsXml(['com.apple.security.cs.allow-jit']), stderr: '' };
        }
        if (file === 'codesign' && args.includes('--verify')) return OK;
        if (file === 'spctl') return OK_SPCTL;
        return { status: 1, stdout: '', stderr: `unexpected command: ${file}` };
      };
      const result = auditMacOSSigning(appPath, { runner });
      expect(result.ok).toBe(false);
      expect(result.failures.join('\n')).toContain('could not read entitlements');
      expect(result.failures.join('\n')).toContain(exec);
      expect(formatReport(appPath, result)).toContain('VERDICT: FAIL');
    });
  });

  it('accepts the explicit "no entitlements" answer, so nested dylibs do not fail the audit', () => {
    withFixtureApp((appPath) => {
      const exec = join(appPath, 'Contents', 'MacOS', 'Rox');
      const nested = join(appPath, 'Contents', 'Resources', 'app', 'vendor', 'bun', 'bun');
      const runner: CommandRunner = (file, args) => {
        const path = args[args.length - 1]!;
        if (file === 'codesign' && args.includes('-dv')) return { status: 0, stdout: codesignDv(TEAM), stderr: '' };
        if (file === 'codesign' && args.includes('--entitlements')) {
          if (path === exec) return { status: 0, stdout: entitlementsXml(['com.apple.security.device.audio-input']), stderr: '' };
          return { status: 1, stdout: '', stderr: 'code has no entitlements' };
        }
        if (file === 'codesign' && args.includes('--verify')) return OK;
        if (file === 'spctl') return OK_SPCTL;
        return { status: 1, stdout: '', stderr: `unexpected command: ${file}` };
      };
      // No nested JIT ⇒ the split rule still fails, but NOT with a read error.
      const result = auditMacOSSigning(appPath, { runner });
      expect(result.failures.join('\n')).not.toContain('could not read entitlements');
    });
  });
});