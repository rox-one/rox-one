import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkill, loadSkillDetails, loadWorkspaceSkills } from '../storage.ts';
import { readSkillInstructions, MAX_SKILL_INSTRUCTIONS_BYTES } from '../read-instructions.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = fs.mkdtempSync(join(tmpdir(), 'selected-skill-')); roots.push(root); return root; }
function skill(root: string, name: string, content = 'Выбранный текст\n日本語 🔒') {
  const dir = join(root, name); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'SKILL.md'), `---\nname: Selected\ndescription: Canonical\n---\n${content}`); return dir;
}
describe('selected instructions opened-descriptor custody', () => {
  test('Unicode content, selected-only resolution and project precedence', async () => {
    const root = fixture(), slug = 'selected-' + crypto.randomUUID();
    skill(join(root, '.omp', 'skills'), slug, 'OMP body');
    const unrelated = skill(join(root, '.omp', 'skills'), 'unrelated', 'never selected');
    const realOpen = fs.openSync, opened: string[] = [];
    const open = spyOn(fs, 'openSync').mockImplementation(((...args: Parameters<typeof fs.openSync>) => { opened.push(String(args[0])); return realOpen(...args); }) as typeof fs.openSync);
    try {
      const body = await loadSkillDetails(root, slug);
      expect(body?.source).toBe('omp'); expect(body?.content).toBe('OMP body');
      expect(opened.some(path => path.startsWith(unrelated))).toBe(false);
    } finally { open.mockRestore(); }
    skill(join(root, 'skills'), slug, 'Workspace');
    expect((await loadSkillDetails(root, slug))?.source).toBe('workspace');
    skill(join(root, 'project', '.agents', 'skills'), slug);
    expect((await loadSkillDetails(root, slug, join(root, 'project')))?.content).toBe('Выбранный текст\n日本語 🔒');
  });
  test('directory links and contained instructions-file links retain their real source', () => {
    const root = fixture(), actual = skill(root, 'actual');
    fs.renameSync(join(actual, 'SKILL.md'), join(actual, 'inside.md'));
    fs.symlinkSync('inside.md', join(actual, 'SKILL.md'));
    fs.symlinkSync(actual, join(root, 'alias'), 'dir');
    expect(readSkillInstructions(join(root, 'alias'))).toContain('日本語');
  });
  test('outside leaf links are refused before any bytes and cannot fall back to lower OMP tier', async () => {
    const root = fixture(), slug = 'selected-' + crypto.randomUUID(), dir = skill(join(root, 'skills'), slug);
    fs.writeFileSync(join(root, 'foreign.md'), 'FOREIGN DATA'); fs.unlinkSync(join(dir, 'SKILL.md'));fs.symlinkSync(join(root, 'foreign.md'), join(dir, 'SKILL.md'));
    skill(join(root, '.omp', 'skills'), slug, 'Lower tier');
    const read = spyOn(fs, 'readSync');
    try { expect(() => loadSkill(root, slug)).toThrow('path denied'); await expect(loadSkillDetails(root, slug)).rejects.toThrow('path denied'); expect(read).toHaveBeenCalledTimes(0); }
    finally { read.mockRestore(); }
  });
  test('whole ancestor replacement at the same canonical path is refused before bytes', () => {
    const root = fixture(), parent = join(root, 'parent'), dir = skill(parent, 'sample');
    const original = fs.openSync, canonical = fs.realpathSync(join(dir, 'SKILL.md'));
    let attacked = false;
    const open = spyOn(fs, 'openSync').mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      if (String(args[0]) === canonical && !attacked) {
        attacked = true;
        fs.renameSync(parent, join(root, 'retired-parent')); skill(parent, 'sample', 'FOREIGN SAME PATH');
      }
      return original(...args);
    }) as typeof fs.openSync);
    const read = spyOn(fs, 'readSync');
    try { expect(() => readSkillInstructions(dir)).toThrow('changed');expect(read).toHaveBeenCalledTimes(0);expect(attacked).toBe(true); }
    finally { open.mockRestore();read.mockRestore(); }
  });
  test('replacement after descriptor read never returns the previously read body', () => {
    const root = fixture(), dir = skill(root, 'sample'); const original = fs.readSync;
    let changed = false;
    const read = spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
      const count = (original as any)(...args);
      if (!changed) { changed = true; fs.renameSync(dir, join(root, 'retired'));skill(root, 'sample', 'FOREIGN'); }
      return count;
    }) as typeof fs.readSync);
    try { expect(() => readSkillInstructions(dir)).toThrow('changed');expect(changed).toBe(true); } finally { read.mockRestore(); }
  });
  test('oversized or nonregular instructions do not read bytes', () => {
    const root = fixture(), dir = skill(root, 'sample'); const file = join(dir, 'SKILL.md');
    fs.truncateSync(file, MAX_SKILL_INSTRUCTIONS_BYTES + 1);const read = spyOn(fs, 'readSync');
    try { expect(() => readSkillInstructions(dir)).toThrow('unavailable');expect(read).toHaveBeenCalledTimes(0);fs.unlinkSync(file);fs.mkdirSync(file);expect(() => readSkillInstructions(dir)).toThrow('unavailable');expect(read).toHaveBeenCalledTimes(0); } finally { read.mockRestore(); }
  });
  test('an invalid first/middle entry cannot hide healthy workspace neighbours', () => {
    const root = fixture();skill(join(root,'skills'),'a-healthy');const bad=skill(join(root,'skills'),'b-invalid');skill(join(root,'skills'),'c-healthy');
    fs.unlinkSync(join(bad,'SKILL.md'));fs.symlinkSync(join(root,'foreign'),join(bad,'SKILL.md'));fs.writeFileSync(join(root,'foreign'),'FOREIGN');
    expect(loadWorkspaceSkills(root).map(item=>item.slug).sort()).toEqual(['a-healthy','c-healthy']);
  });
  test('canonical managed-tier exclusion cannot be bypassed by a directory alias', () => {
    const root=fixture(), managed=join(root,'managed'), directory=skill(managed,'disabled');
    fs.symlinkSync(directory,join(root,'alias'),'dir');const read=spyOn(fs,'readSync');
    try {expect(()=>readSkillInstructions(join(root,'alias'),managed)).toThrow('path denied');expect(read).toHaveBeenCalledTimes(0);}finally{read.mockRestore();}
  });
  test('invalid selected slugs are refused without opening any file', async () => {
    const root=fixture(), open=spyOn(fs,'openSync');
    try {for(const slug of ['../other','a/b','a\\b','a:b','.hidden',''])expect(await loadSkillDetails(root,slug)).toBeNull();expect(open).toHaveBeenCalledTimes(0);} finally {open.mockRestore();}
  });
});
