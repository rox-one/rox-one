/**
 * Row e2.8 — entitlement-split plist contract.
 *
 * The app's own executable keeps only its own needs; the JIT keys live in the
 * runtime plist that electron-builder wires through `entitlementsInherit`.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const buildDir = new URL('../../apps/electron/build/', import.meta.url);
const APP_PLIST = fileURLToPath(new URL('entitlements.mac.plist', buildDir));
const RUNTIME_PLIST = fileURLToPath(new URL('entitlements.runtime.plist', buildDir));

const JIT_KEYS = ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory'];

function readPlist(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Parse the dictionary's boolean entries (`<key>k</key><true/>`). */
function booleanEntries(xml: string): Record<string, boolean> {
  const entries: Record<string, boolean> = {};
  for (const match of xml.matchAll(/<key>([^<]+)<\/key>\s*<(true|false)\s*\/>/g)) {
    entries[match[1]!.trim()] = match[2] === 'true';
  }
  return entries;
}

function assertValidXmlPlist(path: string): void {
  const xml = readPlist(path);
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
    const entries = booleanEntries(readPlist(APP_PLIST));
    for (const key of JIT_KEYS) {
      expect(entries[key]).toBeUndefined();
    }
    expect(entries['com.apple.security.device.audio-input']).toBe(true);
  });

  it('runtime plist is a valid XML plist carrying both JIT keys', () => {
    assertValidXmlPlist(RUNTIME_PLIST);
    const entries = booleanEntries(readPlist(RUNTIME_PLIST));
    for (const key of JIT_KEYS) {
      expect(entries[key]).toBe(true);
    }
  });

  it('wires the split through electron-builder entitlements/entitlementsInherit', () => {
    const yml = readFileSync(fileURLToPath(new URL('electron-builder.yml', new URL('../../apps/electron/', import.meta.url))), 'utf8');
    expect(yml).toContain('entitlements: build/entitlements.mac.plist');
    expect(yml).toContain('entitlementsInherit: build/entitlements.runtime.plist');
  });
});