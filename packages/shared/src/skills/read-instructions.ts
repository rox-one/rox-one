import * as fs from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

/** A selected instructions document is bounded independently of RPC framing. */
export const MAX_SKILL_INSTRUCTIONS_BYTES = 2 * 1024 * 1024;

/** Directory links remain valid identities; a file link must stay inside the
 * selected canonical directory. Bind the opened leaf to each captured ancestor
 * before reading, then check the descriptor and paths again before returning. */
export function readSkillInstructions(skillDirectory: string, excludedDirectory?: string): string | null {
  let directory: string, file: string;
  try {
    directory = fs.realpathSync(skillDirectory);
    file = fs.realpathSync(join(skillDirectory, 'SKILL.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Skill instructions unavailable');
  }
  const rel = relative(directory, file);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill instructions path denied');
  if (excludedDirectory) {
    let excluded: string | undefined;
    try { excluded = fs.realpathSync(excludedDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Skill instructions unavailable'); }
    if (excluded) {
      const inside = relative(excluded, directory);
      if (!inside || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) throw new Error('Skill instructions path denied');
    }
  }
  let fd: number | undefined;
  try {
    const paths: string[] = [];
    for (let path = dirname(file); ; path = dirname(path)) {
      paths.push(path);
      if (dirname(path) === path) break;
    }
    const ancestors = paths.map(path => {
      const stat = fs.lstatSync(path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Skill instructions path denied');
      return { path, dev: stat.dev, ino: stat.ino };
    });
    const assertPaths = () => {
      if (fs.realpathSync(skillDirectory) !== directory || fs.realpathSync(join(skillDirectory, 'SKILL.md')) !== file) throw new Error('Skill instructions changed');
      for (const ancestor of ancestors) {
        const stat = fs.lstatSync(ancestor.path, { bigint: true });
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== ancestor.dev || stat.ino !== ancestor.ino
          || fs.realpathSync(ancestor.path) !== ancestor.path) throw new Error('Skill instructions changed');
      }
    };
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.size > BigInt(MAX_SKILL_INSTRUCTIONS_BYTES)) throw new Error('Skill instructions unavailable');
    const same = (stat: typeof opened) => stat.isFile() && !stat.isSymbolicLink()
      && stat.dev === opened.dev && stat.ino === opened.ino && stat.mode === opened.mode
      && stat.uid === opened.uid && stat.gid === opened.gid && stat.nlink === opened.nlink
      && stat.size === opened.size && stat.mtimeNs === opened.mtimeNs && stat.ctimeNs === opened.ctimeNs;
    if (!same(fs.lstatSync(file, { bigint: true }))) throw new Error('Skill instructions changed');
    assertPaths();
    const bytes = Buffer.alloc(Number(opened.size));
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length !== bytes.length || !same(fs.fstatSync(fd, { bigint: true })) || !same(fs.lstatSync(file, { bigint: true }))) throw new Error('Skill instructions changed');
    assertPaths();
    return bytes.toString('utf8');
  } catch {
    throw new Error('Skill instructions unavailable or changed');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
