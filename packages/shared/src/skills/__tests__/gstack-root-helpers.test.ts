import { expect, test } from 'bun:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dir, '../../../../../apps/electron/resources/skills/gstack/gstack');
const { readBoundedStable } = await import(join(root, 'lib/cso/bounded-file.ts'));
const { readBoundedRangeStable } = await import(join(root, 'lib/cso/bounded-range-file.ts'));
const { atomicWriteSync } = await import(join(root, 'lib/fs-atomic.ts'));
const { migrateClaudeCodeSkills } = await import(join(root, 'lib/claude-code-migration.ts'));
const transpiler = new Bun.Transpiler({ loader: 'ts' });
function actualFunction(file: string, start: string, end: string, context: any): any {
  const source = fs.readFileSync(join(root, file), 'utf8');
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  expect(a).toBeGreaterThanOrEqual(0); expect(b).toBeGreaterThan(a);
  const name = start.match(/(?:function|const) (\w+)/)![1];
  return runInNewContext(`${transpiler.transformSync(source.slice(a, b))}\n${name}`, context);
}
test('migration atomic copy replaces target link privately without writing its victim', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rox-migrate-helper-'));
  try {
    const source = join(dir, 'source'), target = join(dir, 'target'), victim = join(dir, 'victim');
    fs.writeFileSync(source, 'source', { mode: 0o640 }); fs.writeFileSync(victim, 'victim'); fs.symlinkSync(victim, target);
    const copy = actualFunction('lib/claude-code-migration.ts', 'function atomicCopy(', 'function preserveCopy(', { fs, path: { dirname: (p: string) => resolve(p, '..') }, readBoundedStable, atomicWriteSync });
    copy(source, target);
    expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
    expect(fs.lstatSync(target).isFile()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('source');
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(dir).sort()).toEqual(['source', 'target', 'victim']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('actual migration preserves customized skills and adjacent notes while installing replacement', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rox-migrate-flow-'));
  try {
    const installDir = join(dir, 'source'), home = join(dir, 'home'), skills = join(home, '.codex/skills');
    const generated = '<!-- AUTO-GENERATED from fixture -->\n<!-- Regenerate: bun run gen:skill-docs -->\n';
    const old = join(skills, 'gstack-claude'), next = join(skills, 'gstack-claude-code');
    fs.mkdirSync(old, { recursive: true }); fs.mkdirSync(next, { recursive: true }); fs.mkdirSync(installDir);
    fs.writeFileSync(join(old, 'SKILL.md'), generated + 'name: claude\nold customized');
    fs.writeFileSync(join(old, 'notes.md'), 'user notes');
    const customized = generated + 'name: claude-code\nnew customized';
    fs.writeFileSync(join(next, 'SKILL.md'), customized);
    for (const rel of ['bin/gstack-claude-code', 'lib/claude-code.ts', 'lib/claude-code-windows-job.ts', 'lib/claude-bin.ts', 'lib/outside-review-result.ts']) {
      const file = join(installDir, rel); fs.mkdirSync(resolve(file, '..'), { recursive: true }); fs.writeFileSync(file, 'fixture runtime');
    }
    const result = migrateClaudeCodeSkills({ installDir, home, env: { CODEX_HOME: join(home, '.codex') }, copy: true, log() {}, render(_host: string, output: string) {
      const file = join(output, '.agents/skills/gstack-claude-code/SKILL.md');
      fs.mkdirSync(resolve(file, '..'), { recursive: true }); fs.writeFileSync(file, generated + 'name: claude-code\nreplacement');
    } });
    expect(result).toEqual({ migrated: 1, pending: [] });
    expect(fs.readFileSync(join(next, 'SKILL.md'), 'utf8')).toContain('replacement');
    expect(fs.readFileSync(join(next, 'SKILL.md.before-claude-code'), 'utf8')).toBe(customized);
    expect(fs.readFileSync(join(old, 'notes.md'), 'utf8')).toBe('user notes');
    expect(fs.readFileSync(join(old, 'SKILL.md.before-claude-code'), 'utf8')).toContain('old customized');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('preflight protects uncertain existing user skills and identifies generated content', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rox-preflight-helper-'));
  try {
    const skill = join(dir, 'SKILL.md');
    const owned = actualFunction('scripts/preflight-codex-overlap.ts', 'const userOwnedRoot =', 'const linkIsOurs =', {
      exists: (p: string) => fs.lstatSync(p, { throwIfNoEntry: false }), path: { join }, readBoundedStable,
    });
    expect(owned(dir)).toBe(false);
    fs.writeFileSync(skill, '# User skill'); expect(owned(dir)).toBe(true);
    fs.writeFileSync(skill, '<!-- AUTO-GENERATED from template -->'); expect(owned(dir)).toBe(false);
    const victim = join(dir, 'victim'); fs.writeFileSync(victim, '<!-- AUTO-GENERATED from secret -->');
    fs.rmSync(skill); fs.symlinkSync(victim, skill); expect(owned(dir)).toBe(true);
    expect(fs.readFileSync(victim, 'utf8')).toBe('<!-- AUTO-GENERATED from secret -->');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('timeline tail remains bounded and refuses a symlink instead of reading its target', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rox-timeline-helper-'));
  try {
    const path = join(dir, 'timeline'), victim = join(dir, 'victim');
    const tail = actualFunction('hosts/claude/hooks/timeline-stop-hook.ts', 'function readTimelineTail(', 'function logHookError(', { readBoundedRangeStable, TAIL_WINDOW_BYTES: 32 });
    const value = 'a'.repeat(50) + '\nlast\n'; fs.writeFileSync(path, value);
    expect(tail(path, Buffer.byteLength(value))).toBe('last\n');
    fs.writeFileSync(victim, 'private'); fs.rmSync(path); fs.symlinkSync(victim, path);
    expect(() => tail(path, 7)).toThrow();
    expect(fs.readFileSync(victim, 'utf8')).toBe('private');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('engine identity uses the opened regular object and rejects replacements', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rox-engine-helper-'));
  try {
    const file = join(dir, 'engine'), victim = join(dir, 'victim'); fs.writeFileSync(file, 'engine'); fs.writeFileSync(victim, 'victim');
    const identity = actualFunction('bin/gstack-design-detect.ts', 'function engineIdentity(', '/** The sentinel NAME', { fs, Buffer, createHash, DETECT_LIMITS: { engineHashBytes: 4 } });
    expect(identity(file)).toBe(createHash('sha256').update('6').update('engi').digest('hex').slice(0, 12));
    fs.rmSync(file); fs.symlinkSync(victim, file); expect(identity(file)).toBe('unreadable');
    fs.rmSync(file); fs.writeFileSync(file, 'engine');
    const racedFs = { ...fs, openSync(...args: any[]) {
      const fd = (fs.openSync as any)(...args); fs.renameSync(file, join(dir, 'old')); fs.symlinkSync(victim, file); return fd;
    } };
    const raced = actualFunction('bin/gstack-design-detect.ts', 'function engineIdentity(', '/** The sentinel NAME', { fs: racedFs, Buffer, createHash, DETECT_LIMITS: { engineHashBytes: 4 } });
    expect(raced(file)).toBe('unreadable'); expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('office-hours prepare creates private evidence and rejects a linked existing prompt', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'rox-office-helper-'));
  try {
    const design = join(dir, 'design.md'); fs.writeFileSync(design, '# Design\n');
    const argv = [join(root, 'bin/gstack-office-hours-review'), 'prepare', '--design', design, '--out-dir', dir];
    const first = spawnSync(process.execPath, argv, { encoding: 'utf8', env: { ...process.env, HOME: dir } });
    expect(first.status).toBe(0); const result = JSON.parse(first.stdout);
    expect(fs.statSync(result.promptPath).mode & 0o777).toBe(0o600);
    const victim = join(dir, 'victim'); fs.writeFileSync(victim, 'victim'); fs.rmSync(result.promptPath); fs.symlinkSync(victim, result.promptPath);
    const second = spawnSync(process.execPath, argv, { encoding: 'utf8', env: { ...process.env, HOME: dir } });
    expect(second.status).toBe(1); expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
