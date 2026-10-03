import fs from 'node:fs';
import { CsoError } from './contracts';

/** Read a bounded appended range from a single stable, nonlinked regular file. */
export function readBoundedRangeStable(path: string, offset: number, max: number, label: string): Buffer {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(max) || max < 0)
    throw new CsoError('MISSING_INPUT', `${label} has an invalid read range`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(path, { bigint: true });
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.nlink !== 1n || named.nlink !== 1n || opened.dev !== named.dev || opened.ino !== named.ino)
      throw new CsoError('SNAPSHOT_RACE', `${label} is not a stable regular file`);
    if (opened.size < BigInt(offset)) throw new CsoError('SNAPSHOT_RACE', `${label} was truncated after the offset was captured`);
    const remaining = opened.size - BigInt(offset);
    if (remaining > BigInt(max))
      throw new CsoError('MISSING_INPUT', `${label} exceeds its appended-byte limit`);
    const data = Buffer.alloc(Number(remaining));
    let bytes = 0;
    while (bytes < data.length) {
      const count = fs.readSync(fd, data, bytes, data.length - bytes, offset + bytes);
      if (count === 0) break;
      bytes += count;
    }
    const after = fs.fstatSync(fd, { bigint: true }), current = fs.lstatSync(path, { bigint: true });
    if (BigInt(bytes) !== remaining || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1n || current.dev !== opened.dev || current.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs || current.size !== opened.size || current.mtimeNs !== opened.mtimeNs || current.ctimeNs !== opened.ctimeNs)
      throw new CsoError('SNAPSHOT_RACE', `${label} changed while it was read`);
    return data;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
