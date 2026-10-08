/** Node-safe, read-only bridge to the non-secret native installer receipt. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
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

/**
 * Acceptance rules for `--version` output. Single source of truth: hashed into
 * the persistent probe-cache key, so raising a minimum invalidates cached
 * "usable" verdicts immediately (not after the 7-day TTL).
 */
export const WINDOWS_DEPENDENCY_REQUIREMENTS = {
  gh: /^gh version ([2-9]|[1-9]\d+)\./,
  git: /^git version ([2-9]|[1-9]\d+)\./,
  jq: /^jq-[1-9]\d*\./,
  yq: /version v?([4-9]|[1-9]\d+)\./,
  node: { major: 22, minor: 23 },
  gitBash: /^GNU bash, version [4-9]\./,
} as const;

export const WINDOWS_PROBE_REQUIREMENTS_HASH = createHash('sha256')
  .update(JSON.stringify(Object.entries(WINDOWS_DEPENDENCY_REQUIREMENTS)
    .map(([tool, rule]) => [tool, rule instanceof RegExp ? `${rule.source}/${rule.flags}` : rule])))
  .digest('hex').slice(0, 16);

export function dependencyVersionUsable(name: WindowsBootstrapTool, text: string): boolean {
  if (name === 'node') {
    const match = /^v(\d+)\.(\d+)\.(\d+)/.exec(text);
    if (!match) return false;
    const [major, minor] = match.slice(1).map(Number);
    const min = WINDOWS_DEPENDENCY_REQUIREMENTS.node;
    return major! > min.major || (major === min.major && minor! >= min.minor);
  }
  return WINDOWS_DEPENDENCY_REQUIREMENTS[name].test(text);
}

/** Fixed argv, bounded output/time, no shell, credential reads or receipt-supplied arguments. */
export async function probeWindowsDependency(file: string, name: WindowsBootstrapTool): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(file, ['--version'], { timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout, stderr) => resolve(!error && dependencyVersionUsable(name, stdout + stderr)));
  });
}

/**
 * PERF-03: persistent memo of *successful* `--version` probes, keyed by the
 * executable's identity (path + size + mtime + ctime + inode). A replaced or
 * touched binary misses the cache and is probed again; failures are never
 * cached, so a slow/flaky probe cannot hide a tool.
 */
export interface WindowsProbeCache {
  has(key: string): boolean;
  add(key: string): void;
}

export const WINDOWS_PROBE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROBE_CACHE_VERSION = 1;

export function windowsProbeCacheKey(kind: string, file: string, stat: { size: number; mtimeMs: number; ctimeMs: number; ino: number | bigint }): string {
  return [kind, path.normalize(file).toLowerCase(), stat.size, stat.mtimeMs, stat.ctimeMs, String(stat.ino)].join('|');
}

/** Namespace folded into every probe-cache key: app build + acceptance rules. */
export function windowsProbeCacheSalt(appVersion?: string | null): string {
  return `app=${appVersion || 'unknown'}|req=${WINDOWS_PROBE_REQUIREMENTS_HASH}`;
}

/**
 * JSON-file backed probe cache. `load()` is a single small read; `flush()`
 * writes only when entries were added or pruned. Every key is prefixed with
 * {@link windowsProbeCacheSalt} (app version + requirements hash), so an app
 * update or a raised minimum never reuses an older "usable" verdict; entries
 * from other salts are pruned on load. Never throws.
 */
