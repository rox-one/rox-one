import { describe, expect, it } from 'bun:test';
import {
  hashPrivilegedCommand,
  isPrivilegedCommandAllowed,
  matchPrivilegedCommand,
} from '../privileged-policy.ts';

describe('privileged-policy', () => {
  it('allows brew cask install/upgrade and installer -pkg -target /', () => {
    expect(matchPrivilegedCommand('brew install --cask docker')?.kind).toBe('brew-install-cask');
    expect(matchPrivilegedCommand('brew install --cask docker')?.appToken).toBe('docker');
    expect(matchPrivilegedCommand('brew upgrade --cask iterm2')?.kind).toBe('brew-upgrade-cask');
    expect(matchPrivilegedCommand('installer -pkg Foo.pkg -target /')?.kind).toBe('installer-pkg');
    expect(isPrivilegedCommandAllowed('brew install --cask docker')).toBe(true);
  });

  it('rejects commands outside the allowlist', () => {
    expect(matchPrivilegedCommand('rm -rf /')).toBeNull();
    expect(matchPrivilegedCommand('brew install wget')).toBeNull();
    expect(matchPrivilegedCommand('sudo installer -pkg Foo.pkg -target /')).toBeNull();
    expect(matchPrivilegedCommand('installer -pkg -target /')).toBeNull();
    expect(isPrivilegedCommandAllowed('echo hi')).toBe(false);
  });

  it('classifies long adversarial input without hanging', () => {
    const bangs = '!'.repeat(20_000);
    const start = process.hrtime.bigint();
    expect(matchPrivilegedCommand(`brew install --cask ${bangs}`)?.kind).toBe('brew-install-cask');
    expect(matchPrivilegedCommand(`installer -pkg ${bangs} -target /`)?.kind).toBe('installer-pkg');
    expect(matchPrivilegedCommand(`${bangs} brew install --cask docker`)).toBeNull();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    expect(ms).toBeLessThan(200);
  });

  it('hashes the raw command with sha256 hex', () => {
    const hex = hashPrivilegedCommand('brew install --cask docker');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(hex).toBe(hashPrivilegedCommand('brew install --cask docker'));
    expect(hex).not.toBe(hashPrivilegedCommand('brew install --cask iterm2'));
  });
});
