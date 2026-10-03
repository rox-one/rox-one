/**
 * App-managed Windows MCP releases. Pins were checked against downloaded
 * GitHub release assets on 2026-10-03; no latest URLs or source builds run here.
 * Configs keep portable commands, while verified binaries live outside sources.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { basename, join, normalize, resolve } from 'node:path';
import { resolveConfigDir } from '../config/paths.ts';
import { downloadArtifact, ShaMismatchError } from '../toolchain/downloader.ts';
import type { LoadedSource } from './types.ts';

export type BuiltinWindowsMcpSlug = 'windows-commander' | 'windows-mcp' | 'everything-cli';

export interface BuiltinMcpBinaryRelease {
  slug: BuiltinWindowsMcpSlug;
  version: string;
  url: string;
  sha256: string;
  size: number;
  format: 'zip' | 'exe';
  executable: string;
  executableSha256: string;
}

export const BUILTIN_WINDOWS_MCP_RELEASES: readonly Readonly<BuiltinMcpBinaryRelease>[] = Object.freeze([
  Object.freeze({
    slug: 'windows-commander', version: '0.1.1', format: 'zip',
    url: 'https://github.com/exalsch/windows-commander-mcp/releases/download/v0.1.1/windows-commander-mcp-v0.1.1-win-x64.zip',
    sha256: '5c66aed0bce4b5c08f568d587a155cdc1a011e46645f4a2ff070ed9f6632e62b',
    size: 80_370_536,
    executable: 'WindowsCommander.McpServer.exe',
    executableSha256: 'aa0fc99e2ce034716893af41d0338335df215da11b0d22908267881784257337',
  }),
  Object.freeze({
    slug: 'windows-mcp', version: '0.7.1', format: 'exe',
    url: 'https://github.com/danielsimonjr/Windows-mcp/releases/download/v0.7.1/WindowsMcp.exe',
    sha256: 'acd20cc1851d593b1ddc7b9a858157709b059a03fb96bb147566478cdfde456b',
    size: 58_231_081,
    executable: 'WindowsMcp.exe',
    executableSha256: 'acd20cc1851d593b1ddc7b9a858157709b059a03fb96bb147566478cdfde456b',
  }),
]);

/** Official portable ES client. The Everything search engine is a separate prerequisite. */
export const BUILTIN_EVERYTHING_CLI_RELEASE: Readonly<BuiltinMcpBinaryRelease> = Object.freeze({
  slug: 'everything-cli', version: '1.1.0.38', format: 'zip',
  url: 'https://github.com/voidtools/ES/releases/download/1.1.0.38/ES-1.1.0.38.x64.zip',
  sha256: '5e0c70cbf4f694080c34aa7c6c745e606c16fe76a4b5423b93ebf9dc34274c99',
  size: 117_393,
  executable: 'es.exe',
  executableSha256: 'f7378761cf6e01f51c4123a485e628d70e3fea147d341f473ce2820844e5cee5',
});

export interface BuiltinMcpInstallOptions {
  configDir?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  signal?: AbortSignal;
  /** Network and extraction seams; release pins never come from source config. */
  fetchImpl?: typeof fetch;
  extractArchive?: (archivePath: string, destination: string, signal?: AbortSignal) => Promise<void>;
}

export type BuiltinMcpInstallResult = {
  status: 'installed' | 'already_installed';
  binaryPath: string;
} | {
  status: 'not_managed' | 'platform_unavailable' | 'architecture_unavailable';
};

export class BuiltinMcpInstallError extends Error {
  constructor(readonly code: 'aborted' | 'integrity' | 'download_failed' | 'extract_failed' | 'install_failed') {
    // Never expose subprocess output, request details, source env, or credentials.
    super(`Built-in MCP installation failed (${code})`);
    this.name = 'BuiltinMcpInstallError';
  }
}

export const BUILTIN_MCP_READY_MARKER = '.rox-mcp-ready.json';
const inFlight = new Map<string, Promise<BuiltinMcpInstallResult>>();

export function builtinMcpManagedCommand(release: Readonly<BuiltinMcpBinaryRelease>): string {
  return `\${CRAFT_CONFIG_DIR}/mcp-binaries/${release.slug}/${release.version}/${release.executable}`;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BuiltinMcpInstallError('aborted');
}

