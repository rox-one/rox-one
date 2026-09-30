import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '../storage.ts';
import { loadProjectRoadmap, saveProjectRoadmap } from '../roadmap-storage.ts';
import { normalizeRoadmap } from '../roadmap.ts';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rox-roadmap-recovery-'));
  roots.push(root);
  const project = createProject(root, { name: 'Roadmap recovery' });
  const dir = join(root, 'projects', project.slug);
  return { root, slug: project.slug, dir, file: join(dir, 'roadmap.json') };
}
function revision(file: string) {
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'missing';
}
const save = saveProjectRoadmap;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('roadmap persistence recovery', () => {
  it('rejects traversal and project symlinks outside the authorized workspace projects directory', () => {
    const { root, slug, file } = fixture();
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'config.json'), JSON.stringify({ id: 'outside', slug: 'outside', name: 'Outside' }));
    writeFileSync(join(outside, 'roadmap.json'), JSON.stringify(normalizeRoadmap({ goal: 'private outside data' })));
    const retained = readFileSync(join(outside, 'roadmap.json'));
    expect(() => loadProjectRoadmap(root, '../outside')).toThrow();
    expect(() => saveProjectRoadmap(root, '../outside', normalizeRoadmap({ goal: 'overwrite' }))).toThrow();
    symlinkSync(outside, join(root, 'projects', 'outside-link'), 'dir');
    expect(() => loadProjectRoadmap(root, 'outside-link')).toThrow();
    expect(() => saveProjectRoadmap(root, 'outside-link', normalizeRoadmap({ goal: 'overwrite' }))).toThrow();
    expect(readFileSync(join(outside, 'roadmap.json'))).toEqual(retained);
    expect(existsSync(file)).toBe(false);
    symlinkSync(join(outside, 'roadmap.json'), file);
    expect(() => loadProjectRoadmap(root, slug)).toThrow('PROJECT_ROADMAP_PATH');
    expect(() => saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'overwrite' }))).toThrow('PROJECT_ROADMAP_PATH');
    expect(readFileSync(join(outside, 'roadmap.json'))).toEqual(retained);
  });

  it('rejects a stale second writer and preserves the first canonical and derived bytes', () => {
    const { root, slug, dir, file } = fixture();
    save(root, slug, normalizeRoadmap({ goal: 'base' }), { expectedRevision: 'missing' });
    const observed = revision(file);
    save(root, slug, normalizeRoadmap({ goal: 'winner' }), { expectedRevision: observed });
    const winner = readFileSync(file);
    const markdown = readFileSync(join(dir, 'roadmap.md'));
    expect(() => save(root, slug, normalizeRoadmap({ goal: 'stale' }), { expectedRevision: observed })).toThrow();
    expect(readFileSync(file)).toEqual(winner);
    expect(readFileSync(join(dir, 'roadmap.md'))).toEqual(markdown);
  });

  it('refuses an escaped projects-directory symlink and retains the external canonical and Markdown bytes', () => {
    const { root, slug } = fixture();
    saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'retained external data' }));
    const outside = mkdtempSync(join(tmpdir(), 'rox-roadmap-outside-'));
    roots.push(outside);
    renameSync(join(root, 'projects'), join(outside, 'projects'));
    symlinkSync(join(outside, 'projects'), join(root, 'projects'), 'dir');
    const file = join(outside, 'projects', slug, 'roadmap.json');
    const markdown = join(outside, 'projects', slug, 'roadmap.md');
    const retained = readFileSync(file);
    const retainedMarkdown = readFileSync(markdown);
    expect(() => loadProjectRoadmap(root, slug)).toThrow('PROJECT_ROADMAP_PATH');
    expect(() => saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'unauthorized overwrite' }))).toThrow('PROJECT_ROADMAP_PATH');
    expect(readFileSync(file)).toEqual(retained);
    expect(readFileSync(markdown)).toEqual(retainedMarkdown);
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  it('permits only one of two real processes released with the same observed revision', async () => {
    const { root, slug, dir, file } = fixture();
    const initial = saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'base' }));
    const script = join(root, 'writer.ts');
    writeFileSync(script, `
      import { existsSync, writeFileSync } from 'node:fs';
      import { saveProjectRoadmap } from ${JSON.stringify(join(import.meta.dir, '../roadmap-storage.ts'))};
      import { normalizeRoadmap } from ${JSON.stringify(join(import.meta.dir, '../roadmap.ts'))};
      const [root, slug, revision, name] = process.argv.slice(2);
      writeFileSync(root + '/' + name + '.ready', 'ready');
      const deadline = Date.now() + 5000;
      while (!existsSync(root + '/release')) {
        if (Date.now() > deadline) throw new Error('Writer barrier timeout');
        await Bun.sleep(5);
      }
      try {
        const result = saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: name }), { expectedRevision: revision });
        console.log(JSON.stringify({ ok: true, goal: result.goal, revision: result.revision }));
      } catch (error) { console.log(JSON.stringify({ ok: false, error: String(error) })); }
    `);
    const writers = ['process-A', 'process-B'].map((name) => Bun.spawn(
      [process.execPath, script, root, slug, initial.revision!, name], { stdout: 'pipe', stderr: 'pipe' },
    ));
    try {
      const deadline = Date.now() + 5000;
      while (!['process-A', 'process-B'].every((name) => existsSync(join(root, `${name}.ready`)))) {
        if (Date.now() > deadline) throw new Error('Writer readiness timeout');
        await Bun.sleep(5);
      }
      writeFileSync(join(root, 'release'), 'released');
      const results = await Promise.all(writers.map(async (writer) => {
        const [stdout, stderr, exit] = await Promise.all([new Response(writer.stdout).text(), new Response(writer.stderr).text(), writer.exited]);
        expect(stderr).toBe('');
        expect(exit).toBe(0);
        return JSON.parse(stdout) as { ok: boolean; goal?: string; error?: string };
      }));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)?.error).toMatch(/PROJECT_ROADMAP_(BUSY|CONFLICT)/);
      const winner = results.find((result) => result.ok)!;
      expect(loadProjectRoadmap(root, slug).roadmap.goal).toBe(winner.goal!);
      const canonical = readFileSync(file);
      const markdown = readFileSync(join(dir, 'roadmap.md'));
      expect(() => save(root, slug, normalizeRoadmap({ goal: 'stale retry' }), { expectedRevision: initial.revision! })).toThrow('PROJECT_ROADMAP_CONFLICT');
      expect(readFileSync(file)).toEqual(canonical);
      expect(readFileSync(join(dir, 'roadmap.md'))).toEqual(markdown);
      expect(existsSync(`${file}.lock`)).toBe(false);
    } finally { for (const writer of writers) writer.kill(); }
  });

  it('detects an external edit even when updatedAt is unchanged', () => {
    const { root, slug, file } = fixture();
    saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'base' }));
    const observed = revision(file);
    const external = JSON.parse(readFileSync(file, 'utf8'));
    external.goal = 'external';
    writeFileSync(file, JSON.stringify(external));
    const bytes = readFileSync(file);
    expect(() => save(root, slug, normalizeRoadmap({ goal: 'stale' }), { expectedRevision: observed })).toThrow();
    expect(readFileSync(file)).toEqual(bytes);
  });

  it('does not overwrite corrupt bytes or an existing backup when backup creation fails', () => {
    const { root, slug, dir, file } = fixture();
    writeFileSync(file, '{broken\n\u0000retained');
    const original = readFileSync(file);
    const backup = join(dir, 'roadmap.corrupt-1234.json');
    writeFileSync(backup, 'retained earlier backup');
    const clock = spyOn(Date, 'now').mockReturnValue(1234);
    try {
      expect(() => saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'replacement' }))).toThrow();
      expect(readFileSync(file)).toEqual(original);
      expect(readFileSync(backup, 'utf8')).toBe('retained earlier backup');
      expect(existsSync(join(dir, 'roadmap.json.lock'))).toBe(false);
    } finally { clock.mockRestore(); }
  });

  it('refuses a busy writer lock without removing its bytes', () => {
    const { root, slug, file } = fixture();
    const lock = `${file}.lock`;
    writeFileSync(lock, 'other writer');
    expect(() => saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'blocked' }))).toThrow();
    expect(readFileSync(lock, 'utf8')).toBe('other writer');
    expect(existsSync(file)).toBe(false);
  });

  it('returns an exact revision through normal and corrupt reloads', () => {
    const { root, slug, dir, file } = fixture();
    const missing = loadProjectRoadmap(root, slug) as ReturnType<typeof loadProjectRoadmap> & { revision: string };
    expect(missing.revision).toBe('missing');
    const receipt = save(root, slug, normalizeRoadmap({ goal: 'saved' }), { expectedRevision: missing.revision });
    expect(receipt.revision).toBe(revision(file));
    expect(JSON.parse(readFileSync(file, 'utf8')).revision).toBeUndefined();
    const loaded = loadProjectRoadmap(root, slug) as typeof missing;
    expect(loaded.roadmap.goal).toBe('saved');
    expect(loaded.revision).toBe(revision(file));
    writeFileSync(file, '{retained corrupt content');
    const corrupt = loadProjectRoadmap(root, slug) as typeof missing;
    expect(corrupt.corrupt).toBe(true);
    expect(corrupt.revision).toBe(revision(file));
    const bytes = readFileSync(file);
    save(root, slug, { ...corrupt.roadmap, goal: 'recovered' }, { expectedRevision: corrupt.revision });
    const backups = readdirSync(dir).filter((f) => f.startsWith('roadmap.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0]!))).toEqual(bytes);
    expect(loadProjectRoadmap(root, slug).roadmap.goal).toBe('recovered');
  });

  it('keeps unversioned callers compatible while rejecting an invalid observed token', () => {
    const { root, slug, file } = fixture();
    saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'first legacy save' }));
    saveProjectRoadmap(root, slug, normalizeRoadmap({ goal: 'next legacy save' }));
    expect(loadProjectRoadmap(root, slug).roadmap.goal).toBe('next legacy save');
    const retained = readFileSync(file);
    expect(() => saveProjectRoadmap(root, slug, { ...normalizeRoadmap({ goal: 'invalid overwrite' }), revision: 'invalid-token' })).toThrow('PROJECT_ROADMAP_INVALID_REVISION');
    expect(readFileSync(file)).toEqual(retained);
  });
});