export function createFileProbeCache(file: string, options: { now?: () => number; ttlMs?: number; appVersion?: string | null } = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? WINDOWS_PROBE_CACHE_TTL_MS;
  const salt = windowsProbeCacheSalt(options.appVersion);
  const salted = (key: string) => `${salt}|${key}`;
  let entries = new Map<string, number>();
  let dirty = false;
  return {
    salt,
    async load(): Promise<void> {
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        if (parsed?.version !== PROBE_CACHE_VERSION || typeof parsed.entries !== 'object' || !parsed.entries) return;
        const t = now();
        const all = Object.entries(parsed.entries as Record<string, unknown>);
        entries = new Map(all.filter((pair): pair is [string, number] =>
          pair[0].startsWith(`${salt}|`) && typeof pair[1] === 'number' && t - pair[1] <= ttlMs && pair[1] <= t));
        if (entries.size !== all.length) dirty = true; // prune stale salts/expired entries on next flush
      } catch { entries = new Map(); }
    },
    has(key: string): boolean { return entries.has(salted(key)); },
    add(key: string): void { const k = salted(key); if (!entries.has(k)) { entries.set(k, now()); dirty = true; } },
    async flush(): Promise<void> {
      if (!dirty) return;
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify({ version: PROBE_CACHE_VERSION, entries: Object.fromEntries(entries) }), 'utf8');
        await fs.rename(tmp, file);
        dirty = false;
      } catch { /* cache is best effort */ }
    },
  };
}
export type FileProbeCache = ReturnType<typeof createFileProbeCache>;

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
  /** Optional persistent memo of successful probes (see WindowsProbeCache). */
  probeCache?: WindowsProbeCache;
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
    // Read one regular descriptor with a hard byte cap, even if the path is
    // replaced or the file grows while it is read. No receipt-supplied code runs.
    const handle = await fs.open(receiptFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      const entry = await fs.lstat(receiptFile);
      if (!stat.isFile() || entry.isSymbolicLink() || entry.dev !== stat.dev || entry.ino !== stat.ino || stat.size > 64 * 1024) {
        throw new Error('replaced/oversized/non-file receipt');
      }
      const bytes = Buffer.alloc(64 * 1024 + 1);
      let used = 0;
      while (used < bytes.length) {
        const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
        if (!bytesRead) break;
        used += bytesRead;
      }
      if (used > 64 * 1024) throw new Error('oversized receipt');
      // PowerShell 5.1 writes UTF-8 with BOM.
      receipt = JSON.parse(bytes.subarray(0, used).toString('utf8').replace(/^\uFEFF/, ''));
    } finally { await handle.close(); }
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
  // Excluded roots are fixed for this runtime; resolve their realpaths once
  // instead of once per PATH entry × tool × call.
  let excludedRealRoots: Promise<string[]> | null = null;
  const realExcludedRoots = () => excludedRealRoots ??= Promise.all(
    excludedRoots.map((excluded) => fs.realpath(excluded).catch(() => excluded)));
  async function isExcludedPath(directory: string): Promise<boolean> {
    const absolute = path.resolve(directory);
    const [real, realRoots] = await Promise.all([fs.realpath(absolute).catch(() => absolute), realExcludedRoots()]);
    for (let i = 0; i < excludedRoots.length; i++) {
      const excluded = excludedRoots[i]!;
      const realRoot = realRoots[i]!;
      if (absolute === excluded || contained(excluded, absolute) || real === realRoot || contained(realRoot, real)) return true;
    }
    return false;
  }
  const probeCache = options.probeCache;
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
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return false;
      if (!probeCache) return await probe(file, name);
      const key = windowsProbeCacheKey(name, file, stat);
      if (probeCache.has(key)) return true;
      const ok = await probe(file, name);
      if (ok) probeCache.add(key);
      return ok;
    } catch { return false; }
  }
  // PERF-03: tools resolve concurrently (each keeps its own PATH precedence);
  // results are applied in WINDOWS_BOOTSTRAP_TOOLS order so missingTools and
  // pathEntries stay deterministic.
  async function resolveTool(name: WindowsBootstrapTool): Promise<{ executable: string | null; isBundled: boolean }> {
    let executable: string | null = null;
    let isBundled = false;
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
            isBundled = true;
          }
        } catch { /* Removed/corrupt cache is not a usable dependency. */ }
      }
    }
    return { executable, isBundled };
  }
  const resolved = await Promise.all(WINDOWS_BOOTSTRAP_TOOLS.map(resolveTool));
  const missingTools: WindowsBootstrapTool[] = [];
  WINDOWS_BOOTSTRAP_TOOLS.forEach((name, index) => {
    const { executable, isBundled } = resolved[index]!;
    if (executable) {
      selected.set(name, executable);
      if (isBundled) bundled.add(name);
    } else missingTools.push(name);
  });
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
    let bashKey: string | null = null;
    if (probeCache) {
      try {
        bashKey = windowsProbeCacheKey('git-bash', expected, await fs.stat(expected));
        if (probeCache.has(bashKey)) return expected;
      } catch { return null; }
    }
    return new Promise<string | null>((resolve) => {
      execFile(expected, ['--noprofile', '--norc', '--version'],
        { timeout: 5_000, maxBuffer: 64 * 1024, windowsHide: true },
        (error, stdout) => {
          const ok = !error && WINDOWS_DEPENDENCY_REQUIREMENTS.gitBash.test(stdout);
          if (ok && bashKey) probeCache?.add(bashKey);
          resolve(ok ? expected : null);
        });
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
      const [files, bash] = await Promise.all([Promise.all(WINDOWS_BOOTSTRAP_TOOLS.map((tool) => findExecutable(tool))), gitBashPath()]);
      for (const file of files) if (file) dirs.add(path.dirname(file));
      if (bash) dirs.add(path.dirname(bash));
      return [...dirs];
    },
  };
}

// Registered by the host before source/MCP initialization. No disk state or env JSON.
let runtime: WindowsBootstrapRuntime | null = null;
export function setWindowsBootstrapRuntime(value: WindowsBootstrapRuntime | null): void { runtime = value; }
export function getWindowsBootstrapRuntime(): WindowsBootstrapRuntime | null { return runtime; }
