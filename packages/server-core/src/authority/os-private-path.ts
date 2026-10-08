import { spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { win32 } from 'node:path'

interface PrivatePath {
  readonly path: string
  readonly kind: 'directory' | 'file'
}
type WindowsOperation = 'secure' | 'require-private'
const fullControl = 2032127
const sidPattern = /^S-1-\d+(?:-\d+){1,15}$/

function ownerFailure(): Error {
  return new Error('maintenance requires the state directory OS owner')
}

/** Decodes only the OS probe protocol; callers cannot supply an identity to the authority. */
export function validateWindowsPrivatePaths(value: unknown, paths: readonly PrivatePath[], operation: WindowsOperation): void {
  if (operation !== 'secure' && operation !== 'require-private') throw ownerFailure()
  if (!value || typeof value !== 'object') throw ownerFailure()
  const result = value as Record<string, unknown>
  if (typeof result.currentSid !== 'string' || !sidPattern.test(result.currentSid) || typeof result.tokenOwnerSid !== 'string' || !sidPattern.test(result.tokenOwnerSid) || !Array.isArray(result.paths) || result.paths.length !== paths.length) throw ownerFailure()
  for (let index = 0; index < paths.length; index++) {
    const item = result.paths[index] as Record<string, unknown> | undefined
    const requested = paths[index]!
    // An elevated Windows token can create objects with its actual default
    // owner SID. Do not accept arbitrary token groups or an admin whitelist.
    if (!item || item.path !== requested.path || item.kind !== requested.kind || (item.ownerSid !== result.currentSid && item.ownerSid !== result.tokenOwnerSid) || item.reparsePoint !== false) throw ownerFailure()
    if (item.protected !== true || !Array.isArray(item.rules) || item.rules.length !== 1) throw new Error('native authority requires OS-owner private access rules')
    const rule = item.rules[0] as Record<string, unknown> | undefined
    if (!rule || rule.sid !== result.currentSid || rule.type !== 'Allow' || rule.rights !== fullControl || rule.inherited !== false || rule.inheritance !== (requested.kind === 'directory' ? 3 : 0) || rule.propagation !== 0) {
      throw new Error('native authority requires OS-owner private access rules')
    }
  }
}

// Runs the Windows APIs in the inherited process token. No user name, UID,
// enrollment credential or environment-provided identity is accepted here.
// Input is base64 JSON on stdin, never executable path interpolation.
const windowsPrivatePathsScript = `
$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('Windows private authority stage: process-start')
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  [Console]::Error.WriteLine('Windows private authority stage: input-ready')
  $payload = [Console]::In.ReadToEnd()
  [Console]::Error.WriteLine('Windows private authority stage: input-complete')
  $request = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  try { $sid = $identity.User; $tokenOwner = $identity.Owner } finally { $identity.Dispose() }
  if ($null -eq $sid -or $null -eq $tokenOwner) { throw 'Windows token has no user or owner SID' }
  [Console]::Error.WriteLine('Windows private authority stage: identity-complete')
  $items = @()
  foreach ($entry in @($request.paths)) {
    $path = [string]$entry.path
    $attributes = [System.IO.File]::GetAttributes($path)
    if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not private authority paths' }
    $directory = ($attributes -band [System.IO.FileAttributes]::Directory) -ne 0
    if ($directory -ne ($entry.kind -eq 'directory')) { throw 'Private path kind mismatch' }
    if ($directory) { $acl = [System.IO.Directory]::GetAccessControl($path) }
    else { $acl = [System.IO.File]::GetAccessControl($path) }
    $owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $sid.Value -and $owner -ne $tokenOwner.Value) { throw 'Private path is not owned by the process OS token' }
    $items += [pscustomobject]@{ path = $path; directory = $directory; acl = $acl }
  }
  # All ownership/type checks finish before any security descriptor is changed.
  [Console]::Error.WriteLine('Windows private authority stage: ownership-checked')
  $results = @()
  foreach ($item in $items) {
    $acl = $item.acl
    if ($request.operation -eq 'secure') {
      $acl.SetAccessRuleProtection($true, $false)
      foreach ($rule in @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) { $acl.RemoveAccessRuleAll($rule) }
      $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
      if ($item.directory) { $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
      $acl.AddAccessRule($rule)
      # Preserve the already-verified owner; only the DACL is modified.
      if ($item.directory) { [System.IO.Directory]::SetAccessControl($item.path, $acl) }
      else { [System.IO.File]::SetAccessControl($item.path, $acl) }
    }
    # Re-read the actual descriptor after mutation, including its owner.
    $attributes = [System.IO.File]::GetAttributes($item.path)
    if ($item.directory) { $acl = [System.IO.Directory]::GetAccessControl($item.path) }
    else { $acl = [System.IO.File]::GetAccessControl($item.path) }
    $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
      [pscustomobject]@{ sid = $_.IdentityReference.Value; type = [string]$_.AccessControlType; rights = [int]$_.FileSystemRights; inherited = $_.IsInherited; inheritance = [int]$_.InheritanceFlags; propagation = [int]$_.PropagationFlags }
    })
    $kind = 'file'; if ($item.directory) { $kind = 'directory' }
    $results += [pscustomobject]@{ path = $item.path; kind = $kind; ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; reparsePoint = (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0); protected = $acl.AreAccessRulesProtected; rules = @($rules) }
  }
  [Console]::Error.WriteLine('Windows private authority stage: descriptor-complete')
  [pscustomobject]@{ currentSid = $sid.Value; tokenOwnerSid = $tokenOwner.Value; paths = @($results) } | ConvertTo-Json -Depth 6 -Compress
} catch {
  [Console]::Error.WriteLine('Windows private authority stage: failed')
  exit 1
}
`

export function resolveWindowsSystemRoot(): string {
  // Resolve the kernel's SystemRoot, outside user/session DOS-device mappings.
  // An environment override must never select the security-verifier executable.
  // The ordinary Node-compatible resolver walks namespace ancestors, which
  // are not filesystem directories. Use the OS full-path handle operation.
  const systemRoot = realpathSync.native(String.raw`\\?\GLOBALROOT\SystemRoot`)
  if (!win32.isAbsolute(systemRoot)) throw new Error('Windows OS ownership verification is unavailable')
  return systemRoot
}

function windowsPrivatePaths(paths: readonly PrivatePath[], operation: WindowsOperation): void {
  const systemRoot = resolveWindowsSystemRoot()
  const executable = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsPrivatePathsScript, 'utf16le').toString('base64')], {
    input: Buffer.from(JSON.stringify({ paths, operation }), 'utf8').toString('base64'),
    encoding: 'utf8', windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024,
    // No inherited PowerShell module/profile or runtime-loader overrides.
    env: { SystemRoot: systemRoot, WINDIR: systemRoot, PSModulePath: win32.join(win32.dirname(executable), 'Modules') },
  })
  if (result.error || result.signal || result.status !== 0) {
    // Report only fixed stage tags and OS process codes. Arbitrary PowerShell
    // errors can include request paths, and are excluded from diagnostics.
    const allowedStages = new Set(['process-start', 'input-ready', 'input-complete', 'identity-complete', 'ownership-checked', 'descriptor-complete', 'failed'].map(stage => `Windows private authority stage: ${stage}`))
    const stages = result.stderr.split(/\r?\n/).filter(line => allowedStages.has(line)).slice(-7)
    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code
    const diagnostics = { code: typeof errorCode === 'string' && /^[A-Z0-9_]{1,32}$/.test(errorCode) ? errorCode : null, status: result.status, signal: result.signal, stages }
    throw new Error(`Windows OS ownership verification failed: ${JSON.stringify(diagnostics)}`)
  }
  let output: unknown
  try { output = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()) }
  catch { throw new Error('Windows OS ownership verification returned an invalid descriptor') }
  validateWindowsPrivatePaths(output, paths, operation)
}