async function sha256(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

interface InstalledFile { path: string; size: number }
interface ReadyMarker { version: string; sha256: string; files: InstalledFile[] }

function safeRelativePath(path: string): boolean {
  return !!path && !path.includes('\\') && !path.includes(':') && !path.startsWith('/')
    && path.split('/').every(part => part !== '..' && part !== '.' && !!part);
}

async function installedFiles(root: string, signal?: AbortSignal, prefix = ''): Promise<InstalledFile[]> {
  const files: InstalledFile[] = [];
  for (const entry of await fs.readdir(join(root, prefix), { withFileTypes: true })) {
    assertNotAborted(signal);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!safeRelativePath(relative) || entry.isSymbolicLink()) throw new BuiltinMcpInstallError('integrity');
    if (entry.isDirectory()) files.push(...await installedFiles(root, signal, relative));
    else if (entry.isFile()) files.push({ path: relative, size: (await fs.stat(join(root, relative))).size });
    else throw new BuiltinMcpInstallError('integrity');
  }
  return files;
}

async function isReady(root: string, release: Readonly<BuiltinMcpBinaryRelease>, signal?: AbortSignal): Promise<boolean> {
  assertNotAborted(signal);
  try {
    if (!(await fs.lstat(root)).isDirectory()) return false;
    const markerPath = join(root, BUILTIN_MCP_READY_MARKER);
    if (!(await fs.lstat(markerPath)).isFile()) return false;
    const marker: ReadyMarker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    if (marker.version !== release.version || marker.sha256 !== release.sha256 || !Array.isArray(marker.files)) return false;
    if (!marker.files.some(file => file.path === release.executable)) return false;
    for (const file of marker.files) {
      assertNotAborted(signal);
      if (!safeRelativePath(file.path) || !Number.isSafeInteger(file.size) || file.size < 0) return false;
      const stat = await fs.lstat(join(root, file.path));
      if (!stat.isFile() || stat.size !== file.size) return false;
    }
    return await sha256(join(root, release.executable), signal) === release.executableSha256;
  } catch {
    assertNotAborted(signal);
    return false;
  }
}

