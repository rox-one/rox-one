import * as fs from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { MAX_SKILL_INSTRUCTIONS_BYTES } from './read-instructions.ts';

/** First read of a SKILL.md head; frontmatter normally fits here. */
export const SKILL_HEAD_BYTES = 8 * 1024;
/** A catalog read never reaches past this offset, whatever the file size. */
export const MAX_SKILL_HEAD_BYTES = 64 * 1024;

export interface SkillHead {
  /** Decoded leading bytes of SKILL.md; contains the whole frontmatter block. */
  text: string;
  /** SKILL.md size in bytes. */
  size: number;
  mtimeMs: number;
}

/** Same delimiter rule as gray-matter: `---` opens a block that `\n---` closes. */
function hasOpenFrontmatter(text: string): boolean {
  const str = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return str.startsWith('---') && str.charAt(3) !== '-' && str.indexOf('\n---', 3) === -1;
}

function readInto(fd: number, bytes: Buffer, from: number, to: number): number {
  let length = from;
  while (length < to) {
    const count = fs.readSync(fd, bytes, length, to - length, length);
    if (!count) break;
    length += count;
  }
  return length;
}

/** Metadata-only read for catalog scans. The leaf must resolve inside the
 * canonical skill directory and the opened descriptor must be the resolved
 * regular file; bodies are read through `readSkillInstructions` instead. */
export function readSkillHead(skillDirectory: string, excludedDirectory?: string): SkillHead | null {
  let directory: string, file: string;
  try {
    directory = fs.realpathSync.native(skillDirectory);
    const leaf = join(directory, 'SKILL.md');
    file = fs.lstatSync(leaf).isSymbolicLink() ? fs.realpathSync.native(leaf) : leaf;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Skill instructions unavailable');
  }
  const rel = relative(directory, file);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill instructions path denied');
  if (excludedDirectory) {
    let excluded: string | undefined;
    try { excluded = fs.realpathSync.native(excludedDirectory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Skill instructions unavailable'); }
    if (excluded) {
      const inside = relative(excluded, directory);
      if (!inside || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) throw new Error('Skill instructions path denied');
    }
  }
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.size > BigInt(MAX_SKILL_INSTRUCTIONS_BYTES)) throw new Error('Skill instructions unavailable');
    const resolved = fs.statSync(file, { bigint: true });
    if (resolved.dev !== opened.dev || resolved.ino !== opened.ino) throw new Error('Skill instructions changed');
    const size = Number(opened.size);
    const bytes = Buffer.allocUnsafe(Math.min(size, MAX_SKILL_HEAD_BYTES));
    let length = readInto(fd, bytes, 0, Math.min(size, SKILL_HEAD_BYTES));
    let text = bytes.toString('utf8', 0, length);
    if (length < size && hasOpenFrontmatter(text)) {
      length = readInto(fd, bytes, length, bytes.length);
      text = bytes.toString('utf8', 0, length);
      if (length < size && hasOpenFrontmatter(text)) throw new Error('Skill frontmatter exceeds the head limit');
    }
    return { text, size, mtimeMs: Number(opened.mtimeMs) };
  } catch {
    throw new Error('Skill instructions unavailable or changed');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
