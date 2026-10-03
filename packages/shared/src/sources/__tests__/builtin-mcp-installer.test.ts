import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_MCP_READY_MARKER,
  BUILTIN_EVERYTHING_CLI_RELEASE,
  BUILTIN_WINDOWS_MCP_RELEASES,
  BuiltinMcpInstallError,
  builtinMcpManagedCommand,
  ensureBuiltinMcpInstalled,
  installBuiltinMcpRelease,
  type BuiltinMcpBinaryRelease,
  type BuiltinMcpInstallOptions,
} from '../builtin-mcp-installer.ts';
import type { LoadedSource } from '../types.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const executable = Buffer.from('MZ fixture executable');
const archive = Buffer.from('fixture archive bytes');

function fixtureRelease(format: 'zip' | 'exe' = 'exe'): BuiltinMcpBinaryRelease {
  const data = format === 'exe' ? executable : archive;
  return {
    slug: 'windows-mcp', version: '1.2.3',
    url: 'https://github.com/test/fixture/releases/download/v1.2.3/WindowsMcp.exe',
    sha256: digest(data), size: data.length, format,
    executable: 'WindowsMcp.exe', executableSha256: digest(executable),
  };
}

async function options(extra: BuiltinMcpInstallOptions = {}): Promise<BuiltinMcpInstallOptions> {
  const configDir = await fs.mkdtemp(join(tmpdir(), 'rox-mcp-installer-'));
  roots.push(configDir);
  return { configDir, platform: 'win32', arch: 'x64', ...extra };
}

function response(data: Uint8Array): typeof fetch {
  return (async () => new Response(data)) as unknown as typeof fetch;
}

function source(slug: 'windows-commander' | 'windows-mcp' = 'windows-mcp'): LoadedSource {
  const release = BUILTIN_WINDOWS_MCP_RELEASES.find(entry => entry.slug === slug)!;
  return {
    config: {
      id: `builtin-mcp-${slug}`, slug, name: slug, enabled: true, provider: slug, type: 'mcp',
      mcp: { transport: 'stdio', command: builtinMcpManagedCommand(release), args: [], env: { SECRET_TOKEN: 'do-not-leak-this' } },
      createdAt: 1, updatedAt: 1,
    },
    workspaceId: 'test', workspaceRootPath: '/workspace', folderPath: '/workspace/sources/test', guide: null,
  };
}

