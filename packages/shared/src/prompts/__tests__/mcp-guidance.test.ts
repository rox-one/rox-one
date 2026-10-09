import { afterEach, describe, expect, it } from 'bun:test';
import { composeOmpAppendSystemPrompt } from '../../agent/omp-agent.ts';
import {
  getCognitiveProfileBlock,
  resetCognitiveProfileProvider,
  setCognitiveProfileProvider,
} from '../../agent/cognitive-profile.ts';
import { MCP_USAGE_GUIDANCE } from '../mcp-guidance.ts';

afterEach(() => {
  resetCognitiveProfileProvider();
});

describe('MCP guidance in the default OMP backend', () => {
  it('includes the shared retrieval and memory policy in the spawn briefing', () => {
    const prompt = composeOmpAppendSystemPrompt({ workingDirectory: '/nonexistent/mcp-guidance-fixture' });

    expect(prompt).toContain(MCP_USAGE_GUIDANCE);
    for (const name of ['QMD:', 'Weaviate:', 'Qdrant:', 'Mem0:']) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toContain('Check the current source state and live tool definitions');
    expect(prompt).toContain('retain durable information when the user requests it or an authorized memory workflow calls for it');
    expect(prompt).toContain('write to multiple stores only when the user requests it or the configured workflow requires it');
    expect(prompt).not.toMatch(/mcp__(?:qmd|weaviate|qdrant|mem0)__/);
  });

  it('appends the cognitive profile block last, after every trusted block', () => {
    const block = '<user_cognitive_profile>\nprefers terse answers\n</user_cognitive_profile>';
    setCognitiveProfileProvider(() => block);
    // Mirrors production: buildCraftContextPrompt resolves the sanitized block
    // from the registry and passes it into the composer.
    const profile = getCognitiveProfileBlock();
    expect(profile).not.toBeNull();

    const prompt = composeOmpAppendSystemPrompt({
      workingDirectory: '/nonexistent/mcp-guidance-fixture',
      cognitiveProfileBlock: profile,
    });
    expect(prompt.endsWith(profile!)).toBe(true);
  });

  it('leaves the composed prompt byte-identical when no profile is present', () => {
    const absent = composeOmpAppendSystemPrompt({ workingDirectory: '/nonexistent/mcp-guidance-fixture' });
    const explicitNull = composeOmpAppendSystemPrompt({
      workingDirectory: '/nonexistent/mcp-guidance-fixture',
      cognitiveProfileBlock: null,
    });
    expect(explicitNull).toBe(absent);
    expect(absent).not.toContain('<user_cognitive_profile>');
  });
});