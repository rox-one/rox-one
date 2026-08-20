import { describe, expect, test } from 'bun:test';
import { extractSessionVariables } from '../session-variables.ts';

describe('extractSessionVariables', () => {
  test('pulls mustache, dollar, and ASSIGN forms', () => {
    const vars = extractSessionVariables([
      { id: 'u1', content: 'Go to {{city}} with $user' },
      { id: 'a1', content: 'FOO=bar and TOKEN: secret' },
    ]);
    expect(vars.map((v) => v.name).sort()).toEqual(['FOO', 'TOKEN', 'city', 'user'].sort());
    expect(vars.find((v) => v.name === 'FOO')?.value).toBe('bar');
  });
});
