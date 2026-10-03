/** Node-safe, read-only bridge to the non-secret native installer receipt. */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MANIFEST_DATA } from './manifest-data';
import { pathEnvKey } from './exec';
import { WINDOWS_GIT_BASH_PIN } from './windows-git-bash-pin';

export const WINDOWS_BOOTSTRAP_TOOLS = ['gh', 'git', 'node', 'jq', 'yq'] as const;
export type WindowsBootstrapTool = typeof WINDOWS_BOOTSTRAP_TOOLS[number];
export type WindowsDependencyMode = 'auto' | 'bundled' | 'system';

export function isWindowsDependencyMode(value: unknown): value is WindowsDependencyMode {
  return value === 'auto' || value === 'bundled' || value === 'system';
}

export function bootstrapToolName(name: string): WindowsBootstrapTool | null {
  const bare = name.toLowerCase().replace(/\.exe$/, '');
  if (bare === 'npm' || bare === 'npx' || bare === 'npm.cmd' || bare === 'npx.cmd') return 'node';
  return WINDOWS_BOOTSTRAP_TOOLS.find((tool) => tool === bare) ?? null;
}

export function dependencyVersionUsable(name: WindowsBootstrapTool, text: string): boolean {
  switch (name) {
    case 'gh': return /^gh version ([2-9]|[1-9]\d+)\./.test(text);
    case 'git': return /^git version ([2-9]|[1-9]\d+)\./.test(text);
    case 'jq': return /^jq-[1-9]\d*\./.test(text);
    case 'yq': return /version v?([4-9]|[1-9]\d+)\./.test(text);
    case 'node': {
      const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(text);
      if (!match) return false;
      const [major, minor] = match.slice(1).map(Number);
      return major! > 22 || (major === 22 && minor! >= 23);
    }
  }
}

/** Fixed argv, bounded output/time, no shell, credential reads or receipt-supplied arguments. */
export async function probeWindowsDependency(file: string, name: WindowsBootstrapTool): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(file, ['--version'], { timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve(!error && dependencyVersionUsable(name, stdout + stderr)));
  });
}

function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export interface WindowsBootstrapRuntime {
  mode: WindowsDependencyMode;
  /** Prerequisites only. Other managed tools keep their normal precedence. */
  findExecutable(name: string): Promise<string | null>;
  source(name: string): 'system' | 'bundled' | null;
  pathEntries(): Promise<string[]>;
  isExcludedPath(directory: string): Promise<boolean>;
  filterPath(pathEnv: string): Promise<string>;
  gitBashPath(): Promise<string | null>;
  missingTools: WindowsBootstrapTool[];
  receiptState: 'absent' | 'invalid' | 'ready' | 'failed';
}

export interface WindowsBootstrapOptions {
  platform?: NodeJS.Platform;
  localAppData?: string;
  preference?: WindowsDependencyMode;
  pathEnv?: string;
  /** Packaged and managed roots cannot masquerade as system dependencies. */
  excludedRoots?: string[];
  probe?: typeof probeWindowsDependency;
}

