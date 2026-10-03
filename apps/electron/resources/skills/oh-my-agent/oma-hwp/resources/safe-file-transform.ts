import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

/** Edit the opened regular file; pathname replacements cannot redirect writes. */
export async function transformFileSafely(
  path: string,
  transform: (source: string) => string | Promise<string>,
): Promise<boolean> {
  const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Expected a regular document file");
    const source = await handle.readFile("utf8");
    const output = await transform(source);
    if (output === source) return false;
    const [after, current] = await Promise.all([handle.stat(), lstat(path)]);
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error("Document changed while transforming; refusing to overwrite");
    }
    const bytes = Buffer.from(output, "utf8");
    let written = 0;
    while (written < bytes.length) {
      const result = await handle.write(bytes, written, bytes.length - written, written);
      if (!result.bytesWritten) throw new Error("Document write made no progress");
      written += result.bytesWritten;
    }
    await handle.truncate(bytes.length);
    return true;
  } finally {
    await handle.close();
  }
}
