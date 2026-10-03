import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { OMP_WORKER_POLICY_SOURCE } from '../omp-worker-policy.ts';
import { prepareOmpRoxRuntimeConfig } from '../omp-first-run.ts';

describe('mandatory native worker policy', () => {
  it('binds independently for main, task, eval and restricted scout without changing tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-worker-policy-'));
    try {
      const path = join(dir, 'policy.js');
      writeFileSync(path, OMP_WORKER_POLICY_SOURCE);
      const factory = (await import(path)).default;
      for (const name of ['main', 'task', 'eval', 'scout']) {
        let thinking = name === 'scout' ? 'medium' : 'low';
        const tools = Object.freeze(name === 'scout' ? ['read', 'grep'] : ['read', 'task', 'eval']);
        const handlers = new Map<string, Function>();
        // An API without tool mutation methods detects accidental capability grants.
        factory({ on: (event: string, handler: Function) => handlers.set(event, handler), setThinkingLevel: (level: string) => { thinking = level; } });
        const restrictions = { agent: 'scout', tools: ['read'], effort: 'lo', task: 'review only' };
        const taskCall = handlers.get('tool_call')!({ toolName: 'task', input: restrictions });
        expect(taskCall.input).toEqual({ ...restrictions, task: 'orchestrate workflowz ultrathink\n\nreview only' });
        expect(restrictions.task).toBe('review only');
        expect(handlers.get('tool_call')!({ toolName: 'eval', input: { code: 'literal code' } })).toBeUndefined();
        const batch = handlers.get('tool_call')!({ toolName: 'task', input: { context: 'shared', tasks: [restrictions] } });
        expect(batch.input.context).toBe('shared');
        expect(batch.input.tasks[0]).toEqual(taskCall.input);
        const before = handlers.get('before_agent_start')!({ systemPrompt: ['specialist restrictions'] });
        expect(thinking).toBe('max');
        expect(before.systemPrompt[0]).toBe('specialist restrictions');
        expect(before.systemPrompt.at(-1)).toStartWith('orchestrate workflowz ultrathink\n');
        expect(handlers.get('before_agent_start')!({ systemPrompt: before.systemPrompt }).systemPrompt).toEqual(before.systemPrompt);
        const image = { type: 'image', data: 'fixture', mimeType: 'image/png' };
        const original = { role: 'user', content: [{ type: 'text', text: '> orchestrate workflowz ultrathink' }, image] };
        thinking = 'low'; // Retry/model change cannot weaken a later continuation.
        const context = handlers.get('context')!({ messages: [original, { role: 'toolResult', content: 'original result' }] });
        expect(thinking).toBe('max');
        expect(context.messages[0].content[0].text).toBe('orchestrate workflowz ultrathink\n\n> orchestrate workflowz ultrathink');
        expect(context.messages[0].content[1]).toBe(image);
        expect(original.content[0]).toEqual({ type: 'text', text: '> orchestrate workflowz ultrathink' });
        expect(handlers.get('context')!({ messages: context.messages }).messages).toEqual(context.messages);
        expect(tools).toEqual(name === 'scout' ? ['read', 'grep'] : ['read', 'task', 'eval']);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('installs an explicit inherited extension and removes the native task effort ceiling', () => {
    const home = mkdtempSync(join(tmpdir(), 'rox-worker-profile-'));
    try {
      const runtime = prepareOmpRoxRuntimeConfig({ runtimeRoot: join(home, 'runtime'), homeDir: home });
      const config = parseYaml(readFileSync(join(runtime.agentDir, 'config.yml'), 'utf8'));
      const policy = parseYaml(readFileSync(join(runtime.agentDir, 'rox-runtime-policy.yml'), 'utf8'));
      expect(config.task.maxEffort).toBe('max');
      expect(policy.task.maxEffort).toBe('max');
      expect(policy.extensions).toEqual(config.extensions);
      expect(readFileSync(config.extensions.at(-1), 'utf8')).toBe(OMP_WORKER_POLICY_SOURCE);
      expect(OMP_WORKER_POLICY_SOURCE).not.toContain('setActiveTools');
      expect(OMP_WORKER_POLICY_SOURCE).not.toContain('registerTool');
      runtime.dispose();
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
