import { describe, expect, it } from 'bun:test';
import { composeOmpAppendSystemPrompt } from '../../agent/omp-agent.ts';
import { MCP_USAGE_GUIDANCE } from '../mcp-guidance.ts';

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
});
