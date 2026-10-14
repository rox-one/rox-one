/**
 * Catalog walks over the real home roots: `~/.agents/skills` (foreign global
 * tier AND OMP shared root) and `~/.omp/agent/skills`. HOME is private per
 * suite under scripts/test-all.ts; fixture slugs are unique and removed after,
 * so an unisolated run leaves the caller's catalogs as they were.
 */
import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import {
  APP_MANAGED_SKILLS_DIR,
  GLOBAL_AGENT_SKILLS_DIR,
  invalidateSkillsCache,
  loadAllSkills,
  loadSkillBySlug,
  loadSkillDetails,
  resolveSkillsBySlugs,
} from '../storage.ts';
import { invalidateOmpSkillsCache, listOmpSkills, OMP_GLOBAL_SKILLS_DIR } from '../omp-discovery.ts';

const id = crypto.randomUUID().slice(0, 8);
const shared = `n2-shared-${id}`;
const ompOnly = `n2-omp-only-${id}`;
const loose = `n2-loose-${id}`;
const workspaceWins = `n2-ws-${id}`;
const shadow = `n2-shadow-${id}`;
const unknown = `n2-unknown-${id}`;

const createdRoots = [GLOBAL_AGENT_SKILLS_DIR, OMP_GLOBAL_SKILLS_DIR].filter(root => !fs.existsSync(root));
const workspace = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'catalog-head-')));
const fixtureDirs: string[] = [];

function put(root: string, slug: string, content: string) {
  const dir = join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'SKILL.md'), content);
  fixtureDirs.push(dir);
}

put(GLOBAL_AGENT_SKILLS_DIR, shared, '---\nname: Shared Craft\ndescription: From agents\n---\nShared body');
put(OMP_GLOBAL_SKILLS_DIR, shared, '---\nname: OMP Copy\ndescription: From omp\n---\nOMP body');
put(OMP_GLOBAL_SKILLS_DIR, ompOnly, '---\nname: OMP Only\ndescription: Only in omp\n---\nomp only body');
put(GLOBAL_AGENT_SKILLS_DIR, loose, '---\nname: Loose\n---\nloose body');
put(join(workspace, 'skills'), workspaceWins, '---\nname: Workspace Wins\ndescription: ws\n---\nws body');
put(GLOBAL_AGENT_SKILLS_DIR, workspaceWins, '---\nname: Global Loses\ndescription: g\n---\ng body');
put(OMP_GLOBAL_SKILLS_DIR, shadow, '---\nname: OMP Shadow\ndescription: loses\n---\nshadow body');
put(join(workspace, 'skills'), shadow, '---\nname: Craft Shadow\ndescription: wins\n---\ncraft body');

