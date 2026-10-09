/**
 * `<available_skills>` prompt block: content, group order, source tiers and the
 * three bounds (entries, description length, bytes), plus its position in the
 * composed `--append-system-prompt` payload.
 */

import { describe, expect, it } from 'bun:test';
import { dirname, join } from 'node:path';
import {
  AVAILABLE_SKILLS_MAX_BYTES,
  AVAILABLE_SKILLS_MAX_ENTRIES,
  SKILLS_READ_HOST_TOOL,
  SKILLS_SEARCH_HOST_TOOL,
  buildAvailableSkillsBlock,
} from '../prompt.ts';
import { loadSkillFromDir } from '../storage.ts';
import { composeOmpAppendSystemPrompt } from '../../agent/omp-agent.ts';
import { getSessionToolProxyDefs } from '../../agent/backend/pi/session-tool-defs.ts';
import type { LoadedSkill, SkillSource } from '../types.ts';

/** The tool names OMP actually receives from set_host_tools. */
const REGISTERED_HOST_TOOLS = new Set(getSessionToolProxyDefs().map(def => def.name));

function skill(slug: string, source: SkillSource, description = `${slug} description`): LoadedSkill {
  return { slug, path: `/root/${slug}`, source, content: '', metadata: { name: `Name ${slug}`, description } };
}

