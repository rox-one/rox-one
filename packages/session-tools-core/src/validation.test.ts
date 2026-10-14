import { describe, expect, it } from 'bun:test';
import matter from 'gray-matter';
import { normalizeMermaidSource, validateMermaidSyntax, validateSkillContent } from './validation.ts';

describe('validateSkillContent gray-matter cache', () => {
  it('parses frontmatter without retaining the content in matter.cache', () => {
    const matterCache = (matter as unknown as { cache: Record<string, unknown> }).cache;
    const content = '---\nname: Cache Probe Tools\ndescription: Skill parsed by session tools\n---\n\nTools validator body.\n';
    const keysBefore = Object.keys(matterCache).length;

    const result = validateSkillContent(content, 'cache-probe-tools');

    expect(result.errors).toEqual([]);
    expect(Object.keys(matterCache).length).toBe(keysBefore);
    expect(content in matterCache).toBe(false);
  });
});

describe('Mermaid validation helpers', () => {
  it('normalizes YAML frontmatter before diagram syntax', () => {
    expect(normalizeMermaidSource('---\ntitle: Demo\n---\ngraph LR\nA-->B')).toBe('graph LR\nA-->B');
  });

  it('accepts xychart-beta as a Mermaid diagram type', () => {
    expect(validateMermaidSyntax('xychart-beta\n  x-axis [Jan, Feb]\n  bar [10, 20]').valid).toBe(true);
  });

  it('accepts YAML frontmatter before a supported diagram type', () => {
    expect(validateMermaidSyntax('---\ntitle: Demo\n---\nsequenceDiagram\nA->>B: hello').valid).toBe(true);
  });

  it('still rejects unknown diagram types', () => {
    const result = validateMermaidSyntax('unknownDiagram\nA-->B');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('Unknown diagram type');
  });
});
