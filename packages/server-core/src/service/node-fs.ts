/**
 * Node filesystem adapter for the transactional service install.
 *
 * Kept separate from the pure install logic so the publish/rollback path is
 * testable with a fake fs. `readFile` returns null for ENOENT; any other error
 * propagates so a permission problem is not mistaken for a missing file.
 */

import { chmod, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import type { ServiceFilesystem } from './launchd-install.ts'

/** Narrow an unknown failure to its string `code` without an unchecked cast. */
function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

export function createNodeServiceFilesystem(): ServiceFilesystem {
  return {
    async readFile(path) {
      try {
        return await readFile(path, 'utf8')
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async statMode(path) {
      try {
        return (await stat(path)).mode & 0o777
      } catch (error) {
        if (isMissing(error)) return null
        throw error
      }
    },
    async writeFile(path, content, mode) {
      await writeFile(path, content, { encoding: 'utf8', mode })
      await chmod(path, mode)
    },
    async mkdir(path, mode) {
      await mkdir(path, { recursive: true, mode })
      await chmod(path, mode)
    },
    async unlink(path) {
      try {
        await unlink(path)
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    },
  }
}