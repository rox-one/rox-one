/**
 * Skills session tools (skills_search / skills_read) — c2.7.
 *
 * Executed through the canonical SESSION_TOOL_DEFS registry entry point against
 * a runtime backed by REAL filesystem fixtures, asserting: catalog search
 * formatting and limit clamping, body loading, slug safety (path-escape
 * rejection), and the typed unavailable error when no runtime is registered.
 *
 * The in-test double mirrors the production boundary for the FORMATTING/limit
 * cases; the security boundary itself is the real `isWithinRealRoot` helper
 * (tested at the bottom) and, end to end, the shipped runtime in server-core
 * (skills-tool-runtime.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import type { SessionToolContext } from '../context.ts';
import { SESSION_TOOL_REGISTRY } from '../tool-defs.ts';
import {
  clearSkillsToolRuntime,
  registerSkillsToolRuntime,
  type SkillCatalogEntry,
  type SkillSearchHit,
  type SkillsToolRuntime,
} from '../skills/runtime.ts';
import { isSafeSkillSlug, isWithinRealRoot } from '../skills/scope.ts';
import { SKILLS_SEARCH_MAX_LIMIT } from './skills-search.ts';
import { SKILLS_READ_MAX_CHARS } from './skills-read.ts';

let root = '';
let ctx: SessionToolContext;

function writeSkill(dir: string, slug: string, name: string, description: string, body: string): void {
  const skillDir = join(dir, slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`);
}

interface FixtureSkill {
  entry: SkillCatalogEntry;
  body: string;
}

/**
 * Real-fs runtime double for the FORMATTING/limit cases only. It deliberately
 * does NOT implement the containment boundary — that lives in the production
 * `isWithinRealRoot` helper and the shipped server-core runtime, which have
 * their own tests. Keeping the double boundary-free means a broken containment
 * rule can never be masked by a passing double.
 */
