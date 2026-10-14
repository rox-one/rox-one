import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { shouldShutdownOnStdinClose } from './stdin-close-policy.ts';

describe('shouldShutdownOnStdinClose', () => {
  it('ignores stdin EOF unless ROX_SHUTDOWN_ON_STDIN_CLOSE=1', () => {
    expect(shouldShutdownOnStdinClose({})).toBe(false);
    expect(shouldShutdownOnStdinClose({ ROX_SHUTDOWN_ON_STDIN_CLOSE: '0' })).toBe(false);
    expect(shouldShutdownOnStdinClose({ ROX_SHUTDOWN_ON_STDIN_CLOSE: 'true' })).toBe(false);
    expect(shouldShutdownOnStdinClose({ ROX_SHUTDOWN_ON_STDIN_CLOSE: '1' })).toBe(true);
  });
});

describe('pi-agent-server stdin close wiring', () => {
  it('does not call handleShutdown on close unless the opt-in is armed', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain("from './stdin-close-policy.ts'");
    expect(source).toContain('shouldShutdownOnStdinClose');
    expect(source).toContain("rl.on('close'");
    expect(source).not.toMatch(
      /rl\.on\('close',\s*\(\)\s*=>\s*\{\s*debugLog\('stdin closed, shutting down'\);\s*handleShutdown\(\);/,
    );
  });
});
