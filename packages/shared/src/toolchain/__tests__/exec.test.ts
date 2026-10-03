import { describe, expect, it } from 'bun:test';
import { prependPath } from '../exec';

describe('subprocess PATH environment', () => {
  it('preserves a Windows Path value and emits only one case-insensitive key', () => {
    const env = { Path: 'C:\\Windows;C:\\Git\\cmd', PATH: 'stale', OTHER: 'keep' };
    const next = prependPath(env, 'C:\\managed\\bin', true);
    expect(next.Path).toBe('C:\\managed\\bin;C:\\Windows;C:\\Git\\cmd');
    expect(Object.keys(next).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['Path']);
    expect(next.OTHER).toBe('keep');
    expect(env.PATH).toBe('stale');
  });

  it('uses a colon and case-sensitive PATH on POSIX', () => {
    expect(prependPath({ PATH: '/usr/bin', Path: 'unrelated' }, '/managed/bin', false))
      .toEqual({ PATH: '/managed/bin:/usr/bin', Path: 'unrelated' });
  });
});
