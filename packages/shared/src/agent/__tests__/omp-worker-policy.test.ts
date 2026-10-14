import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { OMP_WORKER_POLICY_SOURCE } from '../omp-worker-policy.ts';
import { prepareOmpRoxRuntimeConfig } from '../omp-first-run.ts';
import { OMP_TASK_TOOL_NAME } from '../../utils/toolNames.ts';

describe('mandatory native worker policy', () => {
  it('does not force max thinking or prefix user/task text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-worker-policy-'));
    try {
      const path = join(dir, 'policy.js');
      writeFileSync(path, OMP_WORKER_POLICY_SOURCE);
      const factory = (await import(path)).default;
      expect(OMP_WORKER_POLICY_SOURCE).not.toContain('orchestrate workflowz ultrathink');
      expect(OMP_WORKER_POLICY_SOURCE).not.toContain("setThinkingLevel('max')");
      expect(OMP_WORKER_POLICY_SOURCE).not.toContain('setThinkingLevel("max")');
      for (const name of ['main', 'task', 'eval', 'scout']) {
        let thinking = name === 'scout' ? 'medium' : 'low';
        const tools = Object.freeze(name === 'scout' ? ['read', 'grep'] : ['read', OMP_TASK_TOOL_NAME, 'eval']);
        const handlers = new Map<string, Function>();
        factory({ on: (event: string, handler: Function) => handlers.set(event, handler), setThinkingLevel: (level: string) => { thinking = level; } });
        const restrictions = { agent: 'scout', tools: ['read'], effort: 'lo', task: 'review only' };
        const taskCall = handlers.get('tool_call')!({ toolName: OMP_TASK_TOOL_NAME, input: restrictions });
        expect(taskCall).toBeUndefined();
        expect(restrictions.task).toBe('review only');
        expect(handlers.get('tool_call')!({ toolName: 'eval', input: { code: 'literal code' } })).toBeUndefined();
        expect(thinking).toBe(name === 'scout' ? 'medium' : 'low');
        expect(tools).toEqual(name === 'scout' ? ['read', 'grep'] : ['read', OMP_TASK_TOOL_NAME, 'eval']);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('installs an explicit inherited extension and keeps the native task effort ceiling', () => {
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
      expect(policy.providers?.autoThinkingMaxEffort).not.toBe('max');
      runtime.dispose();
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
