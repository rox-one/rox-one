/**
 * Row e2.8 — entitlement-split plist contract.
 *
 * The app's own executable keeps only its own needs; the JIT keys live in the
 * inherit plist that electron-builder wires through `entitlementsInherit`.
 * `entitlements.mac.inherit.plist` must be a superset of the runtime plist and
 * additionally carry `com.apple.security.virtualization`, which the bundled
 * Lima VM host needs and which re-signing would otherwise strip.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const buildDir = new URL('../../apps/electron/build/', import.meta.url);
const APP_PLIST = fileURLToPath(new URL('entitlements.mac.plist', buildDir));
const RUNTIME_PLIST = fileURLToPath(new URL('entitlements.runtime.plist', buildDir));
const INHERIT_PLIST = fileURLToPath(new URL('entitlements.mac.inherit.plist', buildDir));

const JIT_KEYS = ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory'];
const VIRTUALIZATION_KEY = 'com.apple.security.virtualization';

/** Parse the dictionary's boolean entries (`<key>k</key><true/>`). */
function booleanEntries(xml: string): Record<string, boolean> {
  const entries: Record<string, boolean> = {};
  for (const match of xml.matchAll(/<key>([^<]+)<\/key>\s*<(true|false)\s*\/>/g)) {
    entries[match[1]!.trim()] = match[2] === 'true';
  }
  return entries;
}

function assertValidXmlPlist(path: string): void {
  const xml = readFileSync(path, 'utf8');
  expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
  expect(xml).toContain('http://www.apple.com/DTDs/PropertyList-1.0.dtd');
  expect(xml).toContain('<plist version="1.0">');
  expect(xml.trimEnd().endsWith('</plist>')).toBe(true);
  // Authoritative well-formedness check on macOS; structural checks above run everywhere.
  const lint = spawnSync('plutil', ['-lint', path], { encoding: 'utf8' });
  if (lint.error === undefined) {
    expect(lint.status).toBe(0);
    expect(lint.stdout).toContain('OK');
  }
}

describe('macOS entitlement plists', () => {
  it('app plist is a valid XML plist with no JIT keys', () => {
    assertValidXmlPlist(APP_PLIST);
    const entries = booleanEntries(readFileSync(APP_PLIST, 'utf8'));
    for (const key of JIT_KEYS) {
      expect(entries[key]).toBeUndefined();
    }
    expect(entries[VIRTUALIZATION_KEY]).toBeUndefined();
    expect(entries['com.apple.security.device.audio-input']).toBe(true);
  });

  it('runtime plist is a valid XML plist carrying both JIT keys', () => {
    assertValidXmlPlist(RUNTIME_PLIST);
    const entries = booleanEntries(readFileSync(RUNTIME_PLIST, 'utf8'));
    for (const key of JIT_KEYS) {
      expect(entries[key]).toBe(true);
    }
  });

  it('inherit plist carries every runtime key plus the virtualization grant', () => {
    assertValidXmlPlist(INHERIT_PLIST);
    const runtime = booleanEntries(readFileSync(RUNTIME_PLIST, 'utf8'));
    const inherit = booleanEntries(readFileSync(INHERIT_PLIST, 'utf8'));
    // "Preserve ALL runtime content" — every runtime entry, with the same value.
    for (const [key, value] of Object.entries(runtime)) {
      expect([key, inherit[key]]).toEqual([key, value]);
    }
    for (const key of JIT_KEYS) {
      expect(inherit[key]).toBe(true);
    }
    expect(inherit['com.apple.security.cs.disable-library-validation']).toBe(true);
    expect(inherit[VIRTUALIZATION_KEY]).toBe(true);
  });

  it('wires the split through electron-builder entitlements/entitlementsInherit', () => {
    const yml = readFileSync(fileURLToPath(new URL('electron-builder.yml', new URL('../../apps/electron/', import.meta.url))), 'utf8');
    expect(yml).toContain('entitlements: build/entitlements.mac.plist');
    expect(yml).toContain('entitlementsInherit: build/entitlements.mac.inherit.plist');
    // The vendored Lima VM host is signed explicitly (mac.binaries); the path is
    // .app-relative and cannot use ${arch} — app-builder's expandArch() strips it.
    expect(yml).toContain('- Contents/Resources/bin/darwin-arm64/limactl');
  });
});