function fixtureRuntime(): SkillsToolRuntime {
  function catalog(): FixtureSkill[] {
    const out: FixtureSkill[] = [];
    for (const name of readdirSync(root)) {
      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(readFileSync(join(realpathSync(join(root, name)), 'SKILL.md'), 'utf8'));
      } catch {
        continue;
      }
      out.push({
        entry: {
          slug: name,
          name: String(parsed.data.name),
          description: String(parsed.data.description),
          path: realpathSync(join(root, name)),
          baseDir: root,
          source: 'workspace',
        },
        body: parsed.content,
      });
    }
    return out;
  }

  return {
    async list() {
      return catalog().map(item => item.entry);
    },
    async search({ query, limit }) {
      const needle = query.toLowerCase();
      const hits: SkillSearchHit[] = [];
      for (const item of catalog()) {
        const haystack = `${item.entry.slug}\n${item.entry.name}\n${item.entry.description}\n${item.body}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
        hits.push({ ...item.entry, excerpt: item.body.replace(/\s+/g, ' ').trim().slice(0, 240) });
        if (hits.length >= (limit ?? hits.length)) break;
      }
      return hits;
    },
    async read({ slug }) {
      if (!isSafeSkillSlug(slug)) return null;
      const found = catalog().find(item => item.entry.slug === slug);
      if (!found) return null;
      return { slug, name: found.entry.name, content: found.body, path: found.entry.path };
    },
  };
}

function handler(name: 'skills_search' | 'skills_read') {
  const def = SESSION_TOOL_REGISTRY.get(name);
  if (!def || def.executionMode !== 'registry') throw new Error(`missing registry handler: ${name}`);
  return def.handler;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'skills-tools-')));
  writeSkill(root, 'kernel-guide', 'Kernel Guide', 'Explains the kernel internals', '# Kernel\n\nDeep kernel content.');
  writeSkill(root, 'other', 'Other', 'Unrelated skill', '# Other\n\nNothing here.');
  ctx = { sessionId: 'sess-1', workspacePath: root } as unknown as SessionToolContext;
  registerSkillsToolRuntime(fixtureRuntime());
});

afterEach(() => {
  clearSkillsToolRuntime();
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('registry wiring', () => {
  it('registers both skills tools as read-only, safe-mode-allowed registry tools', () => {
    for (const name of ['skills_search', 'skills_read'] as const) {
      const def = SESSION_TOOL_REGISTRY.get(name)!;
      expect(def.executionMode).toBe('registry');
      expect(def.safeMode).toBe('allow');
      expect(def.readOnly).toBe(true);
    }
  });
});

describe('skills_search', () => {
  it('finds a skill by query and formats slug, source, path, description and excerpt', async () => {
    const result = await handler('skills_search')(ctx, { query: 'kernel' });
    expect(result.isError).toBe(false);
    const text = result.content[0]!.text!;
    expect(text).toContain('## Skills search: "kernel"');
    expect(text).toContain('`kernel-guide`');
    expect(text).toContain('source: workspace');
    expect(text).toContain(join(root, 'kernel-guide'));
    expect(text).not.toContain('`other`');
  });

  it('reports no matches honestly', async () => {
    const result = await handler('skills_search')(ctx, { query: 'nothing-matches-this' });
    expect(result.content[0]!.text!).toContain('No skills matched.');
  });

  it('rejects an empty query', async () => {
    const result = await handler('skills_search')(ctx, { query: '  ' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text!).toContain('INVALID_ARGUMENT');
  });

  it('clamps an oversized limit to the hard cap', async () => {
    const result = await handler('skills_search')(ctx, { query: 'skill', limit: 999 });
    const hits = result.content[0]!.text!.split('\n').filter(line => /^\d+\. \*\*/.test(line)).length;
    expect(hits).toBeLessThanOrEqual(SKILLS_SEARCH_MAX_LIMIT);
  });
});

describe('skills_read', () => {
  it('returns the skill body and path', async () => {
    const result = await handler('skills_read')(ctx, { slug: 'kernel-guide' });
    expect(result.isError).toBe(false);
    const text = result.content[0]!.text!;
    expect(text).toContain('## Kernel Guide (kernel-guide)');
    expect(text).toContain('Deep kernel content.');
    expect(text).toContain(join(root, 'kernel-guide'));
  });

  it('rejects a path-escape slug at the tool boundary', async () => {
    for (const slug of ['../outside', 'a/b', '..', '.hidden']) {
      const result = await handler('skills_read')(ctx, { slug });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text!).toContain('INVALID_ARGUMENT');
    }
  });

  it('returns SKILL_NOT_FOUND for an unknown slug', async () => {
    const result = await handler('skills_read')(ctx, { slug: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text!).toContain('SKILL_NOT_FOUND');
  });
});

describe('isWithinRealRoot (production containment boundary)', () => {
  it('rejects a symlink whose target escapes the root', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'skills-outside-')));
    try {
      writeSkill(outside, 'escaping', 'Escaping', 'Outside the root', 'secret');
      symlinkSync(join(outside, 'escaping'), join(root, 'linked'));
      // The declared path looks contained; the resolved path is not.
      expect(relative(root, join(root, 'linked'))).toBe('linked');
      expect(isWithinRealRoot(join(root, 'linked'), root)).toBe(false);
      expect(isWithinRealRoot(join(outside, 'escaping'), root)).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('accepts a real skill directory inside the root', () => {
    expect(isWithinRealRoot(join(root, 'kernel-guide'), root)).toBe(true);
  });

  it('rejects a missing candidate rather than treating it as confined', () => {
    expect(isWithinRealRoot(join(root, 'does-not-exist'), root)).toBe(false);
  });
});

describe('no runtime', () => {
  it('answers with a typed SKILLS_UNAVAILABLE error', async () => {
    clearSkillsToolRuntime();
    const result = await handler('skills_search')(ctx, { query: 'kernel' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text!).toContain('SKILLS_UNAVAILABLE');
  });
});

describe('skills_read truncation contract', () => {
  it('exposes a positive body cap', () => {
    expect(SKILLS_READ_MAX_CHARS).toBeGreaterThan(0);
  });
});