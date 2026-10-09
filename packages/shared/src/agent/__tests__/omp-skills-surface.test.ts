/**
 * The eligible-skills catalog reaches the real OMP spawn payload: the
 * `<available_skills>` block appears inside the actual `--append-system-prompt`
 * argument, and native discovery is disabled so the two surfaces cannot diverge.
 *
 * The agent-loop mention resolution scans the merged OMP catalog, so the fixture
 * warms that cache once (the same key the agent uses) to keep the spawn itself
 * free of a cold filesystem walk.
 */

import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAllSkills } from '../../skills/storage.ts';
import { OmpAgent } from '../omp-agent.ts';
import { chatEvents, createFakeOmp, makeOmpConfig, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

/** Pull the `--append-system-prompt` value out of a recorded spawn argv. */
function appendSystemPromptFrom(argvLog: string[][]): string {
  for (const args of argvLog) {
    const index = args.indexOf('--append-system-prompt');
    if (index !== -1 && index + 1 < args.length) return args[index + 1]!;
  }
  throw new Error('no --append-system-prompt found in recorded spawn argv');
}

/** Spawn one agent and return the argv + payload of THAT launch. */
async function runAgent(fake: FakeOmp, allowedSkillSlugs: string[]): Promise<{ args: string[]; payload: string }> {
  const before = fake.readArgvLog().length;
  const agent = new OmpAgent(makeOmpConfig(fake, { allowedSkillSlugs }));
  try {
    const events = await chatEvents(agent, 'Fixture work', 60000);
    expect(events.some(event => event.type === 'complete')).toBe(true);
  } finally {
    agent.dispose();
  }
  const added = fake.readArgvLog().slice(before);
  const args = added.find(entry => entry.includes('--mode'))!;
  return { args, payload: appendSystemPromptFrom(added) };
}

test(
  'the eligible skills catalog reaches the real --append-system-prompt payload',
  async () => {
    const fake = createFakeOmp('healthy');
    const restore = useFakeOmpEnv(fake);
    try {
      const skillDir = join(fake.workspaceRoot, 'skills', 'demo-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        '---\nname: Demo Skill\ndescription: Demonstrates the skills surface\n---\nDo demo work.',
      );
      // Warm the exact (workspaceRoot, projectRoot, options) key the agent uses.
      loadAllSkills(fake.workspaceRoot, undefined, { includeOmp: true });

      // Scenario 1: the operator allowlist admits the fixture skill.
      const admitted = await runAgent(fake, ['demo-skill']);
      expect(admitted.payload).toContain('<available_skills>');
      expect(admitted.payload).toContain('`demo-skill`');
      expect(admitted.payload).toContain('skills_read slug="demo-skill"');
      expect(admitted.payload).toContain('</available_skills>');
      expect(admitted.args).toContain('--no-skills');

      // Scenario 2: an empty allowlist advertises nothing even though the skill exists.
      const denied = await runAgent(fake, []);
      expect(denied.payload).not.toContain('<available_skills>');
      expect(denied.args).toContain('--no-skills');
    } finally {
      restore();
      await fake.cleanup();
    }
  },
  180000,
);