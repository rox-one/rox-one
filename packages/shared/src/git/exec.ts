/**
 * Read-only git subprocesses. argv only (no shell), aliases and fsmonitor off.
 */

import { execFileSync } from 'node:child_process'
import { emptyGitWorkingTreeStatus, parseGitPorcelainV1, type GitWorkingTreeStatus } from './status.ts'

const GIT_TIMEOUT_MS = 5000
const DEV_NULL = process.platform === 'win32' ? 'NUL' : '/dev/null'

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: DEV_NULL,
    GIT_OPTIONAL_LOCKS: '0',
  }
}

function gitArgs(command: string[]): string[] {
  return [
    '-c',
    'alias.status=',
    '-c',
    'alias.rev-parse=',
    '-c',
    'core.fsmonitor=',
    '-c',
    'core.hooksPath=',
    ...command,
  ]
}

export function execGitReadOnly(command: string[], cwd: string, timeout = GIT_TIMEOUT_MS): string {
  return execFileSync('git', gitArgs(command), {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
    env: gitEnv(),
  })
}

export function readGitWorkingTreeStatus(cwd: string): GitWorkingTreeStatus {
  try {
    const raw = execGitReadOnly(['status', '--porcelain=v1', '-b'], cwd)
    return parseGitPorcelainV1(raw)
  } catch {
    return emptyGitWorkingTreeStatus()
  }
}

export function readGitBranchName(cwd: string): string | null {
  try {
    const branch = execGitReadOnly(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim()
    return branch || null
  } catch {
    return null
  }
}