describe('buildAvailableSkillsBlock', () => {
  it('advertises the exact host-tool names OMP registers', () => {
    expect(REGISTERED_HOST_TOOLS.has(SKILLS_SEARCH_HOST_TOOL)).toBe(true);
    expect(REGISTERED_HOST_TOOLS.has(SKILLS_READ_HOST_TOOL)).toBe(true);
  });

  it('returns null when there is nothing to advertise', () => {
    expect(buildAvailableSkillsBlock([])).toBeNull();
    expect(buildAvailableSkillsBlock([{ ...skill('shadowed', 'omp'), shadowedByCraft: true }])).toBeNull();
  });

  it('wraps entries in the block tags with the usage hint', () => {
    const block = buildAvailableSkillsBlock([skill('demo', 'workspace')]);
    expect(block).not.toBeNull();
    expect(block!.startsWith('<available_skills>')).toBe(true);
    expect(block!.endsWith('</available_skills>')).toBe(true);
    expect(block).toContain('`demo`');
    expect(block).toContain(`${SKILLS_READ_HOST_TOOL} slug="demo"`);
    expect(block).toContain(`\`${SKILLS_SEARCH_HOST_TOOL}\``);
    expect(block).toContain('demo description');
  });

  it('groups by source tier, most specific first', () => {
    const block = buildAvailableSkillsBlock([
      skill('g', 'global'),
      skill('p', 'project'),
      skill('w', 'workspace'),
      skill('o', 'omp'),
    ])!;
    const order = ['## Project skills', '## Workspace skills', '## Global skills', '## OMP skills']
      .map(heading => block.indexOf(heading));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('caps the entry count and signposts the omission', () => {
    const many = Array.from({ length: AVAILABLE_SKILLS_MAX_ENTRIES + 20 }, (_, i) => skill(`s-${i}`, 'workspace'));
    const block = buildAvailableSkillsBlock(many)!;
    const entries = block.split('\n').filter(line => line.startsWith('- `')).length;
    expect(entries).toBeLessThanOrEqual(AVAILABLE_SKILLS_MAX_ENTRIES);
    expect(block).toContain('more skill(s) omitted');
  });

  it('truncates over-long descriptions', () => {
    const block = buildAvailableSkillsBlock([
      skill('long', 'workspace', 'x'.repeat(1000)),
    ], { maxDescriptionChars: 50 })!;
    const line = block.split('\n').find(entry => entry.startsWith('- `long`'))!;
    expect(line.length).toBeLessThan(200);
    expect(line).toContain('…');
  });

  it('honours the byte cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => skill(`byte-${i}`, 'workspace'));
    // Cap sits above the (now mcp__session__-prefixed) header so at least one entry fits.
    const block = buildAvailableSkillsBlock(many, { maxBytes: 500 })!;
    expect(Buffer.byteLength(block, 'utf8')).toBeLessThan(600);
    expect(block).toContain('more skill(s) omitted');
  });
});

describe('composeOmpAppendSystemPrompt placement', () => {
  it('places the skills block after the project block and before memory', () => {
    const skillsBlock = '<available_skills>\n- `demo`\n</available_skills>';
    const payload = composeOmpAppendSystemPrompt({
      workingDirectory: process.cwd(),
      projectContextBlock: '<project>project-block</project>',
      skillsBlock,
      memoryBlocks: { memoryBlock: '<memory>memory-block</memory>' },
    });
    const skillsIndex = payload.indexOf('<available_skills>');
    expect(skillsIndex).toBeGreaterThan(payload.indexOf('<project>'));
    expect(skillsIndex).toBeLessThan(payload.indexOf('<memory>'));
  });

  it('omits the block when none is provided', () => {
    const payload = composeOmpAppendSystemPrompt({ workingDirectory: process.cwd() });
    expect(payload).not.toContain('<available_skills>');
  });
});

describe('composeOmpAppendSystemPrompt memory blocks', () => {
  it('includes the curated bootstrap block before lessons and memory', () => {
    const payload = composeOmpAppendSystemPrompt({
      workingDirectory: process.cwd(),
      memoryBlocks: {
        bootstrapBlock: '[Curated memory]\n## projects/demo/MEMORY.md\nDeploy previews go through vercel.',
        lessonsBlock: '[Learned corrections]',
        memoryBlock: '<memory>memory-block</memory>',
      },
    });
    expect(payload).toContain('[Curated memory]');
    expect(payload).toContain('Deploy previews go through vercel.');
    expect(payload.indexOf('[Curated memory]')).toBeLessThan(payload.indexOf('[Learned corrections]'));
    expect(payload.indexOf('[Learned corrections]')).toBeLessThan(payload.indexOf('<memory>'));
  });

  it('omits the curated block when absent', () => {
    const payload = composeOmpAppendSystemPrompt({
      workingDirectory: process.cwd(),
      memoryBlocks: { lessonsBlock: '[Learned corrections]' },
    });
    expect(payload).not.toContain('[Curated memory]');
  });
});

describe('buildAvailableSkillsBlock always-on promotion', () => {
  const REPO_ROOT = join(dirname(import.meta.dir), '..', '..', '..', '..');
  const CUSTODIAN_SKILLS_DIR = join(REPO_ROOT, 'apps', 'electron', 'resources', 'skills', 'rox-custodian');
  const CUSTODIAN_SLUGS = ['add-model-provider', 'configure-channel', 'diagnose-gateway'] as const;

  /** A catalog far past the entry cap, so earlier groups would evict anything later. */
  function flood(): LoadedSkill[] {
    return Array.from({ length: AVAILABLE_SKILLS_MAX_ENTRIES + 40 }, (_, i) => skill(`flood-${i}`, 'workspace'));
  }

  /** The pinned skill sits in the LAST group, exactly where the cap would drop it. */
  function pinned(): LoadedSkill {
    return { ...skill('pinned', 'omp'), metadata: { name: 'Pinned', description: 'pinned description', always: true } };
  }

  function entryLines(block: string): string[] {
    return block.split('\n').filter(line => line.startsWith('- `'));
  }

  it('emits an always-flagged skill first even when the cap would otherwise drop it', () => {
    const block = buildAvailableSkillsBlock([...flood(), pinned()])!;
    expect(block).toContain('`pinned`');
    expect(entryLines(block).length).toBeLessThanOrEqual(AVAILABLE_SKILLS_MAX_ENTRIES);
    expect(Buffer.byteLength(block, 'utf8')).toBeLessThanOrEqual(AVAILABLE_SKILLS_MAX_BYTES);
    // Promoted ahead of the flooded tier, not merely present somewhere.
    expect(entryLines(block)[0]).toContain('`pinned`');
  });

  it('advertises the real custodian playbooks under cap pressure', () => {
    const custodian = CUSTODIAN_SLUGS
      .map(slug => loadSkillFromDir(CUSTODIAN_SKILLS_DIR, slug, 'global'))
      .filter((loaded): loaded is LoadedSkill => loaded !== null);
    expect(custodian).toHaveLength(CUSTODIAN_SLUGS.length);
    expect(custodian.every(loaded => loaded.metadata.always === true)).toBe(true);

    const block = buildAvailableSkillsBlock([...flood(), ...custodian])!;
    expect(entryLines(block).length).toBeLessThanOrEqual(AVAILABLE_SKILLS_MAX_ENTRIES);
    expect(Buffer.byteLength(block, 'utf8')).toBeLessThanOrEqual(AVAILABLE_SKILLS_MAX_BYTES);
    for (const slug of CUSTODIAN_SLUGS) {
      expect(block).toContain(`\`${slug}\``);
    }
  });

  it('renders byte-identical output across runs', () => {
    const first = buildAvailableSkillsBlock([...flood(), pinned()]);
    const second = buildAvailableSkillsBlock([...flood(), pinned()]);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
  });

  it('leaves the tier grouping untouched when nothing is always-on', () => {
    const block = buildAvailableSkillsBlock(flood())!;
    expect(block).not.toContain('## Always-on skills');
    expect(block).toContain('## Workspace skills');
  });
});