/** Extract using Windows' built-in runtime; reject traversal before writing. */
async function extractWindowsZip(archivePath: string, destination: string, signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal);
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; `
    + `$dest = [IO.Path]::GetFullPath(${literal(destination)}).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar; `
    + `$zip = [IO.Compression.ZipFile]::OpenRead(${literal(archivePath)}); try { foreach ($e in $zip.Entries) { `
    + `$out = [IO.Path]::GetFullPath([IO.Path]::Combine($dest, $e.FullName)); `
    + `if (-not $out.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) -or $e.FullName.Contains(':')) { throw 'Invalid archive path' }; `
    + `if ($e.FullName.EndsWith('/') -or $e.FullName.EndsWith('\\')) { [IO.Directory]::CreateDirectory($out) | Out-Null } `
    + `else { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($out)) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $out, $false) } } } finally { $zip.Dispose() }`;
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      shell: false, windowsHide: true, stdio: 'ignore', signal,
    });
    child.on('error', () => reject(new BuiltinMcpInstallError(signal?.aborted ? 'aborted' : 'extract_failed')));
    child.on('close', code => code === 0 ? resolvePromise() : reject(new BuiltinMcpInstallError(signal?.aborted ? 'aborted' : 'extract_failed')));
  });
}

function validateRelease(release: Readonly<BuiltinMcpBinaryRelease>): void {
  if (!['windows-commander', 'windows-mcp', 'everything-cli'].includes(release.slug) || !/^\d+(\.\d+){2,3}$/.test(release.version)
    || basename(release.executable) !== release.executable || !/^[\w.-]+\.exe$/.test(release.executable)
    || !/^[a-f0-9]{64}$/.test(release.sha256) || !/^[a-f0-9]{64}$/.test(release.executableSha256)
    || !release.url.startsWith('https://github.com/') || !Number.isSafeInteger(release.size) || release.size < 1) {
    throw new BuiltinMcpInstallError('integrity');
  }
}

/**
 * Install a trusted manifest entry. Exported separately so fixture releases can
 * exercise download/verification/rollback without downloading 140 MB in tests.
 * Application entry points use ensureBuiltinMcpInstalled with the fixed pins.
 */
export async function installBuiltinMcpRelease(
  release: Readonly<BuiltinMcpBinaryRelease>, options: BuiltinMcpInstallOptions = {},
): Promise<BuiltinMcpInstallResult> {
  if ((options.platform ?? process.platform) !== 'win32') return { status: 'platform_unavailable' };
  if ((options.arch ?? process.arch) !== 'x64') return { status: 'architecture_unavailable' };
  assertNotAborted(options.signal);
  validateRelease(release);
  const parent = join(resolve(options.configDir ?? resolveConfigDir()), 'mcp-binaries', release.slug);
  const target = join(parent, release.version);
  const pending = inFlight.get(target);
  if (pending) return pending;
  const work = installRelease(release, options, parent, target);
  inFlight.set(target, work);
  try { return await work; } finally { if (inFlight.get(target) === work) inFlight.delete(target); }
}

async function installRelease(
  release: Readonly<BuiltinMcpBinaryRelease>, options: BuiltinMcpInstallOptions, parent: string, target: string,
): Promise<BuiltinMcpInstallResult> {
  const binaryPath = join(target, release.executable);
  if (await isReady(target, release, options.signal)) return { status: 'already_installed', binaryPath };
  let staging: string | undefined;
  let backup: string | undefined;
  try {
    assertNotAborted(options.signal);
    await fs.mkdir(parent, { recursive: true });
    staging = await fs.mkdtemp(join(parent, '.install-'));
    const payload = join(staging, 'payload');
    await fs.mkdir(payload);
    const archive = join(staging, release.format === 'zip' ? 'release.zip' : release.executable);
    const downloadSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(80_000)]) : AbortSignal.timeout(80_000);
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
      await downloadArtifact({
        url: release.url, dest: archive, sha256: release.sha256, size: release.size, retryDelaysMs: [],
        fetchImpl: ((url, init) => fetchImpl(url, { ...init, signal: downloadSignal })) as typeof fetch,
      });
    } catch (error) {
      throw new BuiltinMcpInstallError(downloadSignal.aborted ? 'aborted' : error instanceof ShaMismatchError ? 'integrity' : 'download_failed');
    }
    assertNotAborted(options.signal);
    if ((await fs.stat(archive)).size !== release.size) throw new BuiltinMcpInstallError('integrity');
    if (release.format === 'zip') {
      try { await (options.extractArchive ?? extractWindowsZip)(archive, payload, options.signal); }
      catch { throw new BuiltinMcpInstallError(options.signal?.aborted ? 'aborted' : 'extract_failed'); }
    } else await fs.rename(archive, join(payload, release.executable));
    const files = await installedFiles(payload, options.signal);
    if (!files.some(file => file.path === release.executable)
      || await sha256(join(payload, release.executable), options.signal) !== release.executableSha256) {
      throw new BuiltinMcpInstallError('integrity');
    }
    await fs.writeFile(join(payload, BUILTIN_MCP_READY_MARKER), JSON.stringify({ version: release.version, sha256: release.sha256, files } satisfies ReadyMarker));
    assertNotAborted(options.signal);
    // Another process may have finished while we downloaded. Keep its install.
    if (await isReady(target, release, options.signal)) return { status: 'already_installed', binaryPath };
    backup = join(parent, `.previous-${release.version}-${randomUUID()}`);
    try { await fs.rename(target, backup); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') backup = undefined; else throw error; }
    try { await fs.rename(payload, target); }
    catch (error) {
      // If restoration itself fails, leave the previous tree intact for recovery.
      if (backup) await fs.rename(backup, target).then(() => { backup = undefined; }, () => {});
      throw error;
    }
    if (backup) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
    return { status: 'installed', binaryPath };
  } catch (error) {
    if (options.signal?.aborted) throw new BuiltinMcpInstallError('aborted');
    if (error instanceof BuiltinMcpInstallError) throw error;
    throw new BuiltinMcpInstallError('install_failed');
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/** Install only app-owned default commands; custom source commands stay authoritative. */
export async function ensureBuiltinMcpInstalled(
  source: LoadedSource, options: BuiltinMcpInstallOptions = {},
): Promise<BuiltinMcpInstallResult> {
  const config = source.config;
  const release = config.slug === 'everything-mcp' ? BUILTIN_EVERYTHING_CLI_RELEASE
    : BUILTIN_WINDOWS_MCP_RELEASES.find(entry => entry.slug === config.slug);
  if (!release || config.id !== `builtin-mcp-${config.slug}` || !config.enabled || config.type !== 'mcp'
    || config.mcp?.transport !== 'stdio') return { status: 'not_managed' };
  const platform = options.platform ?? process.platform;
  const override = platform === 'win32' || platform === 'darwin' || platform === 'linux' ? config.mcp.platform?.[platform] : undefined;
  const command = config.slug === 'everything-mcp'
    ? override?.env?.ES_PATH ?? config.mcp.env?.ES_PATH
    : override?.command ?? config.mcp.command;
  const managedPath = join(resolve(options.configDir ?? resolveConfigDir()), 'mcp-binaries', release.slug, release.version, release.executable);
  if (command !== builtinMcpManagedCommand(release) && (!command || normalize(command) !== normalize(managedPath))) {
    return { status: 'not_managed' };
  }
  return installBuiltinMcpRelease(release, options);
}