describe('verified built-in Windows MCP installation', () => {
  it('uses immutable versioned release metadata and portable catalog commands', () => {
    for (const release of BUILTIN_WINDOWS_MCP_RELEASES) {
      expect(release.url).toContain(`/releases/download/v${release.version}/`);
      expect(release.url).not.toContain('/latest/');
      expect(release.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Object.isFrozen(release)).toBe(true);
      expect(builtinMcpManagedCommand(release)).toBe(`\${CRAFT_CONFIG_DIR}/mcp-binaries/${release.slug}/${release.version}/${release.executable}`);
    }
  });

  it('installs a verified executable, records readiness, and reuses the existing tree', async () => {
    const release = fixtureRelease();
    let downloads = 0;
    const opts = await options({ fetchImpl: (async () => { downloads++; return new Response(executable); }) as unknown as typeof fetch });
    const result = await installBuiltinMcpRelease(release, opts);
    expect(result.status).toBe('installed');
    if (!('binaryPath' in result)) throw new Error('binary path missing');
    expect(await fs.readFile(result.binaryPath)).toEqual(executable);
    const marker = join(opts.configDir!, 'mcp-binaries', release.slug, release.version, BUILTIN_MCP_READY_MARKER);
    const before = await fs.readFile(marker, 'utf8');
    expect(JSON.parse(before).sha256).toBe(release.sha256);
    expect((await installBuiltinMcpRelease(release, opts)).status).toBe('already_installed');
    expect(await fs.readFile(marker, 'utf8')).toBe(before);
    expect(downloads).toBe(1);
  });

  it('downloads and verifies an archive before extraction and checks its known executable', async () => {
    const release = fixtureRelease('zip');
    let extractionCalls = 0;
    const opts = await options({ fetchImpl: response(archive), extractArchive: async (archivePath, destination) => {
      extractionCalls++;
      expect(await fs.readFile(archivePath)).toEqual(archive);
      await fs.writeFile(join(destination, release.executable), executable);
      await fs.writeFile(join(destination, 'runtime.dll'), 'runtime');
    } });
    expect((await installBuiltinMcpRelease(release, opts)).status).toBe('installed');
    expect(extractionCalls).toBe(1);
    const root = join(opts.configDir!, 'mcp-binaries', release.slug, release.version);
    expect(await fs.readFile(join(root, 'runtime.dll'), 'utf8')).toBe('runtime');
    await fs.rm(join(root, 'runtime.dll'));
    expect((await installBuiltinMcpRelease(release, opts)).status).toBe('installed');
    expect(extractionCalls).toBe(2);
  });

  it('rejects a corrupt download before extraction and removes staging files', async () => {
    const release = fixtureRelease('zip');
    let extracted = false;
    const opts = await options({ fetchImpl: response(Buffer.from('untrusted bytes')), extractArchive: async () => { extracted = true; } });
    await expect(installBuiltinMcpRelease(release, opts)).rejects.toMatchObject({ code: 'integrity' });
    expect(extracted).toBe(false);
    expect(await fs.readdir(join(opts.configDir!, 'mcp-binaries', release.slug))).toEqual([]);
  });

  it('preserves a prior install when extraction fails or yields a different executable', async () => {
    const release = fixtureRelease('zip');
    const opts = await options({ fetchImpl: response(archive) });
    const prior = join(opts.configDir!, 'mcp-binaries', release.slug, release.version);
    await fs.mkdir(prior, { recursive: true });
    await fs.writeFile(join(prior, 'user-file.txt'), 'preserve');
    await expect(installBuiltinMcpRelease(release, { ...opts, extractArchive: async () => {
      throw new Error('SECRET_TOKEN=do-not-leak-this');
    } })).rejects.toMatchObject({ code: 'extract_failed' });
    await expect(installBuiltinMcpRelease(release, { ...opts, extractArchive: async (_, destination) => {
      await fs.writeFile(join(destination, release.executable), 'incorrect binary');
    } })).rejects.toMatchObject({ code: 'integrity' });
    expect(await fs.readFile(join(prior, 'user-file.txt'), 'utf8')).toBe('preserve');
    expect(await fs.readdir(prior)).toEqual(['user-file.txt']);
  });

  it('rejects extracted symlinks without publishing a ready marker', async () => {
    const release = fixtureRelease('zip');
    const opts = await options({ fetchImpl: response(archive), extractArchive: async (_, destination) => {
      await fs.writeFile(join(destination, release.executable), executable);
      await fs.symlink('/outside', join(destination, 'escape'));
    } });
    await expect(installBuiltinMcpRelease(release, opts)).rejects.toMatchObject({ code: 'integrity' });
    expect(await fs.readdir(join(opts.configDir!, 'mcp-binaries', release.slug))).toEqual([]);
  });

  it('avoids network and filesystem writes on unsupported platforms or architecture', async () => {
    let downloads = 0;
    const opts = await options({ fetchImpl: (async () => { downloads++; throw new Error('unexpected'); }) as unknown as typeof fetch });
    expect((await ensureBuiltinMcpInstalled(source(), { ...opts, platform: 'linux' })).status).toBe('platform_unavailable');
    expect((await ensureBuiltinMcpInstalled(source(), { ...opts, arch: 'arm64' })).status).toBe('architecture_unavailable');
    expect(await fs.readdir(opts.configDir!)).toEqual([]);
    expect(downloads).toBe(0);
  });

  it('preserves disabled, non-owned, and user command overrides including platform overrides', async () => {
    const opts = await options({ fetchImpl: (async () => { throw new Error('unexpected'); }) as unknown as typeof fetch });
    for (const edit of [
      (item: LoadedSource) => { item.config.enabled = false; },
      (item: LoadedSource) => { item.config.id = 'user-windows-mcp'; },
      (item: LoadedSource) => { item.config.mcp!.command = 'C:/custom/WindowsMcp.exe'; },
      (item: LoadedSource) => { item.config.mcp!.platform = { win32: { command: 'C:/custom/WindowsMcp.exe' } }; },
    ]) {
      const item = source(); edit(item);
      const before = JSON.stringify(item);
      expect((await ensureBuiltinMcpInstalled(item, opts)).status).toBe('not_managed');
      expect(JSON.stringify(item)).toBe(before);
    }
    expect(await fs.readdir(opts.configDir!)).toEqual([]);
  });

  it('selects the verified portable ES prerequisite and preserves custom ES_PATH', async () => {
    let requestedUrl = '';
    const opts = await options({ fetchImpl: (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response('not the trusted release');
    }) as unknown as typeof fetch });
    const item = source();
    item.config.slug = 'everything-mcp';
    item.config.id = 'builtin-mcp-everything-mcp';
    item.config.mcp!.command = 'bun';
    item.config.mcp!.env = { ES_PATH: builtinMcpManagedCommand(BUILTIN_EVERYTHING_CLI_RELEASE) };
    const before = JSON.stringify(item);
    await expect(ensureBuiltinMcpInstalled(item, opts)).rejects.toMatchObject({ code: 'integrity' });
    expect(requestedUrl).toBe(BUILTIN_EVERYTHING_CLI_RELEASE.url);
    expect(JSON.stringify(item)).toBe(before);
    item.config.mcp!.env.ES_PATH = 'C:/Existing/Everything/es.exe';
    requestedUrl = '';
    expect((await ensureBuiltinMcpInstalled(item, opts)).status).toBe('not_managed');
    expect(requestedUrl).toBe('');
  });

  it('coalesces simultaneous workspace requests for the same managed release', async () => {
    let downloads = 0;
    const opts = await options({ fetchImpl: (async () => { downloads++; return new Response(executable); }) as unknown as typeof fetch });
    const release = fixtureRelease();
    const results = await Promise.all([installBuiltinMcpRelease(release, opts), installBuiltinMcpRelease(release, opts)]);
    expect(results[0]).toEqual(results[1]);
    expect(downloads).toBe(1);
  });

  it('passes cancellation to fetch and never exposes network credentials in errors', async () => {
    const controller = new AbortController();
    const opts = await options({ signal: controller.signal, fetchImpl: (async (_: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      controller.abort();
      throw new Error('Authorization: Bearer do-not-leak-this');
    }) as unknown as typeof fetch });
    try {
      await installBuiltinMcpRelease(fixtureRelease(), opts);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BuiltinMcpInstallError);
      expect((error as BuiltinMcpInstallError).code).toBe('aborted');
      expect(String(error)).not.toContain('do-not-leak-this');
      expect((error as Error).cause).toBeUndefined();
    }
    expect(await fs.readdir(join(opts.configDir!, 'mcp-binaries', 'windows-mcp'))).toEqual([]);
  });

  it('does not publish a release cancelled during extraction', async () => {
    const controller = new AbortController();
    const opts = await options({ signal: controller.signal, fetchImpl: response(archive), extractArchive: async (_, destination, signal) => {
      expect(signal).toBe(controller.signal);
      await fs.writeFile(join(destination, 'WindowsMcp.exe'), executable);
      controller.abort();
    } });
    await expect(installBuiltinMcpRelease(fixtureRelease('zip'), opts)).rejects.toMatchObject({ code: 'aborted' });
    expect(await fs.readdir(join(opts.configDir!, 'mcp-binaries', 'windows-mcp'))).toEqual([]);
  });
});