export function requireOsOwner(path: string): void {
  if (process.platform === 'win32') {
    windowsPrivatePaths([{ path, kind: 'directory' }], 'require-private')
    return
  }
  const uid = process.getuid?.()
  if (uid === undefined || statSync(path).uid !== uid) throw ownerFailure()
}

/** Read-only verification for sensitive maintenance boundaries; never repairs a changed ACL. */
export function requireOsPrivatePaths(paths: readonly PrivatePath[]): void {
  checkPrivatePathTypes(paths)
  if (process.platform === 'win32') windowsPrivatePaths(paths, 'require-private')
}

function checkPrivatePathTypes(paths: readonly PrivatePath[]): void {
  for (const { path, kind } of paths) {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || (kind === 'directory' ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)) throw new Error('native authority requires real private paths without aliases')
    if (process.platform !== 'win32') {
      const uid = process.getuid?.()
      if (uid === undefined || info.uid !== uid) throw ownerFailure()
    }
  }
}

/** Secure empty/new owner-held paths before SQLite or secret issuance can write bytes. */
export function secureOsPrivatePaths(paths: readonly PrivatePath[]): void {
  checkPrivatePathTypes(paths)
  if (!paths.length) return
  if (process.platform === 'win32') windowsPrivatePaths(paths, 'secure')
  else for (const { path, kind } of paths) chmodSync(path, kind === 'directory' ? 0o700 : 0o600)
}

/** Instance-owned custody for an already OS-verified, bounded SQLite family. */
export function privateFileIdentity(info: { dev: bigint; ino: bigint }): string {
  if (typeof info.dev !== 'bigint' || typeof info.ino !== 'bigint' || info.dev < 0n || info.ino <= 0n) throw new Error('OS cannot provide a stable private file identity')
  return `${info.dev}:${info.ino}`
}

export class VerifiedPrivateFileGuard {
  readonly #identities = new Map<string, string>()

  secure(files: readonly { path: string; kind: 'file' }[]): void {
    if (files.length > 3) throw new Error('private SQLite family exceeds its custody bound')
    const currentPaths = new Set(files.map(file => file.path))
    for (const path of this.#identities.keys()) if (!currentPaths.has(path)) this.#identities.delete(path)
    const identities = new Map<string, string>()
    for (const file of files) {
      const info = lstatSync(file.path, { bigint: true })
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1n) throw new Error('authority database must be an OS-owner private regular file')
      if (process.platform === 'win32') identities.set(file.path, privateFileIdentity(info))
    }
    // POSIX chmod/UID checks are cheap and remain authoritative on every call;
    // the verified-identity optimization is only for the Windows OS probe.
    if (process.platform !== 'win32') { secureOsPrivatePaths(files); return }
    // Existing children are individually verified, never inferred from their
    // parent alone. A replaced or newly created child needs a fresh OS probe.
    const unchecked = files.filter(file => this.#identities.get(file.path) !== identities.get(file.path))
    if (!unchecked.length) return
    secureOsPrivatePaths(unchecked)
    for (const file of unchecked) {
      const info = lstatSync(file.path, { bigint: true })
      const identity = privateFileIdentity(info)
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1n || identity !== identities.get(file.path)) throw new Error('authority database changed during OS privacy verification')
      this.#identities.set(file.path, identity)
    }
  }
}
