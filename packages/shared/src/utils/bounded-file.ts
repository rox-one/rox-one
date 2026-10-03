import fs from 'node:fs'

export interface BoundedFileOptions {
  maxBytes: number
  /** Credential files must belong to this process user and be private on POSIX. */
  privateOwner?: boolean
}

/** Read the same bounded regular file that was checked, without following a raced link. */
export function readBoundedRegularFile(path: string, options: BoundedFileOptions): Buffer {
  const { maxBytes, privateOwner } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid file byte limit')
  let fd: number | undefined
  const sameFile = (a: fs.BigIntStats, b: fs.BigIntStats) => a.dev === b.dev && a.ino === b.ino
    && a.mode === b.mode && a.nlink === b.nlink && a.uid === b.uid && a.gid === b.gid
  try {
    const named = fs.lstatSync(path, { bigint: true })
    if (!named.isFile() || named.isSymbolicLink() || named.size > BigInt(maxBytes)) throw new Error('Invalid bounded regular file')
    fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0))
    const opened = fs.fstatSync(fd, { bigint: true })
    if (!opened.isFile() || !sameFile(named, opened) || opened.size !== named.size
      || (privateOwner && process.platform !== 'win32' && ((opened.mode & 0o077n) !== 0n
        || (typeof process.getuid === 'function' && opened.uid !== BigInt(process.getuid()))))) {
      throw new Error('Invalid bounded regular file')
    }
    const bytes = Buffer.alloc(Number(opened.size) + 1)
    let length = 0
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    const after = fs.fstatSync(fd, { bigint: true })
    const current = fs.lstatSync(path, { bigint: true })
    if (length !== Number(opened.size) || !current.isFile() || current.isSymbolicLink()
      || !sameFile(opened, after) || !sameFile(opened, current) || after.size !== opened.size
      || current.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || current.mtimeNs !== opened.mtimeNs || current.ctimeNs !== opened.ctimeNs) {
      throw new Error('Bounded regular file changed during read')
    }
    return bytes.subarray(0, length)
  } catch {
    // Callers may project this error to native clients; never include paths or file bytes.
    throw new Error('Bounded regular file is unavailable, unsafe or changed')
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