afterAll(() => {
  for (const dir of fixtureDirs) fs.rmSync(dir, { recursive: true, force: true });
  for (const root of createdRoots) fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => { invalidateSkillsCache(); invalidateOmpSkillsCache(); });

function readdirCallsDuring<T>(run: () => T): { result: T; dirs: string[] } {
  const readdir = spyOn(fs, 'readdirSync');
  try {
    const result = run();
    return { result, dirs: readdir.mock.calls.map(([dir]) => String(dir)) };
  } finally { readdir.mockRestore(); }
}

const grayMatterCacheSize = () => Object.keys((matter as unknown as { cache: Record<string, unknown> }).cache).length;

describe('catalog walk over ~/.agents/skills and the OMP global root', () => {
  test('panel path: one scan of the shared root, craft priority, no shadow of the same directory', () => {
    const { result: panel, dirs } = readdirCallsDuring(() => loadAllSkills(workspace, undefined, { includeOmp: true, includeShadowedOmp: true }));
    expect(dirs.filter(dir => dir === GLOBAL_AGENT_SKILLS_DIR)).toHaveLength(1);
    const bySlug = (slug: string) => panel.filter(skill => skill.slug === slug);

    expect(bySlug(shared)).toEqual([expect.objectContaining({
      source: 'global', path: join(GLOBAL_AGENT_SKILLS_DIR, shared), content: '', contentLength: 63,
      metadata: expect.objectContaining({ name: 'Shared Craft', description: 'From agents' }),
    })]);
    expect(bySlug(ompOnly)).toEqual([{
      slug: ompOnly, source: 'omp', path: join(OMP_GLOBAL_SKILLS_DIR, ompOnly), content: '',
      metadata: { name: 'OMP Only', description: 'Only in omp' },
    }]);
    expect(bySlug(loose)).toEqual([{
      slug: loose, source: 'omp', path: join(GLOBAL_AGENT_SKILLS_DIR, loose), content: '',
      metadata: { name: 'Loose', description: '' },
    }]);
    expect(bySlug(workspaceWins)).toEqual([expect.objectContaining({
      source: 'workspace', path: join(workspace, 'skills', workspaceWins), content: '', contentLength: 52,
      metadata: expect.objectContaining({ name: 'Workspace Wins' }),
    })]);
    expect(bySlug(shadow).map(skill => [skill.source, skill.path, skill.shadowedByCraft ?? false])).toEqual([
      ['workspace', join(workspace, 'skills', shadow), false],
      ['omp', join(OMP_GLOBAL_SKILLS_DIR, shadow), true],
    ]);
    for (const skill of panel) expect(skill.content).toBe('');
  });

  test('agent path keeps craft tiers only; single-skill reads still return bodies', async () => {
    const agent = loadAllSkills(workspace);
    expect(agent.filter(skill => [shared, ompOnly, loose, workspaceWins].includes(skill.slug)).map(skill => [skill.slug, skill.source]).sort())
      .toEqual([[shared, 'global'], [workspaceWins, 'workspace']].sort());

    expect(loadSkillBySlug(workspace, shared)).toMatchObject({ source: 'global', content: 'Shared body' });
    expect(loadSkillBySlug(workspace, workspaceWins)).toMatchObject({ source: 'workspace', content: 'ws body' });
    expect(await loadSkillDetails(workspace, ompOnly)).toMatchObject({ source: 'omp', content: 'omp only body' });
  });

  test('listOmpSkills keeps reporting the shared root over the OMP global copy', () => {
    const listed = listOmpSkills(workspace).find(skill => skill.slug === shared);
    expect(listed).toEqual({ slug: shared, name: 'Shared Craft', description: 'From agents', source: 'omp', path: join(GLOBAL_AGENT_SKILLS_DIR, shared) });
  });

  test('resolveSkillsBySlugs reads only the named slugs and picks the catalog winners', () => {
    const { result, dirs } = readdirCallsDuring(() => resolveSkillsBySlugs(
      workspace, [shared, ompOnly, loose, workspaceWins, shadow, unknown], undefined, { includeOmp: true },
    ));
    const skillRoots = [join(workspace, 'skills'), join(workspace, '.omp', 'skills'), GLOBAL_AGENT_SKILLS_DIR, OMP_GLOBAL_SKILLS_DIR, APP_MANAGED_SKILLS_DIR];
    expect(dirs.filter(dir => skillRoots.includes(dir))).toEqual([]);
    expect([...result].map(([slug, skill]) => [slug, skill.source, skill.path])).toEqual([
      [shared, 'global', join(GLOBAL_AGENT_SKILLS_DIR, shared)],
      [ompOnly, 'omp', join(OMP_GLOBAL_SKILLS_DIR, ompOnly)],
      [loose, 'omp', join(GLOBAL_AGENT_SKILLS_DIR, loose)],
      [workspaceWins, 'workspace', join(workspace, 'skills', workspaceWins)],
      [shadow, 'workspace', join(workspace, 'skills', shadow)],
    ]);
    expect([...resolveSkillsBySlugs(workspace, [ompOnly, loose, shared]).keys()]).toEqual([shared]);
  });

  test('catalog scans and single reads add nothing to the gray-matter cache', async () => {
    const before = grayMatterCacheSize();
    loadAllSkills(workspace, undefined, { includeOmp: true, includeShadowedOmp: true });
    loadAllSkills(workspace);
    listOmpSkills(workspace);
    resolveSkillsBySlugs(workspace, [shared, ompOnly], undefined, { includeOmp: true });
    loadSkillBySlug(workspace, shared);
    await loadSkillDetails(workspace, ompOnly);
    expect(grayMatterCacheSize()).toBe(before);
  });
});
