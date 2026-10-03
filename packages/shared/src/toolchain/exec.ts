/**
 * Node-only exec/which хелперы для toolchain.
 * ВАЖНО: встроенный сервер в packaged Electron-приложении исполняется под
 * Node (не Bun) — весь toolchain обязан работать без Bun-глобалей.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const isWindows = process.platform === 'win32';

/** Windows environment keys are case-insensitive; avoid competing Path/PATH values. */
export function pathEnvKey(env: NodeJS.ProcessEnv, win = isWindows): string {
  return win ? Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH' : 'PATH';
}

export function prependPath<T extends NodeJS.ProcessEnv>(env: T, prefix: string, win = isWindows): T {
  if (!prefix) return env;
  const key = pathEnvKey(env, win);
  const existing = env[key] ?? '';
  const next = { ...env };
  if (win) {
    for (const name of Object.keys(next)) {
      if (name !== key && name.toUpperCase() === 'PATH') delete next[name];
    }
  }
  return { ...next, [key]: existing ? `${prefix}${win ? ';' : ':'}${existing}` : prefix };
}

export function executableCandidates(name: string, win = isWindows): string[] {
  if (!win) return [name];
  if (/\.(exe|com|cmd|bat)$/i.test(name)) return [name];
  return [`${name}.exe`, `${name}.com`, `${name}.cmd`, `${name}.bat`, name];
}

/**
 * Спавн команды; reject с stderr при ненулевом exit-code / ошибке спавна.
 * Без shell — аргументы идут как есть (инъекция через argv невозможна).
 */
export async function runCommand(
  cmd: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
  const [bin, ...args] = cmd;
  if (!bin) throw new Error('runCommand: empty command');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd.join(' ')} exited ${code}: ${stderr.trim()}`));
    });
  });
}

/** Файл существует и исполняем (на win32 — просто существует). */
export async function isExecutable(file: string, win = isWindows): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return false;
    if (!win) await fs.promises.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Кросс-платформенный «which» без Bun.which (Electron main = plain Node). */
export async function whichTool(name: string, pathEnv?: string, win = isWindows): Promise<string | null> {
  const dirs = (pathEnv ?? process.env[pathEnvKey(process.env, win)] ?? '')
    .split(win ? ';' : ':').filter(Boolean);
  for (const dir of dirs) {
    const unquoted = win ? dir.replace(/^"(.*)"$/, '$1') : dir;
    for (const candidate of executableCandidates(name, win)) {
      const full = path.join(unquoted, candidate);
      if (await isExecutable(full, win)) return full;
    }
  }
  return null;
}
