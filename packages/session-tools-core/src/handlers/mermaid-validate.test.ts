import { describe, expect, it } from 'bun:test';
import { handleMermaidValidate } from './mermaid-validate.ts';

function parseResult(result: Awaited<ReturnType<typeof handleMermaidValidate>>) {
  return JSON.parse(result.content[0]!.text) as { valid: boolean; message?: string; error?: string };
}

describe('handleMermaidValidate', () => {
  it('accepts xychart-beta diagrams supported by the renderer', async () => {
    const result = await handleMermaidValidate({} as any, {
      code: [
        'xychart-beta',
        '  title "Monthly Revenue"',
        '  x-axis [Jan, Feb, Mar]',
        '  y-axis "Revenue" 0 --> 100',
        '  bar [25, 45, 80]',
        '  line [20, 50, 70]',
      ].join('\n'),
    });

    expect(result.isError).toBeUndefined();
    expect(parseResult(result).valid).toBe(true);
  });

  it('accepts YAML frontmatter before the diagram', async () => {
    const result = await handleMermaidValidate({} as any, {
      code: [
        '---',
        'title: Frontmatter Example',
        '---',
        'graph LR',
        '  A --> B',
      ].join('\n'),
    });

    expect(result.isError).toBeUndefined();
    expect(parseResult(result).valid).toBe(true);
  });

  it('returns an error for invalid diagrams', async () => {
    const result = await handleMermaidValidate({} as any, {
      code: 'notADiagram\n  A --> B',
    });

    expect(result.isError).toBe(true);
    expect(parseResult(result).valid).toBe(false);
  });
});

describe('handleMermaidValidate docs hint (W1-13)', () => {
  const invalid = { code: 'notADiagram\n  A --> B' };
  const suggestion = async (ctx: object) =>
    (JSON.parse((await handleMermaidValidate(ctx as any, invalid)).content[0]!.text) as { suggestion?: string })
      .suggestion;

  it('keeps the legacy hint without a Rox home from the backend (flag OFF)', async () => {
    expect(await suggestion({})).toBe('Check the syntax against ~/.rox/docs/mermaid.md');
  });

  it('uses the Rox home the backend reports', async () => {
    expect(await suggestion({ roxHomeDisplay: '~/rox' })).toBe('Check the syntax against ~/rox/docs/mermaid.md');
  });
});
