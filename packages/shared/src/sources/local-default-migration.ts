import * as fs from 'node:fs';
import { basename, dirname, join } from 'node:path';

const MAX_SOURCE_FILE_BYTES = 256 * 1024;

/**
 * Update the same admitted source-file descriptor, never a replacement link.
 * This is an optimistic migration, not a general lock for arbitrary writers:
 * observed changes/links/oversized files are refused without overwriting them.
 */
export function updateRegularSourceFile(
  path: string,
  workspaceRoot: string,
  transform: (raw: string) => string | null,
): boolean {
  let fd: number | undefined;
  try {
    if (!['config.json', 'guide.md'].includes(basename(path))) return false;
    const root = fs.realpathSync(workspaceRoot);
    const sources = join(root, 'sources');
    const directory = dirname(path);
    const contained = () => fs.realpathSync(join(workspaceRoot, 'sources')) === sources
      && !fs.lstatSync(directory).isSymbolicLink()
      && fs.realpathSync(directory) === join(sources, basename(directory));
    if (!contained()) return false;
    const leaf = fs.lstatSync(path);
    if (!leaf.isFile() || leaf.nlink !== 1 || leaf.size > MAX_SOURCE_FILE_BYTES) return false;
    fd = fs.openSync(path, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const original = fs.fstatSync(fd);
    const same = (stat: fs.Stats) => stat.isFile() && stat.nlink === 1
      && stat.dev === original.dev && stat.ino === original.ino
      && stat.size === original.size && stat.mtimeMs === original.mtimeMs && stat.ctimeMs === original.ctimeMs;
    if (!same(leaf) || !contained()) return false;
    const read = () => {
      const buffer = Buffer.alloc(original.size + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const count = fs.readSync(fd!, buffer, bytes, buffer.length - bytes, bytes);
        if (!count) break;
        bytes += count;
      }
      if (bytes !== original.size || !same(fs.fstatSync(fd!))) return null;
      return buffer.subarray(0, bytes);
    };
    const raw = read();
    if (!raw) return false;
    const transformed = transform(raw.toString('utf8'));
    if (transformed === null) return false;
    const next = Buffer.from(transformed);
    if (next.length > MAX_SOURCE_FILE_BYTES || !contained() || !same(fs.lstatSync(path))) return false;
    const current = read();
    if (!current?.equals(raw)) return false;
    let bytes = 0;
    while (bytes < next.length) {
      const written = fs.writeSync(fd, next, bytes, next.length - bytes, bytes);
      if (!written) throw new Error('Source migration write made no progress');
      bytes += written;
    }
    fs.ftruncateSync(fd, next.length);
    fs.fsyncSync(fd);
    return true;
  } catch { return false; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
