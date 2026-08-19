import { describe, expect, it } from 'bun:test';
import { buildSessionToolDefs } from '../session-tool-defs.ts';

describe('buildSessionToolDefs host-tool bash', () => {
  it('does not advertise unprefixed bash for Pi (alias off)', () => {
    const defs = buildSessionToolDefs();
    const names = defs.map((d) => d.name);
    expect(names).toContain('mcp__session__bash');
    expect(names).not.toContain('bash');
  });

  it('advertises unprefixed bash alias for OMP', () => {
    const defs = buildSessionToolDefs({ includeHostBashAlias: true });
    const names = defs.map((d) => d.name);
    expect(names).toContain('mcp__session__bash');
    expect(names).toContain('bash');
    const prefixed = defs.find((d) => d.name === 'mcp__session__bash');
    const alias = defs.find((d) => d.name === 'bash');
    expect(alias?.description).toBe(prefixed?.description);
    expect(alias?.inputSchema).toEqual(prefixed?.inputSchema);
  });
});
