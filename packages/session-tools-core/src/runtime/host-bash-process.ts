import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { win32 } from 'node:path';
import { createSanitizedEnv } from './sandbox-env.ts';

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function nativeGitBash(command: string): string {
  // Git's bin/bash.exe is a launcher, not the shell. Once both the launcher
  // and shell exit, a background child's PPID names an untracked intermediate.
  // Launch the shell from that same installation to keep ancestry discoverable.
  const native = win32.join(win32.dirname(command), '..', 'usr', 'bin', 'bash.exe');
  return win32.basename(win32.dirname(command)).toLowerCase() === 'bin' && isFile(native) ? native : command;
}

/** Host Bash needs a native Bash, not Windows' WSL bash.exe launcher. */
export function resolveHostBashShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): { command: string; argsPrefix: string[] } {
  if (platform !== 'win32') return { command: '/bin/bash', argsPrefix: ['--noprofile', '--norc', '-c'] };

  // A sanitized env is a plain object, unlike Windows' case-insensitive process.env.
  const value = (name: string) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const system32 = win32.join(value('SystemRoot') || 'C:\\Windows', 'System32');

  // Electron's Git Bash setup already publishes this setting. Honor it even
  // when Git's bin directory is not on PATH (Git normally adds only cmd).
  const configured = value('CLAUDE_CODE_GIT_BASH_PATH')?.trim();
  if (configured) {
    if (!win32.isAbsolute(configured) || win32.parse(configured).root.length <= 1 ||
        win32.resolve(win32.dirname(configured)).toLowerCase() === win32.resolve(system32).toLowerCase()) {
      throw new Error('Configure an absolute native Git Bash path, not the WSL launcher.');
    }
    return { command: nativeGitBash(configured), argsPrefix: ['--noprofile', '--norc', '-c'] };
  }

  const path = value('PATH') ?? '';
  const candidates: string[] = [];
  for (const entry of path.split(';').filter(Boolean)) {
    const dir = entry.replace(/^"|"$/g, '');
    // A PATH entry for Git\cmd also locates Git\bin\bash.exe.
    if (win32.basename(dir).toLowerCase() === 'cmd') {
      candidates.push(win32.join(dir, '..', 'bin', 'bash.exe'));
    }
    if (win32.resolve(dir).toLowerCase() !== win32.resolve(system32).toLowerCase()) {
      candidates.push(win32.join(dir, 'bash.exe'));
    }
  }
  candidates.push(
    win32.join(value('ProgramFiles') || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    win32.join(value('ProgramFiles(x86)') || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
  );
  const localAppData = value('LOCALAPPDATA');
  if (localAppData) candidates.push(win32.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));

  const command = candidates.find(isFile);
  if (!command) throw new Error('Git Bash was not found. Configure CLAUDE_CODE_GIT_BASH_PATH to bash.exe.');
  return { command: nativeGitBash(command), argsPrefix: ['--noprofile', '--norc', '-c'] };
}

/** Keep prepared PATH and credential scrubbing effective through shell startup. */
export function prepareHostBashEnv(
  base: NodeJS.ProcessEnv,
  shell: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = createSanitizedEnv(base, platform);
  for (const key of Object.keys(env)) {
    const name = key.toUpperCase();
    if (name === 'BASH_ENV' || name === 'ENV' || name.startsWith('BASH_FUNC_')) delete env[key];
  }
  if (platform === 'win32') {
    const key = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
    // Non-login Git Bash still needs its own coreutils. Managed bins remain first.
    const dir = win32.dirname(shell);
    const path = env[key] ?? '';
    if (!path.split(';').some(part => win32.resolve(part.replace(/^"|"$/g, '')).toLowerCase() === win32.resolve(dir).toLowerCase())) {
      env[key] = path ? `${path};${dir}` : dir;
    }
  }
  return env;
}

// Includes OS helper startup, enumeration, and pipe teardown. The handler
// independently closes inherited IO after this grace even if cleanup stalls.
export const HOST_BASH_KILL_GRACE_MS = 3000;

/**
 * POSIX uses the detached process group. Windows retains observed birth times
 * and ancestor exit cutoffs across three snapshots, rather than treating every
 * future reuse of a numeric PID as an owned descendant. This is bounded best
 * effort cleanup; it is not a Windows Job Object ownership guarantee.
 */
export async function killHostBashProcessTree(
  pid: number,
  spawnedAt: { before: number; after: number },
  exitedAt: number | undefined,
  killOwnedParent: () => void,
): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(spawnedAt.before)
      || !Number.isFinite(spawnedAt.after) || spawnedAt.after < spawnedAt.before) return;
  const killParent = () => { try { killOwnedParent(); } catch { /* already dead */ } };
  if (process.platform !== 'win32') {
    try { process.kill(-pid, 'SIGKILL'); } catch { killParent(); }
    return;
  }
  if (exitedAt !== undefined && !Number.isFinite(exitedAt)) return;
  const script = `
$ErrorActionPreference = 'Stop'
$begin = [DateTimeOffset]::FromUnixTimeMilliseconds(${spawnedAt.before}).UtcDateTime
$end = [DateTimeOffset]::FromUnixTimeMilliseconds(${spawnedAt.after + 1}).UtcDateTime
$cutoff = ${exitedAt === undefined ? '$null' : `[DateTimeOffset]::FromUnixTimeMilliseconds(${exitedAt + 1}).UtcDateTime`}
$known = @{}
$known[[uint32]${pid}] = @{ Birth = $begin; Cutoff = $cutoff; Root = $true }
for ($pass = 0; $pass -lt 3; $pass++) {
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $begin })
  $live = @{}
  foreach ($p in $all) { $live[[uint32]$p.ProcessId] = $p.CreationDate.ToUniversalTime() }
  foreach ($id in @($known.Keys)) {
    $owner = $known[$id]
    if ($live.ContainsKey($id)) {
      $birth = $live[$id]
      if ($owner.Root -and $null -eq $owner.Cutoff -and $birth -le $end) { $owner.Birth = $birth }
      elseif (($owner.Root -and $birth -gt $end) -or (!$owner.Root -and $birth -ne $owner.Birth)) {
        if ($null -eq $owner.Cutoff -or $birth -lt $owner.Cutoff) { $owner.Cutoff = $birth }
      }
    }
  }
  do {
    $changed = $false
    foreach ($p in $all) {
      $id = [uint32]$p.ProcessId
      $parent = [uint32]$p.ParentProcessId
      $birth = $p.CreationDate.ToUniversalTime()
      if (!$known.ContainsKey($id) -and $known.ContainsKey($parent)) {
        $owner = $known[$parent]
        if ($birth -ge $owner.Birth -and ($null -eq $owner.Cutoff -or $birth -le $owner.Cutoff)) {
          $known[$id] = @{ Birth = $birth; Cutoff = $null; Root = $false }; $changed = $true
        }
      }
    }
  } while ($changed)
  foreach ($id in @($known.Keys)) {
    $owner = $known[$id]
    if ($live.ContainsKey($id) -and $live[$id] -eq $owner.Birth) {
      # Resolve a process object and recheck identity immediately before kill.
      $process = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($process -and [Math]::Abs(($process.StartTime.ToUniversalTime() - $owner.Birth).Ticks) -lt 10) {
        $owner.Cutoff = [DateTime]::UtcNow
        try { $process.Kill() } catch { }
      }
    }
  }
  if ($pass -lt 2) { Start-Sleep -Milliseconds 50 }
}`;
  await new Promise<void>(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      killParent(); resolve();
    };
    try {
      const env = createSanitizedEnv();
      const systemRoot = Object.entries(env).find(([key]) => key.toUpperCase() === 'SYSTEMROOT')?.[1] || 'C:\\Windows';
      const killer = spawn(win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true, env });
      timer = setTimeout(() => { killer.kill('SIGKILL'); finish(); }, HOST_BASH_KILL_GRACE_MS);
      killer.once('error', finish);
      killer.once('close', finish);
    } catch { finish(); }
  });
}
