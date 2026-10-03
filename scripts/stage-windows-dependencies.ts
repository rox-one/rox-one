/** Offline NSIS payload, sourced from the runtime's pins (never from the build host PATH). */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MANIFEST_DATA } from '../packages/shared/src/toolchain/manifest-data';
import { WINDOWS_GIT_BASH_PIN } from '../packages/shared/src/toolchain/windows-git-bash-pin';

export const WINDOWS_INSTALLER_TOOLS = ['gh', 'git', 'node', 'jq', 'yq'] as const;

export function windowsDependencyManifest() {
  return {
    schemaVersion: 1,
    platform: 'win32-x64',
    optionalGitBash: WINDOWS_GIT_BASH_PIN,
    tools: WINDOWS_INSTALLER_TOOLS.map((name) => {
      const entry = MANIFEST_DATA[name];
      const artifact = entry?.artifacts['win32-x64'];
      if (!entry || !artifact || !['zip', 'raw'].includes(artifact.archive)
        || !/^[a-f0-9]{64}$/i.test(artifact.sha256) || !artifact.url.startsWith('https://')) {
        throw new Error(`Missing pinned Windows installer artifact: ${name}`);
      }
      return {
        name, version: entry.version, ...artifact,
        payload: `${name}-${entry.version}.${artifact.archive === 'zip' ? 'zip' : 'exe'}`,
      };
    }),
  };
}

export function verifyDependencyPayload(bytes: Uint8Array, artifact: { sha256: string; size: number }): void {
  if (bytes.byteLength !== artifact.size
    || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256.toLowerCase()) {
    throw new Error('Windows dependency payload size/SHA256 mismatch');
  }
}

export async function stageWindowsDependencies(outDir: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const manifest = windowsDependencyManifest();
  mkdirSync(outDir, { recursive: true });
  for (const tool of [...manifest.tools, manifest.optionalGitBash]) {
    const dest = join(outDir, tool.payload);
    if (existsSync(dest)) {
      try { verifyDependencyPayload(readFileSync(dest), tool); continue; } catch { /* replace corrupt cache */ }
    }
    const response = await fetchImpl(tool.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${tool.url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    verifyDependencyPayload(bytes, tool);
    const pending = `${dest}.pending-${randomUUID()}`;
    try {
      writeFileSync(pending, bytes, { flag: 'wx', mode: 0o600 });
      renameSync(pending, dest);
    } finally { rmSync(pending, { force: true }); }
  }
  // A release never includes stale pins left by an earlier build.
  const { readdirSync } = await import('node:fs');
  const expected = new Set(['.gitignore', 'manifest.json', manifest.optionalGitBash.payload, ...manifest.tools.map((t) => t.payload)]);
  for (const file of readdirSync(outDir)) {
    if (!expected.has(file)) rmSync(join(outDir, file), { recursive: true, force: true });
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

if (import.meta.main) {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('Usage: bun scripts/stage-windows-dependencies.ts <payload-directory>');
  await stageWindowsDependencies(resolve(outDir));
}
