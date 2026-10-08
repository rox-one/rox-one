/**
 * PERF-02: bundled skills startup short-circuit + background scheduling.
 *
 * - up-to-date install → skipped without hashing or writing skill files
 * - bundle version bump → full hash-merge runs
 * - user edits survive (skip path never touches them; merge preserves them)
 * - corrupt/missing stamp, edited state, removed skill dir, changed disabled
 *   list → full sync
 * - background scheduler: gate, stamp check before any worker, join semantics,
 *   real worker_thread run of the worker entry
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { ensureBundledSkills, resetBundledSkillsInitialized } from '../bundled.ts';
import { isBundledSkillsSyncCurrent, runBundledSkillsSyncJob, SYNC_STAMP_FILE, type ResolvedBundledSkillsTarget } from '../bundled-core.ts';
import {
  BUNDLE_FINGERPRINT_FILE,
  computeBundledSkillsContentFingerprint,
  readBundledSkillsFingerprint,
  writeBundledSkillsFingerprint,
} from '../bundled-fingerprint.ts';
import { ensureBundledSkillsInBackground, resetBundledSkillsBackgroundForTests, whenBundledSkillsSettled } from '../bundled-background.ts';

let tempDir: string;
let bundleRoot: string;
let targetRoot: string;

function put(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}
const read = (rel: string) => readFileSync(join(targetRoot, rel), 'utf-8');
const skillMd = (name: string, tag: string) => `---\nname: "${name}"\ndescription: "A ${name} skill"\n---\n\nBody ${tag}\n`;

function seed(tag: string): void {
  put(bundleRoot, 'superpowers/alpha/SKILL.md', skillMd('alpha', tag));
  put(bundleRoot, 'superpowers/alpha/notes.txt', `notes ${tag}`);
  put(bundleRoot, 'pack-b/beta/SKILL.md', skillMd('beta', tag));
  put(bundleRoot, 'SKILLS.lock', JSON.stringify({ version: 1, packs: [
    { slug: 'superpowers', origin: 'https://example.test/sp', commit: `sha-${tag}`, skills: ['alpha'] },
    { slug: 'pack-b', origin: 'https://example.test/b', commit: `sha-b-${tag}`, skills: ['beta'] },
  ] }));
  writeBundledSkillsFingerprint(bundleRoot);
}

const sync = (extra: { disabled?: string[]; skipIfCurrent?: boolean } = {}) =>
  ensureBundledSkills({ bundleRoot, targetRoot, disabled: [], skipIfCurrent: true, ...extra });
const target = (disabled: string[] = []): ResolvedBundledSkillsTarget => ({ bundleRoot, targetRoot, linksRoot: null, disabled });
const stampPath = () => join(targetRoot, '.bundled', SYNC_STAMP_FILE);

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bundled-stamp-test-'));
  bundleRoot = join(tempDir, 'bundle');
  targetRoot = join(tempDir, 'target');
  mkdirSync(bundleRoot, { recursive: true });
  resetBundledSkillsInitialized();
  resetBundledSkillsBackgroundForTests();
});
afterEach(() => {
  resetBundledSkillsInitialized();
  resetBundledSkillsBackgroundForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('sync stamp short-circuit', () => {
  it('first install runs the full merge and writes a stamp; the next launch is skipped without hashing', () => {
    seed('v1');
    const first = sync();
    expect(first.upToDate).toBeUndefined();
    expect(read('alpha/SKILL.md')).toBe(skillMd('alpha', 'v1'));
    expect(existsSync(stampPath())).toBe(true);
    expect(isBundledSkillsSyncCurrent(target())).toBe(true);

    // Change a bundle file *without* re-fingerprinting: a skipped sync must not
    // read/hash bundle contents, so the stale copy stays (the fingerprint is authoritative).
    put(bundleRoot, 'superpowers/alpha/notes.txt', 'notes CHANGED-UNSTAMPED');
    const second = sync();
    expect(second.upToDate).toBe(true);
    expect(second.packs).toEqual([]);
    expect(read('alpha/notes.txt')).toBe('notes v1');
  });

  it('a bundle version bump triggers the full merge and upgrades files', () => {
    seed('v1'); sync();
    seed('v2');
    const result = sync();
    expect(result.upToDate).toBeUndefined();
    expect(read('alpha/SKILL.md')).toBe(skillMd('alpha', 'v2'));
    expect(read('beta/SKILL.md')).toBe(skillMd('beta', 'v2'));
    expect(sync().upToDate).toBe(true);
  });

  it('preserves user-modified skills exactly across skips and upgrades', () => {
    seed('v1'); sync();
    put(targetRoot, 'alpha/notes.txt', 'my own notes');
    put(targetRoot, 'alpha/extra.md', 'user-added file');
    expect(sync().upToDate).toBe(true);
    expect(read('alpha/notes.txt')).toBe('my own notes');

    seed('v2');
    const upgraded = sync();
    const sp = upgraded.packs.find(pack => pack.slug === 'superpowers')!;
    expect(sp.localModified).toBe(true);
    expect(read('alpha/notes.txt')).toBe('my own notes');
    expect(read('alpha/extra.md')).toBe('user-added file');
    expect(read('alpha/SKILL.md')).toBe(skillMd('alpha', 'v2'));
  });

  it('a corrupt or missing stamp forces a full sync', () => {
    seed('v1'); sync();
    rmSync(join(targetRoot, 'beta'), { recursive: true });
    writeFileSync(stampPath(), '{"version":1, garbage');
    expect(isBundledSkillsSyncCurrent(target())).toBe(false);
    expect(sync().upToDate).toBeUndefined();
    expect(read('beta/SKILL.md')).toBe(skillMd('beta', 'v1'));

    rmSync(stampPath());
    expect(sync().upToDate).toBeUndefined();
    expect(sync().upToDate).toBe(true);
  });

  it('removed skill dirs, edited pack state and disabled-list changes invalidate the stamp', () => {
    seed('v1'); sync();
    rmSync(join(targetRoot, 'alpha'), { recursive: true });
    expect(isBundledSkillsSyncCurrent(target())).toBe(false);
    sync();
    expect(read('alpha/SKILL.md')).toBe(skillMd('alpha', 'v1'));

    const statePath = join(targetRoot, '.bundled', 'pack-b.json');
    const state = readFileSync(statePath, 'utf-8');
    writeFileSync(statePath, `${state}\n`);
    expect(isBundledSkillsSyncCurrent(target())).toBe(false);
    sync();
    expect(isBundledSkillsSyncCurrent(target())).toBe(true);

    expect(isBundledSkillsSyncCurrent(target(['pack-b']))).toBe(false);
    sync({ disabled: ['pack-b'] });
    expect(isBundledSkillsSyncCurrent(target(['pack-b']))).toBe(true);
    expect(isBundledSkillsSyncCurrent(target())).toBe(false);
  });

  it('explicit (non-ambient) calls keep the full merge by default', () => {
    seed('v1');
    ensureBundledSkills({ bundleRoot, targetRoot, disabled: [] });
    const again = ensureBundledSkills({ bundleRoot, targetRoot, disabled: [] });
    expect(again.upToDate).toBeUndefined();
    expect(again.packs.length).toBe(2);
  });
});

describe('bundle fingerprint', () => {
  it('uses the build-time content fingerprint, else a metadata fallback that tracks edits', () => {
    seed('v1');
    const content = computeBundledSkillsContentFingerprint(bundleRoot);
    expect(readBundledSkillsFingerprint(bundleRoot)).toBe(`content:${content}`);
    put(bundleRoot, 'superpowers/alpha/notes.txt', 'notes v1'); // same bytes
    expect(computeBundledSkillsContentFingerprint(bundleRoot)).toBe(content);
    put(bundleRoot, 'superpowers/alpha/notes.txt', 'notes v1b');
    expect(computeBundledSkillsContentFingerprint(bundleRoot)).not.toBe(content);

    rmSync(join(bundleRoot, BUNDLE_FINGERPRINT_FILE));
    const stat1 = readBundledSkillsFingerprint(bundleRoot);
    expect(stat1.startsWith('stat:')).toBe(true);
    utimesSync(join(bundleRoot, 'pack-b/beta/SKILL.md'), new Date(1_000_000), new Date(1_000_000));
    expect(readBundledSkillsFingerprint(bundleRoot)).not.toBe(stat1);

    writeFileSync(join(bundleRoot, BUNDLE_FINGERPRINT_FILE), 'not json');
    expect(readBundledSkillsFingerprint(bundleRoot).startsWith('stat:')).toBe(true);
  });
});

describe('background scheduler', () => {
  it('waits for the gate, then skips the worker entirely when the stamp is current', async () => {
    seed('v1'); sync({ skipIfCurrent: false });
    resetBundledSkillsInitialized();
    let workerRuns = 0; let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const pending = ensureBundledSkillsInBackground({ target: target(), after: gate, workerScript: 'unused.cjs',
      runInWorker: async () => { workerRuns++; return { status: 'synced', packs: 0, failedPacks: 0, localModifiedPacks: 0 }; } });
    let done = false; void pending.then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(done).toBe(false);
    open();
    const outcome = await pending;
    expect(outcome.status).toBe('up-to-date'); expect(outcome.via).toBe('none'); expect(workerRuns).toBe(0);
  });

  it('runs the merge in the worker when needed; later callers join instead of re-running', async () => {
    seed('v1');
    let workerRuns = 0; const completed: string[] = [];
    const first = ensureBundledSkillsInBackground({ target: target(), workerScript: 'unused.cjs',
      onComplete: outcome => completed.push(outcome.status),
      runInWorker: async (_script, t) => { workerRuns++; return runBundledSkillsSyncJob(t); } });
    const second = ensureBundledSkillsInBackground({ target: target() });
    const [a, b] = await Promise.all([first, second]);
    await whenBundledSkillsSettled();
    expect(a.status).toBe('synced'); expect(a.via).toBe('worker'); expect(a.packs).toBe(2);
    expect(b.joined).toBe(true); expect(workerRuns).toBe(1); expect(completed).toEqual(['synced']);
    expect(read('alpha/SKILL.md')).toBe(skillMd('alpha', 'v1'));
    expect(isBundledSkillsSyncCurrent(target())).toBe(true);
  });

  it('falls back to a deferred inline merge when the worker fails', async () => {
    seed('v1');
    const outcome = await ensureBundledSkillsInBackground({ target: target(), workerScript: 'unused.cjs',
      runInWorker: async () => { throw new Error('spawn failed'); } });
    expect(outcome.status).toBe('synced'); expect(outcome.via).toBe('inline');
    expect(read('beta/SKILL.md')).toBe(skillMd('beta', 'v1'));
  });

  it('runs the real worker entry in a worker_thread', async () => {
    seed('v1');
    const outcome = await ensureBundledSkillsInBackground({ target: target(),
      workerScript: join(import.meta.dir, '..', 'bundled-sync.worker.ts') });
    expect(outcome.via).toBe('worker'); expect(outcome.status).toBe('synced');
    expect(read('alpha/notes.txt')).toBe('notes v1');
  });
});
