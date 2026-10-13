import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSkillHead } from '../skill-head.ts';
import { loadSkillsFromDir } from '../storage.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'skill-head-'))); roots.push(root); return root; }
function skillDir(root: string, name: string, content: string) {
  const dir = join(root, name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'SKILL.md'), content); return dir;
}

/** Total bytes handed out by fs.readSync while `run` executes. */
function readBytesDuring<T>(run: () => T): { result: T; bytes: number } {
  const realRead = fs.readSync;
  let bytes = 0;
  const read = spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
    const count = (realRead as (...a: Parameters<typeof fs.readSync>) => number)(...args);
    bytes += count;
    return count;
  }) as typeof fs.readSync);
  try {
    const result = run();
    return { result, bytes };
  } finally { read.mockRestore(); }
}

const MIB = 1024 * 1024;

describe('readSkillHead', () => {
  test('a 1 MiB body costs one 8 KiB read and the catalog still gets exact metadata', () => {
    const root = fixture();
    skillDir(root, 'big', `---\nname: Big\ndescription: Large body\n---\n${'x'.repeat(MIB)}`);
    const { result: head, bytes } = readBytesDuring(() => readSkillHead(join(root, 'big')));
    expect(bytes).toBe(8192);
    expect(head!.size).toBe(1048618);
    expect(head!.text.startsWith('---\nname: Big\ndescription: Large body\n---\n')).toBe(true);

    const { result: listed, bytes: catalogBytes } = readBytesDuring(() => loadSkillsFromDir(root, 'workspace'));
    expect(catalogBytes).toBe(8192);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ slug: 'big', content: '', contentLength: 1048618, metadata: { name: 'Big', description: 'Large body' } });
  });

  test('frontmatter beyond 8 KiB is read up to 64 KiB, never into the body', () => {
    const root = fixture();
    skillDir(root, 'wide', `---\nname: Wide\ndescription: ${'d'.repeat(20_000)}\n---\n${'x'.repeat(MIB)}`);
    const { result: listed, bytes } = readBytesDuring(() => loadSkillsFromDir(root, 'workspace'));
    expect(bytes).toBe(65536);
    expect(listed[0]!.metadata.name).toBe('Wide');
    expect(listed[0]!.metadata.description).toHaveLength(20_000);
  });

  test('frontmatter still open at 64 KiB of a larger file is refused', () => {
    const root = fixture();
    skillDir(root, 'open', `---\nname: Open\ndescription: ${'d'.repeat(100_000)}\n`);
    const { bytes } = readBytesDuring(() => expect(() => readSkillHead(join(root, 'open'))).toThrow());
    expect(bytes).toBe(65536);
  });

  test('a missing directory or SKILL.md is absent, not an error', () => {
    const root = fixture();
    fs.mkdirSync(join(root, 'empty'));
    expect(readSkillHead(join(root, 'empty'))).toBeNull();
    expect(readSkillHead(join(root, 'nowhere'))).toBeNull();
  });

  test('a SKILL.md link escaping the skill directory is denied before any read', () => {
    if (process.platform === 'win32') return;
    const root = fixture();
    fs.writeFileSync(join(root, 'secret.md'), '---\nname: Secret\ndescription: outside\n---\nsecret');
    const dir = join(root, 'escape'); fs.mkdirSync(dir);
    fs.symlinkSync('../secret.md', join(dir, 'SKILL.md'));
    const { bytes } = readBytesDuring(() => expect(() => readSkillHead(dir)).toThrow('Skill instructions path denied'));
    expect(bytes).toBe(0);
    expect(loadSkillsFromDir(root, 'workspace')).toEqual([]);
  });

  test('a SKILL.md link inside the skill directory is accepted', () => {
    if (process.platform === 'win32') return;
    const root = fixture();
    const dir = skillDir(root, 'linked', 'placeholder');
    fs.rmSync(join(dir, 'SKILL.md'));
    fs.writeFileSync(join(dir, 'inside.md'), '---\nname: Linked\ndescription: contained\n---\nbody');
    fs.symlinkSync('inside.md', join(dir, 'SKILL.md'));
    expect(readSkillHead(dir)!.text).toBe('---\nname: Linked\ndescription: contained\n---\nbody');
    expect(loadSkillsFromDir(root, 'workspace').map(skill => skill.metadata.name)).toEqual(['Linked']);
  });

  test('a SKILL.md that is not a regular file is refused', () => {
    const root = fixture();
    fs.mkdirSync(join(root, 'folder', 'SKILL.md'), { recursive: true });
    expect(() => readSkillHead(join(root, 'folder'))).toThrow();
    if (process.platform !== 'win32') {
      fs.mkdirSync(join(root, 'fifo'));
      execFileSync('mkfifo', [join(root, 'fifo', 'SKILL.md')]);
      expect(() => readSkillHead(join(root, 'fifo'))).toThrow();
    }
    expect(loadSkillsFromDir(root, 'workspace')).toEqual([]);
  });

  test('a skill directory inside the excluded directory is denied', () => {
    const root = fixture();
    const dir = skillDir(join(root, 'store'), 'owned', '---\nname: Owned\ndescription: app\n---\nbody');
    expect(() => readSkillHead(dir, join(root, 'store'))).toThrow('Skill instructions path denied');
    expect(readSkillHead(dir, join(root, 'elsewhere'))!.size).toBe(41);
  });
});
