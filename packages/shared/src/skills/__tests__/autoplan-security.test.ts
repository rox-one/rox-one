import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dir, '../../../../..');
const vendor = path.join(root, 'apps/electron/resources/skills/gstack/gstack');
const snapshot = await import(path.join(vendor, 'bin/gstack-autoplan-snapshot.ts'));
const sandbox = () => fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'rox-autoplan-')));

test('autoplan reads bounded regular descriptors with full-width identity', () => {
  const dir = sandbox();
  try {
    const file = path.join(dir, 'plan'); fs.writeFileSync(file, 'implement original');
    const read = snapshot.readAutoplanSnapshot(file);
    expect(read.bytes.toString()).toBe('implement original'); expect(typeof read.stat.ino).toBe('bigint');
    const linked = path.join(dir, 'link'); fs.symlinkSync(file, linked);
    expect(() => snapshot.readAutoplanFile(linked)).toThrow();
    expect(() => snapshot.readAutoplanFile(dir)).toThrow();
    const big = path.join(dir, 'big'); const fd = fs.openSync(big, 'w'); fs.ftruncateSync(fd, 32 * 1024 * 1024 + 1); fs.closeSync(fd);
    expect(() => snapshot.readAutoplanFile(big)).toThrow();
    if (process.platform !== 'win32') {
      const fifo = path.join(dir, 'fifo'); execFileSync('mkfifo', [fifo]);
      expect(() => snapshot.readAutoplanFile(fifo)).toThrow();
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('opened descriptor rejects path replacement and in-place growth', () => {
  const dir = sandbox(), open = fs.openSync, read = fs.readSync;
  try {
    const file = path.join(dir, 'plan'); fs.writeFileSync(file, 'original'); let replaced = false;
    fs.openSync = ((name: any, ...args: any[]) => {
      const fd = (open as any)(name, ...args);
      if (name === file && !replaced) { replaced = true; fs.unlinkSync(file); fs.writeFileSync(file, 'replacement'); }
      return fd;
    }) as typeof fs.openSync;
    expect(() => snapshot.readAutoplanFile(file)).toThrow(); expect(replaced).toBe(true); fs.openSync = open;
    let grown = false;
    fs.readSync = ((...args: any[]) => {
      const count = (read as any)(...args);
      if (!grown) { grown = true; fs.appendFileSync(file, 'growth'); }
      return count;
    }) as typeof fs.readSync;
    expect(() => snapshot.readAutoplanFile(file)).toThrow(); expect(grown).toBe(true);
  } finally { fs.openSync = open; fs.readSync = read; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('initialization preserves source, restore/reuse guards and alias refusal', () => {
  const dir = sandbox();
  try {
    const source = path.join(dir, 'source'), active = path.join(dir, 'plans/active'), restore = path.join(dir, 'backups/original');
    fs.writeFileSync(source, '# Build feature\n');
    expect(snapshot.initializePlan(source, active, restore).reused).toBe(false);
    expect(fs.readFileSync(source, 'utf8')).toBe('# Build feature\n');
    expect(fs.readFileSync(restore, 'utf8')).toBe('# Build feature\n');
    expect(snapshot.extractImplementationPlan(fs.readFileSync(active, 'utf8'))).toContain('# Build feature');
    if (process.platform !== 'win32') expect(fs.statSync(restore).mode & 0o777).toBe(0o400);
    expect(snapshot.initializePlan(source, active, restore).reused).toBe(true);
    fs.appendFileSync(active, 'later user edits\n');
    expect(() => snapshot.initializePlan(source, active, restore)).toThrow();
    expect(fs.readFileSync(active, 'utf8')).toContain('later user edits');
    const alias = path.join(dir, 'alias'); fs.linkSync(source, alias);
    expect(() => snapshot.initializePlan(source, alias, path.join(dir, 'other-restore'))).toThrow();
    expect(fs.readFileSync(source, 'utf8')).toBe('# Build feature\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent source edit after restore publication rolls back only invocation backup', () => {
  const dir = sandbox(), open = fs.openSync;
  try {
    const source = path.join(dir, 'source'), active = path.join(dir, 'active'), restore = path.join(dir, 'restore');
    fs.writeFileSync(source, 'original\n'); let edited = false;
    fs.openSync = ((name: any, ...args: any[]) => {
      if (name === source && fs.existsSync(restore) && !edited) { edited = true; fs.writeFileSync(source, 'concurrent user edit\n'); }
      return (open as any)(name, ...args);
    }) as typeof fs.openSync;
    expect(() => snapshot.initializePlan(source, active, restore)).toThrow(); expect(edited).toBe(true);
    expect(fs.existsSync(active)).toBe(false); expect(fs.existsSync(restore)).toBe(false);
    expect(fs.readFileSync(source, 'utf8')).toBe('concurrent user edit\n');
    expect(fs.readdirSync(dir)).toEqual(['source']);
  } finally { fs.openSync = open; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('methodology, immutable snapshot and exact accepted amendment still work', () => {
  const dir = sandbox();
  try {
    const source = path.join(dir, 'source'), active = path.join(dir, 'active'), restore = path.join(dir, 'restore'), skill = path.join(dir, 'SKILL.md');
    fs.writeFileSync(source, 'Build a feature.\n');
    fs.writeFileSync(skill, '---\nname: plan-ceo-review\n---\n## Review Sections\nEvaluate the full plan.\n');
    snapshot.initializePlan(source, active, restore);
    const methodology = snapshot.prepareMethodology('ceo', skill, restore);
    const baseline = snapshot.createSnapshot('ceo', active, restore, methodology.methodologyPath);
    expect(snapshot.checkImplementation('ceo', active, baseline.snapshotPath, 'unchanged').changed).toBe(false);
    const block = '<!-- autoplan-accepted:ceo -->\n- Preserve all user data.\n<!-- /autoplan-accepted:ceo -->\n';
    fs.appendFileSync(active, block);
    expect(snapshot.amendImplementation('ceo', active, baseline.snapshotPath).changed).toBe(true);
    expect(snapshot.checkPhaseImplementation('ceo', active, baseline.snapshotPath, 'changed').recordedObligations.none).toBe(false);
    expect(snapshot.extractImplementationPlan(fs.readFileSync(active, 'utf8'))).toContain(block.trim());
    expect(fs.readFileSync(restore, 'utf8')).toBe('Build a feature.\n');
    if (process.platform !== 'win32') {
      fs.chmodSync(methodology.methodologyPath, 0o644);
      expect(() => snapshot.createSnapshot('ceo', active, restore, methodology.methodologyPath)).toThrow();
      fs.chmodSync(methodology.methodologyPath, 0o444);
    }
    fs.appendFileSync(skill, 'Edited methodology\n');
    expect(() => snapshot.createSnapshot('ceo', active, restore, methodology.methodologyPath)).toThrow();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('phase hooks retain two-way git links, refuse symlink backlinks and remain identical', async () => {
  const { linkedWorktrees } = await import(path.join(vendor, 'autoplan/bin/phase-publication-hook.ts'));
  const dir = sandbox();
  try {
    const repo = path.join(dir, 'repo'), worktree = path.join(dir, 'worktree'), admin = path.join(repo, '.git/worktrees/one');
    fs.mkdirSync(admin, { recursive: true }); fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(admin, 'gitdir'), path.join(worktree, '.git') + '\n');
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ' + admin + '\n');
    expect(linkedWorktrees(repo)).toEqual([worktree]);
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ' + repo + '\n'); expect(linkedWorktrees(repo)).toEqual([]);
    const outside = path.join(dir, 'outside'); fs.writeFileSync(outside, 'gitdir: ' + admin + '\n');
    fs.unlinkSync(path.join(worktree, '.git')); fs.symlinkSync(outside, path.join(worktree, '.git'));
    expect(linkedWorktrees(repo)).toEqual([]);
    expect(fs.readFileSync(path.join(vendor, 'autoplan/bin/phase-publication-hook.ts')).equals(fs.readFileSync(path.join(vendor, '../autoplan/bin/phase-publication-hook.ts')))).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
