/**
 * Резолвер исполняемых файлов.
 * Приоритет: toolchain (установленные менеджером) → PATH.
 *
 * Bundled-бинарники (claude/uv/ripgrep/bun из Electron-бандла) сюда НЕ вшиты:
 * их каталоги добавляются в PATH сабпроцесса интеграционным слоем
 * (injector при спавне агента) — shared-пакет не знает layout бандла.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { TOOLCHAIN_MANIFEST } from './manifest';
import { OPENCLAW_NPM_PIN } from './npm-locks';
import { TOOLCHAIN_INSTALL_COMPLETE_MARKER } from './types';
import { executableCandidates, isExecutable, whichTool } from './exec';
import { bootstrapToolName, getWindowsBootstrapRuntime, type WindowsBootstrapRuntime } from './windows-bootstrap';
import type { ManagedOpenClawLauncher, ToolEntry, ToolchainPaths, ToolchainPlatform, ToolchainResolver } from './types';
/** Regular file contained in the real toolchain root; rejects symlink escapes. */
async function isManagedFile(
  toolchainDir: string,
  file: string,
  executable: boolean,
  win: boolean,
): Promise<boolean> {
  try {
    const [realToolchainDir, realFile] = await Promise.all([
      fs.promises.realpath(toolchainDir),
      fs.promises.realpath(file),
    ]);
    const relative = path.relative(realToolchainDir, realFile);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    const stat = await fs.promises.stat(realFile);
    if (!stat.isFile()) return false;
    if (executable && !win) await fs.promises.access(realFile, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const isWindows = process.platform === 'win32';

/** pip/git-npm generate launchers without a downloadable artifact. */
async function entryBinPaths(paths: ToolchainPaths, entry: ToolEntry, platform: ToolchainPlatform | null): Promise<string[]> {
  if (entry.platforms && platform && !entry.platforms.includes(platform)) return [];
  const artifacts = platform ? [entry.artifacts[platform]] : Object.values(entry.artifacts);
  const bins = artifacts.flatMap((artifact) => artifact?.binPaths ?? []);
  if (entry.kind === 'pip' || entry.kind === 'git-npm') {
    const dir = path.join(paths.toolchainDir, entry.name, 'current', 'bin');
    for (const file of await fs.promises.readdir(dir).catch(() => [] as string[])) {
      bins.push(path.join('bin', file));
    }
  }
  return bins;
}

export interface ResolverOptions {
  manifest?: typeof TOOLCHAIN_MANIFEST;
  /** DI вместо process.env.PATH (тесты). */
  pathEnv?: string;
  /** DI вместо process.platform (тесты win-семантики на unix). */
  platform?: NodeJS.Platform;
  windowsBootstrap?: WindowsBootstrapRuntime | null;
}

/** Собрать ссылку toolchain/<tool>/current → пути кандидатов по binPaths манифеста. */
async function toolchainCandidates(
  paths: ToolchainPaths,
  manifest: typeof TOOLCHAIN_MANIFEST,
  name: string,
  win = isWindows,
  platform: ToolchainPlatform | null = null,
): Promise<string[]> {
  const normalized = win ? name.toLowerCase() : name;
  const baseNames = new Set(executableCandidates(normalized, win));
  const found: string[] = [];
  for (const entry of manifest) {
    const bins = await entryBinPaths(paths, entry, platform);
    const primary = entry.systemBinary ?? (entry.kind === 'git-npm'
      ? entry.name
      : bins[0] && path.basename(bins[0]).replace(/\.(exe|com|cmd|bat)$/i, ''));
    for (const binRel of bins) {
      const base = win ? path.basename(binRel).toLowerCase() : path.basename(binRel);
      // A catalog name may alias its primary CLI (worktrunk → wt), never a
      // companion binary (missing node must not resolve to npx).
      const alias = (entry.name === normalized || (entry.name === 'python' && normalized === 'python3')) &&
        base.replace(/\.(exe|com|cmd|bat)$/i, '') === primary;
      if (!baseNames.has(base) && !alias) continue;
      if (win && !/\.(exe|com|cmd|bat)$/i.test(base)) continue;
      found.push(path.join(paths.toolchainDir, entry.name, 'current', binRel));
    }
  }
  return found;
}

export function createResolver(
  paths: ToolchainPaths,
  opts: ResolverOptions = {},
): ToolchainResolver {
  const manifest = opts.manifest ?? TOOLCHAIN_MANIFEST;
  const win = (opts.platform ?? process.platform) === 'win32';
  const bootstrap = () => win ? (opts.windowsBootstrap === undefined ? getWindowsBootstrapRuntime() : opts.windowsBootstrap) : null;
  // Текущая платформа в терминах манифеста: бинарники других платформ в
  // resolver/PATH-prefix не протекают (P3: раньше Object.values брал всех).
  const platName = opts.platform ?? process.platform;
  const platArch = process.arch;
  const platformKey: ToolchainPlatform | null =
    platName === 'darwin'
      ? platArch === 'arm64'
        ? 'darwin-arm64'
        : 'darwin-x64'
      : platName === 'win32'
        ? 'win32-x64'
        : platName === 'linux'
          ? 'linux-x64'
          : null;

  async function resolveExecutable(name: string): Promise<string | null> {
      if (name === 'openclaw' || (win && /^openclaw\.(exe|cmd|bat)$/i.test(name))) return null;
      const native = bootstrap();
      if (native && /^bash(\.exe)?$/i.test(name)) return native.gitBashPath();
      // system excludes private/managed prerequisites. auto is system-first;
      // otherwise installer files are a bundled fallback after managed tooling.
      if (native && bootstrapToolName(name) &&
          (native.mode === 'system' || (native.mode === 'auto' && native.source(name) === 'system'))) {
        return native.findExecutable(name);
      }
      // 1) toolchain: <toolchainDir>/<tool>/current/<binPath>
      for (const candidate of await toolchainCandidates(paths, manifest, name, win, platformKey)) {
        if (native && bootstrapToolName(name) === 'node') {
          const directory = path.dirname(candidate);
          if (!(await Promise.all(['node.exe', 'npm.cmd', 'npx.cmd'].map((bin) => isExecutable(path.join(directory, bin), true)))).every(Boolean)) continue;
        }
        if (await isExecutable(candidate, win)) return candidate;
      }
      if (native && bootstrapToolName(name)) return native.findExecutable(name);
      // 2) PATH
      return whichTool(name, opts.pathEnv, win);
  }

  return {
    findExecutable: resolveExecutable,

    async resolveOpenClawLauncher(): Promise<ManagedOpenClawLauncher | null> {
      // This deliberately does not use `findExecutable`: generic resolution can
      // consult PATH, while OpenClaw must only use its exact managed installation.
      if (!platformKey) return null;
      const nodeEntry = manifest.find((entry) => entry.name === 'node' && entry.version === '22.23.2');
      const openclawEntry = manifest.find(
        (entry) =>
          entry.name === 'openclaw' &&
          entry.kind === 'npm' &&
          entry.version === OPENCLAW_NPM_PIN.version,
      );
      const nodeArtifact = nodeEntry?.artifacts[platformKey];
      const openclawArtifact = openclawEntry?.artifacts[platformKey];
      const nodeBinPath = nodeArtifact?.binPaths.find(
        (binPath) => path.basename(binPath) === (win ? 'node.exe' : 'node'),
      );
      if (
        !nodeEntry ||
        !nodeBinPath ||
        !openclawEntry ||
        !openclawArtifact ||
        !openclawArtifact.binPaths.includes(`package/${OPENCLAW_NPM_PIN.entrypoint}`) ||
        openclawArtifact.url !== OPENCLAW_NPM_PIN.tarballUrl ||
        openclawArtifact.sha256 !== OPENCLAW_NPM_PIN.tarballSha256
      ) {
        return null;
      }

      const nodeVersionDir = path.join(paths.toolchainDir, 'node', nodeEntry.version);
      const nodeCurrentDir = path.join(paths.toolchainDir, 'node', 'current');
      const openclawVersionDir = path.join(paths.toolchainDir, 'openclaw', openclawEntry.version);
      const openclawCurrentDir = path.join(paths.toolchainDir, 'openclaw', 'current');
      const executablePath = path.join(nodeVersionDir, nodeBinPath);
      const entrypointPath = path.join(openclawVersionDir, 'package', OPENCLAW_NPM_PIN.entrypoint);

      try {
        const [realNodeVersion, realNodeCurrent, realOpenclawVersion, realOpenclawCurrent, nodeMarker, openclawMarker] =
          await Promise.all([
            fs.promises.realpath(nodeVersionDir),
            fs.promises.realpath(nodeCurrentDir),
            fs.promises.realpath(openclawVersionDir),
            fs.promises.realpath(openclawCurrentDir),
            fs.promises.readFile(path.join(nodeCurrentDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), 'utf8'),
            fs.promises.readFile(path.join(openclawCurrentDir, TOOLCHAIN_INSTALL_COMPLETE_MARKER), 'utf8'),
          ]);
        if (
          nodeMarker !== `node@${nodeEntry.version}\n` ||
          openclawMarker !== `openclaw@${openclawEntry.version}\n` ||
          (!win && (realNodeCurrent !== realNodeVersion || realOpenclawCurrent !== realOpenclawVersion))
        ) {
          return null;
        }
      } catch {
        return null;
      }

      const [hasManagedNode, hasManagedEntrypoint] = await Promise.all([
        isManagedFile(paths.toolchainDir, executablePath, true, win),
        isManagedFile(paths.toolchainDir, entrypointPath, false, win),
      ]);
      if (!hasManagedNode || !hasManagedEntrypoint) return null;

      return {
        executablePath,
        argsPrefix: [entrypointPath] as const,
        version: OPENCLAW_NPM_PIN.version,
      };
    },

    /** Префикс PATH для сабпроцессов агентов: bin-директории установленных инструментов. */
    async toolchainPathPrefix(): Promise<string> {
      const dirs = new Set<string>();
      const native = bootstrap();
      // OpenClaw не попадает в PATH-префикс: только точный managed-лаунчер.
      for (const entry of manifest) {
        if (entry.name === 'openclaw') continue;
        if (native && bootstrapToolName(entry.name)) continue;
        for (const binRel of await entryBinPaths(paths, entry, platformKey)) {
          const file = path.join(paths.toolchainDir, entry.name, 'current', binRel);
          if (win && !/\.(exe|com|cmd|bat)$/i.test(file)) continue;
          if (await isExecutable(file, win)) dirs.add(path.dirname(file));
        }
      }
      if (native) {
        for (const name of ['gh', 'git', 'node', 'jq', 'yq', 'bash']) {
          const file = await resolveExecutable(name);
          if (file) dirs.add(path.dirname(file));
        }
      }
      return [...dirs].join(win ? ';' : ':');
    },

    toolchainDir(): string {
      return paths.toolchainDir;
    },
  };
}
