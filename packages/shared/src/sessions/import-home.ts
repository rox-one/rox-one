/**
 * cwd `$HOME` is never a Rox workspace (H-04 §4).
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function isHomePath(target: string | undefined, home = homedir()): boolean {
  if (!target) return false
  try {
    return resolve(target) === resolve(home)
  } catch {
    return false
  }
}
