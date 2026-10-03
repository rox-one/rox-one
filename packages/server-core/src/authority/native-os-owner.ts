import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import { statSync } from 'node:fs'
import { win32 } from 'node:path'

const OWNER_ERROR = 'maintenance requires the state directory OS owner'
const OWNER_PATH_ENV = 'ROX_NATIVE_OWNER_PROBE_PATH'
const OWNER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$identity = $null
try {
  $target = [Environment]::GetEnvironmentVariable('${OWNER_PATH_ENV}', 'Process')
  if ([String]::IsNullOrWhiteSpace($target) -or -not [IO.Path]::IsPathRooted($target)) { exit 1 }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  if ($null -eq $identity.User) { exit 1 }
  $acl = Get-Acl -LiteralPath $target
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])
  if ($null -eq $owner) { exit 1 }
  $tokenOwner = $identity.Owner
  if ($owner.Value -eq $identity.User.Value -or ($null -ne $tokenOwner -and $owner.Value -eq $tokenOwner.Value)) { [Console]::Out.Write('1') }
  else { [Console]::Out.Write('0') }
} catch { exit 1 }
finally { if ($null -ne $identity) { $identity.Dispose() } }
`
const OWNER_COMMAND = Buffer.from(OWNER_SCRIPT, 'utf16le').toString('base64')

/** Explicit OS seams support controlled boundary tests without changing the host. */
export interface OsOwnerDependencies {
  platform?: NodeJS.Platform
  arch?: string
  env?: NodeJS.ProcessEnv
  getuid?: () => number | undefined
  stat?: (path: string) => { uid: number }
  exec?: (file: string, args: string[], options: ExecFileSyncOptionsWithStringEncoding) => string
}

/** Read-only ownership check; Windows permits only the user/default token-owner SID. */
export function requireOsOwner(path: string, dependencies: OsOwnerDependencies = {}): void {
  if ((dependencies.platform ?? process.platform) !== 'win32') {
    const getuid = 'getuid' in dependencies ? dependencies.getuid : process.getuid
    const uid = typeof getuid === 'function' ? getuid() : undefined
    if (uid === undefined || (dependencies.stat ?? statSync)(path).uid !== uid) throw new Error(OWNER_ERROR)
    return
  }

  const env = dependencies.env ?? process.env
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT
  if (!systemRoot || !win32.isAbsolute(systemRoot) || systemRoot.includes('\0')
    || !win32.isAbsolute(path) || path.includes('\0')) throw new Error(OWNER_ERROR)
  const executable = win32.join(systemRoot, (dependencies.arch ?? process.arch) === 'ia32' ? 'Sysnative' : 'System32',
    'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    // The fixed script reads its literal target from a private child environment.
    // No target, SID, ACL, profile command or subprocess error reaches public output.
    const result = (dependencies.exec ?? execFileSync)(executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', OWNER_COMMAND], {
        env: { ...env, [OWNER_PATH_ENV]: path }, encoding: 'utf8', windowsHide: true,
        timeout: 2_000, maxBuffer: 1_024, stdio: ['ignore', 'pipe', 'pipe'],
      })
    if (result.trim() === '1') return
  } catch { /* Missing, denied, timed-out and malformed probes all fail closed. */ }
  throw new Error(OWNER_ERROR)
}
