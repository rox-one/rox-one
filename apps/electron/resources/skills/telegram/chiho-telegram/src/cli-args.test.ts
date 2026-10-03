import { describe, expect, it } from 'vitest';
import { parseCommandArgs } from './app/cli-args.js';

describe('parseCommandArgs', () => {
  it('accepts opaque cursor values that begin with hyphens', () => {
    const parsed = parseCommandArgs(['--cursor', '--abc_DEF123'], ['--cursor']);
    expect(parsed.values.get('--cursor')).toBe('--abc_DEF123');
  });

  it('still rejects another value option in place of a cursor', () => {
    expect(() => parseCommandArgs(['--cursor', '--page-size', '1'], ['--cursor', '--page-size']))
      .toThrow('Missing value for --cursor');
  });

  it('treats negative numeric tokens as positionals', () => {
    const parsed = parseCommandArgs(['-1001234567890']);
    expect(parsed.positionals).toEqual(['-1001234567890']);
    expect(parsed.flags.size).toBe(0);
  });

  it('accepts negative numeric option values', () => {
    const parsed = parseCommandArgs(['--chat', '-1001234567890'], ['--chat']);
    expect(parsed.values.get('--chat')).toBe('-1001234567890');
  });

  it('supports -- end-of-options marker', () => {
    const parsed = parseCommandArgs(['--limit', '5', '--', '-1001234567890', '--json'], [
      '--limit',
    ]);

    expect(parsed.values.get('--limit')).toBe('5');
    expect(parsed.positionals).toEqual(['-1001234567890', '--json']);
    expect(parsed.flags.size).toBe(0);
  });

  it('keeps negative peer ids positional while excluding trailing flags', () => {
    const parsed = parseCommandArgs(['CodexTest', '-260498577', '--json']);

    expect(parsed.positionals).toEqual(['CodexTest', '-260498577']);
    expect(parsed.flags.has('--json')).toBe(true);
  });
});
