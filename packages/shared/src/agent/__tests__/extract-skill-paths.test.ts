/**
 * Mention resolution parity: extractSkillPaths resolves only the mentioned
 * slugs, with the same output the full-catalog implementation produced, and a
 * message without `[skill:` never reaches the catalog.
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseAgent, type SkillMentionCatalog } from '../base-agent.ts';
import { OmpAgent } from '../omp-agent.ts';
import {
  APP_MANAGED_SKILLS_DIR,
  GLOBAL_AGENT_SKILLS_DIR,
  invalidateSkillsCache,
  resolveSkillsBySlugs,
  type LoadAllSkillsOptions,
} from '../../skills/storage.ts';
import { invalidateOmpSkillsCache, OMP_GLOBAL_SKILLS_DIR } from '../../skills/omp-discovery.ts';

interface Extracted { skillPaths: Map<string, string>; cleanMessage: string; missingSkills: string[] }
type ExtractFn = (message: string, catalog?: SkillMentionCatalog) => Extracted;
const extract = (BaseAgent.prototype as unknown as { extractSkillPaths: ExtractFn }).extractSkillPaths;
const baseOptions = (BaseAgent.prototype as unknown as { getSkillLoadOptions(): LoadAllSkillsOptions }).getSkillLoadOptions();
const ompOptions = (OmpAgent.prototype as unknown as { getSkillLoadOptions(): LoadAllSkillsOptions }).getSkillLoadOptions();

const workspace = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'extract-skill-paths-')));
const appAlpha = join(APP_MANAGED_SKILLS_DIR, 'n2-alpha');

function put(dir: string, name: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\nbody`);
}

put(join(workspace, 'skills', 'n2-alpha'), 'Alpha Skill');
put(join(workspace, 'skills', 'n2-beta'), 'Beta Skill');
put(join(workspace, '.omp', 'skills', 'n2-omp'), 'Omp Skill');
// Same slug as a workspace skill: the catalog exposes the application copy as `rox--n2-alpha`.
put(appAlpha, 'App Alpha');

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(appAlpha, { recursive: true, force: true });
});
beforeEach(() => { invalidateSkillsCache(); invalidateOmpSkillsCache(); });

function run(message: string, opts: { allowed?: string[]; options?: LoadAllSkillsOptions; catalog?: SkillMentionCatalog } = {}): Extracted {
  const agent = {
    config: { workspace: { rootPath: workspace }, allowedSkillSlugs: opts.allowed },
    workingDirectory: workspace,
    getSkillLoadOptions: () => opts.options ?? baseOptions,
    debug() {},
  };
  return extract.call(agent, message, opts.catalog);
}

function countingCatalog() {
  const calls: string[][] = [];
  const catalog: SkillMentionCatalog = {
    resolveSkillsBySlugs: (root, slugs, project, options) => { calls.push([...slugs]); return resolveSkillsBySlugs(root, slugs, project, options); },
  };
  return { calls, catalog };
}

const skillMd = (...parts: string[]) => join(...parts, 'SKILL.md');

describe('extractSkillPaths', () => {
  test('a message without [skill: performs no catalog access', () => {
    const { calls, catalog } = countingCatalog();
    expect(run('fix [source:github] and [file:src/a.ts] now', { catalog })).toEqual({
      skillPaths: new Map(),
      cleanMessage: `fix [Mentioned source: github] and [Mentioned file: a.ts (at ${workspace}/src/a.ts)] now`,
      missingSkills: [],
    });
    expect(calls).toEqual([]);

    const readdir = spyOn(fs, 'readdirSync');
    const open = spyOn(fs, 'openSync');
    try {
      expect(run('nothing to resolve here').cleanMessage).toBe('nothing to resolve here');
      expect(readdir).toHaveBeenCalledTimes(0);
      expect(open).toHaveBeenCalledTimes(0);
    } finally { readdir.mockRestore(); open.mockRestore(); }
  });

  test('a valid mention resolves only the mentioned slugs', () => {
    const { calls, catalog } = countingCatalog();
    const skillRoots = [join(workspace, 'skills'), join(workspace, '.omp', 'skills'), GLOBAL_AGENT_SKILLS_DIR, OMP_GLOBAL_SKILLS_DIR, APP_MANAGED_SKILLS_DIR];
    const readdir = spyOn(fs, 'readdirSync');
    let result: Extracted;
    try {
      result = run('review [skill:n2-alpha] and [skill:My Workspace:n2-beta] please [skill:n2-alpha]', { catalog });
      expect(readdir.mock.calls.map(([dir]) => String(dir)).filter(dir => skillRoots.includes(dir))).toEqual([]);
    } finally { readdir.mockRestore(); }
    expect(calls).toEqual([['n2-alpha', 'n2-beta']]);
    expect(result).toEqual({
      skillPaths: new Map([
        ['n2-alpha', skillMd(workspace, 'skills', 'n2-alpha')],
        ['n2-beta', skillMd(workspace, 'skills', 'n2-beta')],
      ]),
      cleanMessage: 'review [Mentioned skill: Alpha Skill (slug: n2-alpha)] and [Mentioned skill: Beta Skill (slug: n2-beta)] please [Mentioned skill: Alpha Skill (slug: n2-alpha)]',
      missingSkills: [],
    });
  });

  test('an unknown slug is reported missing and keeps its slug as the name', () => {
    expect(run('[skill:n2-missing] go')).toEqual({
      skillPaths: new Map(),
      cleanMessage: '[Mentioned skill: n2-missing (slug: n2-missing)] go',
      missingSkills: ['n2-missing'],
    });
  });

  test('a slug outside allowedSkillSlugs is missing', () => {
    expect(run('[skill:n2-alpha] [skill:n2-beta]', { allowed: ['n2-beta'] })).toEqual({
      skillPaths: new Map([['n2-beta', skillMd(workspace, 'skills', 'n2-beta')]]),
      cleanMessage: '[Mentioned skill: n2-alpha (slug: n2-alpha)] [Mentioned skill: Beta Skill (slug: n2-beta)]',
      missingSkills: ['n2-alpha'],
    });
  });

  test('an OMP skill resolves only with the OMP agent load options', () => {
    expect(ompOptions).toEqual({ includeOmp: true });
    expect(run('[skill:n2-omp] run', { options: ompOptions })).toEqual({
      skillPaths: new Map([['n2-omp', skillMd(workspace, '.omp', 'skills', 'n2-omp')]]),
      cleanMessage: '[Mentioned skill: Omp Skill (slug: n2-omp)] run',
      missingSkills: [],
    });
    expect(run('[skill:n2-omp] run')).toEqual({
      skillPaths: new Map(),
      cleanMessage: '[Mentioned skill: n2-omp (slug: n2-omp)] run',
      missingSkills: ['n2-omp'],
    });
  });

  test('a collision alias resolves the application copy', () => {
    expect(run('[skill:rox--n2-alpha] [skill:n2-alpha]')).toEqual({
      skillPaths: new Map([
        ['rox--n2-alpha', skillMd(APP_MANAGED_SKILLS_DIR, 'n2-alpha')],
        ['n2-alpha', skillMd(workspace, 'skills', 'n2-alpha')],
      ]),
      cleanMessage: '[Mentioned skill: App Alpha (slug: rox--n2-alpha)] [Mentioned skill: Alpha Skill (slug: n2-alpha)]',
      missingSkills: [],
    });
  });
});
