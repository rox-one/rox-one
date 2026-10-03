import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { win32 } from 'node:path';

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
  if (platform !== 'win32') return { command: '/bin/bash', argsPrefix: ['-lc'] };

  // A sanitized env is a plain object, unlike Windows' case-insensitive process.env.
  const value = (name: string) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

  // Electron's Git Bash setup already publishes this setting. Honor it even
  // when Git's bin directory is not on PATH (Git normally adds only cmd).
  const configured = value('CLAUDE_CODE_GIT_BASH_PATH')?.trim();
  if (configured) return { command: nativeGitBash(configured), argsPrefix: ['-lc'] };

  const path = value('PATH') ?? '';
  const system32 = win32.join(value('SystemRoot') || 'C:\\Windows', 'System32');
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
  return { command: nativeGitBash(command), argsPrefix: ['-lc'] };
}

// Includes OS helper startup, process enumeration, and pipe teardown. A timed
// out tool must not wait indefinitely for a descendant to close inherited IO.
export const HOST_BASH_KILL_GRACE_MS = 3000;

/** Retain ancestry across termination: MSYS can replace a process during kill. */
export async function killHostBashProcessTree(pid: number, startedAt: number): Promise<void> {
  const killParent = () => {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
  };
  if (process.platform === 'win32') {
    // taskkill /T takes one snapshot. An MSYS exec can create a new Windows
    // PID after that snapshot, leaving pipes open even when taskkill exits 0.
    // Keep dead ancestors in the set and rescan after killing them. Seeding
    // with the shell PID also finds children when the shell has already exited.
    const script = `
$ErrorActionPreference = 'Stop'
$known = [System.Collections.Generic.HashSet[uint32]]::new()
[void]$known.Add(${pid})
$started = [DateTimeOffset]::FromUnixTimeMilliseconds(${startedAt}).UtcDateTime
for ($pass = 0; $pass -lt 3; $pass++) {
  $all = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $started })
  do {
    $changed = $false
    foreach ($p in $all) {
      if ($known.Contains([uint32]$p.ParentProcessId) -and $known.Add([uint32]$p.ProcessId)) { $changed = $true }
    }
  } while ($changed)
  foreach ($p in $all) {
    if ($known.Contains([uint32]$p.ProcessId)) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  if ($pass -lt 2) { Start-Sleep -Milliseconds 50 }
}`;
    await new Promise<void>(resolve => {
      const killer = spawn(win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
      const timer = setTimeout(() => {
        killer.kill('SIGKILL');
        killParent();
        resolve();
      }, HOST_BASH_KILL_GRACE_MS);
      killer.once('error', () => { clearTimeout(timer); killParent(); resolve(); });
      killer.once('close', code => {
        clearTimeout(timer);
        if (code !== 0) killParent();
        resolve();
      });
    });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { killParent(); }
}