export async function readWindowsBootstrap(options: WindowsBootstrapOptions = {}): Promise<WindowsBootstrapRuntime | null> {
  if ((options.platform ?? process.platform) !== 'win32') return null;
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData)) return null;
  const root = path.join(localAppData, 'Rox', 'bootstrap');
  const receiptFile = path.join(root, 'status.json');
  let receipt: any = null;
  let receiptState: WindowsBootstrapRuntime['receiptState'] = 'absent';
  try {
    if ((await fs.stat(receiptFile)).size > 64 * 1024) throw new Error('oversized receipt');
    // PowerShell 5.1 writes UTF-8 with BOM.
    receipt = JSON.parse((await fs.readFile(receiptFile, 'utf8')).replace(/^\uFEFF/, ''));
    if (receipt?.schemaVersion !== 1 || receipt.platform !== 'win32-x64' || !isWindowsDependencyMode(receipt.mode)) {
      throw new Error('unsupported receipt');
    }
    receiptState = receipt.nativeReady === true ? 'ready' : 'failed';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') receiptState = 'invalid';
    receipt = null;
  }
  // A dev/non-installer launch retains the legacy resolver unless explicitly configured.
  if (!receipt && !options.preference) return null;
  const mode = options.preference ?? receipt.mode;
  const probe = options.probe ?? probeWindowsDependency;
  const excludedRoots = [root, ...(options.excludedRoots ?? [])].filter(path.isAbsolute);
  async function isExcludedPath(directory: string): Promise<boolean> {
    const absolute = path.resolve(directory);
    const real = await fs.realpath(absolute).catch(() => absolute);
    for (const excluded of excludedRoots) {
      const realRoot = await fs.realpath(excluded).catch(() => excluded);
      if (absolute === excluded || contained(excluded, absolute) || real === realRoot || contained(realRoot, real)) return true;
    }
    return false;
  }
  const searchPath = options.pathEnv ?? process.env[pathEnvKey(process.env, true)] ?? '';
  const selected = new Map<WindowsBootstrapTool, string>();
  const bundled = new Set<WindowsBootstrapTool>();
  async function validPrivateFile(file: string): Promise<boolean> {
    try {
      const [realLocal, realFile] = await Promise.all([fs.realpath(localAppData!), fs.realpath(file)]);
      const expectedReal = path.join(realLocal, path.relative(localAppData!, file));
      // Reject directory junctions/symlinks at any level, not just lexical traversal.
      return realFile.toLowerCase() === expectedReal.toLowerCase() && (await fs.stat(realFile)).isFile();
    } catch { return false; }
  }
  async function usable(file: string, name: WindowsBootstrapTool): Promise<boolean> {
    try { return (await fs.stat(file)).isFile() && await probe(file, name); } catch { return false; }
  }
  const missingTools: WindowsBootstrapTool[] = [];
  for (const name of WINDOWS_BOOTSTRAP_TOOLS) {
    let executable: string | null = null;
    if (mode !== 'bundled') {
      for (const raw of searchPath.split(';')) {
        const directory = raw.trim().replace(/^"(.*)"$/, '$1');
        if (!path.isAbsolute(directory) || await isExcludedPath(directory)) continue;
        const candidate = path.join(directory, `${name}.exe`);
        if (!await isExcludedPath(candidate) && await usable(candidate, name)) { executable = candidate; break; }
      }
    }
    if (!executable && mode !== 'system') {
      const entry = MANIFEST_DATA[name]!;
      const artifact = entry.artifacts['win32-x64']!;
      const expected = path.join(root, 'dependencies', name, entry.version, artifact.binPaths[0]!);
      const tool = Array.isArray(receipt?.tools) ? receipt.tools.find((t: any) => t?.name === name) : undefined;
      // Never consume arbitrary pathEntries, stale pins or receipt-provided paths/argv.
      if (tool?.source === 'bundled' && tool.pinnedVersion === entry.version &&
          typeof tool.executable === 'string' && path.isAbsolute(tool.executable) &&
          path.normalize(tool.executable).toLowerCase() === expected.toLowerCase()) {
        try {
          if (await validPrivateFile(expected) && await usable(expected, name)) {
            executable = expected;
            bundled.add(name);
          }
        } catch { /* Removed/corrupt cache is not a usable dependency. */ }
      }
    }
    if (executable) selected.set(name, executable);
    else missingTools.push(name);
  }
  async function findExecutable(name: string): Promise<string | null> {
    const tool = bootstrapToolName(name);
    if (!tool) return null;
    const primary = selected.get(tool);
    if (!primary || (bundled.has(tool) ? !await validPrivateFile(primary) : await isExcludedPath(primary)) || !await usable(primary, tool)) return null;
    const bare = name.toLowerCase().replace(/\.(exe|cmd)$/, '');
    if (bare === 'npm' || bare === 'npx') {
      const companion = path.join(path.dirname(primary), `${bare}.cmd`);
      // Node archive/system distribution owns the companion, including symlink containment.
      try {
        const realParent = await fs.realpath(path.dirname(primary));
        const realCompanion = await fs.realpath(companion);
        return contained(realParent, realCompanion) && (await fs.stat(companion)).isFile() ? companion : null;
      } catch { return null; }
    }
    return primary;
  }
  async function gitBashPath(): Promise<string | null> {
    if (mode === 'system') return null;
    const pin = WINDOWS_GIT_BASH_PIN;
    const expected = path.join(root, 'dependencies', pin.name, pin.version, pin.binPaths[0]);
    const tool = receipt?.gitBash;
    if (tool?.source !== 'bundled' || tool.pinnedVersion !== pin.version || typeof tool.executable !== 'string' ||
        path.normalize(tool.executable).toLowerCase() !== expected.toLowerCase()) return null;
    for (const bin of pin.binPaths) {
      if (!await validPrivateFile(path.join(root, 'dependencies', pin.name, pin.version, bin))) return null;
    }
    return new Promise<string | null>((resolve) => {
      execFile(expected, ['--noprofile', '--norc', '--version'],
        { timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true },
        (error, stdout) => resolve(!error && /^GNU bash, version [4-9]\./.test(stdout) ? expected : null));
    });
  }
  return {
    mode, receiptState, missingTools, findExecutable, isExcludedPath, gitBashPath,
    source(name) {
      const tool = bootstrapToolName(name);
      return tool && selected.has(tool) ? bundled.has(tool) ? 'bundled' : 'system' : null;
    },
    async filterPath(pathEnv) {
      const retained: string[] = [];
      const realRoot = await fs.realpath(root).catch(() => root);
      for (const raw of pathEnv.split(';').filter(Boolean)) {
        const directory = raw.replace(/^"(.*)"$/, '$1');
        const real = await fs.realpath(directory).catch(() => directory);
        if (directory === root || contained(root, directory) || real === realRoot || contained(realRoot, real)) continue;
        const managedPrerequisite = excludedRoots.some((excluded) => WINDOWS_BOOTSTRAP_TOOLS.some((name) => {
          const toolRoot = path.join(excluded, name);
          return directory === toolRoot || contained(toolRoot, directory) || real === toolRoot || contained(toolRoot, real);
        }));
        if (managedPrerequisite) continue;
        // Excluded aliases/packaged bins containing prerequisites cannot reappear
        // in source-overridden child PATH. rg/Bun/uv-only bins remain untouched.
        if (await isExcludedPath(directory)) {
          const hasPrerequisite = await Promise.all(WINDOWS_BOOTSTRAP_TOOLS.map((name) =>
            fs.stat(path.join(directory, `${name}.exe`)).then((stat) => stat.isFile()).catch(() => false)));
          if (hasPrerequisite.some(Boolean)) continue;
        }
        retained.push(raw);
      }
      return retained.join(';');
    },
    async pathEntries() {
      const dirs = new Set<string>();
      for (const tool of WINDOWS_BOOTSTRAP_TOOLS) {
        const file = await findExecutable(tool);
        if (file) dirs.add(path.dirname(file));
      }
      const bash = await gitBashPath();
      if (bash) dirs.add(path.dirname(bash));
      return [...dirs];
    },
  };
}

// Registered by the host before source/MCP initialization. No disk state or env JSON.
let runtime: WindowsBootstrapRuntime | null = null;
export function setWindowsBootstrapRuntime(value: WindowsBootstrapRuntime | null): void { runtime = value; }
export function getWindowsBootstrapRuntime(): WindowsBootstrapRuntime | null { return runtime; }
