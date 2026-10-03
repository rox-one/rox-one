/**
 * Which subprocess servers packaged Electron builds copy into
 * `apps/electron/resources/` (and `dist/resources/`).
 *
 * session-mcp-server and bridge-mcp-server are unread by every registered
 * backend (anthropic / pi / omp). They are not resolved in runtime-resolver
 * and must not be staged. Future external-subprocess backends should use
 * McpPoolServer (`needsHttpPoolServer`) instead of reviving these paths.
 *
 * KEEP: pi-agent-server — PiAgent spawns `node <piServerPath>`.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

export const SKILL_DEVELOPMENT_DIRECTORIES = new Set(['node_modules', '.build', '.swiftpm', '.git']);

/** Skill test/install caches are never bundled. Subprocess runtime modules are. */
export function isSkillDevelopmentArtifact(resourcePath: string): boolean {
  const segments = resourcePath.split(/[\\/]/);
  return segments[0] === 'skills' && segments.slice(1).some(segment => SKILL_DEVELOPMENT_DIRECTORIES.has(segment));
}

function pruneSkillDevelopmentArtifacts(directory: string): void {
  if (!existsSync(directory)) return;
  if (lstatSync(directory).isSymbolicLink()) {
    rmSync(directory, { force: true });
    return;
  }
  if (!lstatSync(directory).isDirectory()) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (SKILL_DEVELOPMENT_DIRECTORIES.has(entry)) rmSync(path, { recursive: true, force: true });
    else if (lstatSync(path).isDirectory()) pruneSkillDevelopmentArtifacts(path);
  }
}

export const PACKAGED_STAGED_SUBPROCESS_SERVERS = ['pi-agent-server'] as const;

export const UNSTAGED_LEGACY_MCP_SERVERS = ['session-mcp-server', 'bridge-mcp-server'] as const;

export function shouldStagePackagedServer(serverName: string): boolean {
  return (PACKAGED_STAGED_SUBPROCESS_SERVERS as readonly string[]).includes(serverName);
}

/**
 * Copy an Electron `resources/` tree while omitting unread MCP servers.
 * Also strips leftover session/bridge dirs from a previous copy into `destDir`.
 */
export function copyElectronResourceTree(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if ((UNSTAGED_LEGACY_MCP_SERVERS as readonly string[]).includes(entry)) continue;
    cpSync(join(srcDir, entry), join(destDir, entry), {
      recursive: true,
      filter: source => !isSkillDevelopmentArtifact(relative(srcDir, source)),
    });
  }
  pruneSkillDevelopmentArtifacts(join(destDir, 'skills'));
  for (const leftover of UNSTAGED_LEGACY_MCP_SERVERS) {
    const leftoverPath = join(destDir, leftover);
    if (existsSync(leftoverPath)) {
      rmSync(leftoverPath, { recursive: true, force: true });
    }
  }
}
