import { mkdir, readFile, writeFile, realpath, open, readdir, readlink, symlink, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative, isAbsolute, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { seedSourceToolchainRoot } from './rox-readiness-ui-001.source-toolchain.ts'

const profile = process.env.ROX_CONFIG_DIR
if (!profile || !profile.includes('rox-readiness-ui-001-')) throw new Error('Explicit disposable UI-001 profile required')

// Copy real, revision-pinned core tools into the owned profile. No completion
// marker or installed binary is fabricated and the host store is read-only.
async function cloneRuntime() {
  if (process.platform !== 'darwin') throw new Error('This native execution lane currently requires macOS')
  const { TOOLCHAIN_MANIFEST, currentPlatform, toolchainPaths } = await import('../../packages/shared/src/toolchain/manifest')
  const { TOOLCHAIN_INSTALL_COMPLETE_MARKER } = await import('@rox/shared/toolchain/types')
  // W1-13: the host toolchain (read-only source), never the disposable profile.
  const originalRoot = seedSourceToolchainRoot(process.env, homedir())
  const originalBytes = await readFile(join(originalRoot, 'state.json'))
  const original = JSON.parse(originalBytes.toString())
  const paths = toolchainPaths(profile!)
  const isolated: { tools: Record<string, unknown> } = { tools: {} }
  const proof: unknown[] = []
  await mkdir(paths.toolchainDir, { recursive: true })
  for (const entry of TOOLCHAIN_MANIFEST.filter(tool => (tool.tier ?? 'core') === 'core')) {
    const artifact = entry.artifacts[currentPlatform()]
    if (!artifact) continue
    const source = join(originalRoot, entry.name, entry.version)
    const installed = original.tools[entry.name]
    if (!installed || installed.installedVersion !== entry.version || await realpath(installed.installedPath) !== await realpath(source)) {
      throw new Error(`Genuine pinned runtime is absent: ${entry.name}@${entry.version}`)
    }
    const marker = artifact.archive === 'uv-python' ? null : await readFile(join(source, TOOLCHAIN_INSTALL_COMPLETE_MARKER), 'utf8')
    if (marker !== null && marker !== `${entry.name}@${entry.version}\n`) throw new Error(`Invalid genuine marker: ${entry.name}`)
    const destination = join(paths.toolchainDir, entry.name, entry.version)
    await mkdir(dirname(destination), { recursive: true })
    const child = Bun.spawn(['/bin/cp', '-cRp', source, destination], { stdout: 'pipe', stderr: 'pipe' })
    const diagnostic = await new Response(child.stderr).text()
    if (await child.exited !== 0) throw new Error(`APFS runtime copy failed: ${diagnostic}`)
    const links: { path: string; previous: string; current: string }[] = []
    async function relocate(directory: string): Promise<void> {
      for (const file of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, file.name)
        if (file.isDirectory()) await relocate(path)
        if (!file.isSymbolicLink()) continue
        const previous = await readlink(path)
        if (!isAbsolute(previous)) continue
        const bound = relative(source, previous)
        if (bound === '..' || bound.startsWith('../')) throw new Error(`Runtime link escapes copied installation: ${path}`)
        const current = relative(dirname(path), join(destination, bound))
        await unlink(path)
        await symlink(current, path)
        links.push({ path: relative(destination, path), previous, current })
      }
    }
    await relocate(destination)
    const executables = []
    for (const bin of artifact.binPaths) {
      const originalBin = await realpath(join(source, bin))
      const copiedBin = await realpath(join(destination, bin))
      if (!copiedBin.startsWith((await realpath(destination)) + '/')) {
        throw new Error(`Copied executable is not isolated: ${entry.name}/${bin}`)
      }
      const before = createHash('sha256').update(await readFile(originalBin)).digest('hex')
      // Validate and hash one opened object. O_NOFOLLOW rejects replacement
      // with a symlink; fstat/read on this handle cannot race a pathname reopen.
      const handle = await open(copiedBin, constants.O_RDONLY | constants.O_NOFOLLOW)
      let after: string
      try {
        const metadata = await handle.stat()
        if (!metadata.isFile() || (metadata.mode & 0o111) === 0) {
          throw new Error(`Copied executable is not a regular executable: ${entry.name}/${bin}`)
        }
        after = createHash('sha256').update(await handle.readFile()).digest('hex')
      } finally {
        await handle.close()
      }
      if (before !== after) throw new Error(`Copied executable bytes differ: ${entry.name}/${bin}`)
      executables.push({ bin, sha256: before })
    }
    await symlink(entry.version, join(paths.toolchainDir, entry.name, 'current'))
    isolated.tools[entry.name] = { ...installed, installedPath: destination }
    proof.push({ name: entry.name, version: entry.version, source, destination, genuineMarker: marker, executables, relocatedInternalLinks: links })
  }
  if (!originalBytes.equals(await readFile(join(originalRoot, 'state.json')))) throw new Error('Host runtime state changed during read-only clone')
  await writeFile(paths.stateFile, JSON.stringify(isolated, null, 2), { mode: 0o600, flag: 'wx' })
  return proof
}

const runtime = await cloneRuntime()
const config = await import('@rox/shared/config')
const workspaces = await import('@rox/shared/workspaces')
const sessions = await import('@rox/shared/sessions')
const projects = await import('@rox/shared/projects')
const pages = await import('@rox/shared/pages')
const sources = await import('@rox/shared/sources')
const { TOOLCHAIN_MANIFEST } = await import('../../packages/shared/src/toolchain/manifest')

config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, setupDeferred: true,
  defaultZoomLevel: 100, notificationsEnabled: false, memory: { enabled: false, semantic: false },
  toolchain: { disabled: TOOLCHAIN_MANIFEST.map(tool => tool.name) } })
const workspaceRoot = join(profile, 'workspaces', 'ui-001')
const noteRoot = join(profile, 'notes')
await mkdir(noteRoot, { recursive: true })
const folder = workspaces.createWorkspaceAtPath(workspaceRoot, 'UI-001 acceptance', { workingDirectory: workspaceRoot },
  { id: 'ws_ui001_fixture', slug: 'ui-001', kind: 'personal' })
await workspaces.saveWorkspaceConfig(workspaceRoot, { ...folder, notesPath: noteRoot })
// New workspaces genuinely seed builtins. Disable every seed-owned source
// before native boot so route proof never starts provider or MCP diagnostics.
const disabledSeedSources = sources.loadWorkspaceSources(workspaceRoot).map(source => {
  sources.saveSourceConfig(workspaceRoot, { ...source.config, enabled: false })
  return source.config.slug
})
const workspace = config.addWorkspace({ name: folder.name, rootPath: workspaceRoot, kind: 'personal' })
const sessionA = await sessions.createSession(workspaceRoot, { name: 'UI001 session A', workingDirectory: workspaceRoot })
const sessionB = await sessions.createSession(workspaceRoot, { name: 'UI001 session B', workingDirectory: workspaceRoot })
const project = projects.createProject(workspaceRoot, { name: 'UI001 project', description: 'UI001 canonical project description', workingDirectory: workspaceRoot })
const page = pages.createPage(workspaceRoot, { name: 'UI001 page', content: '<!doctype html><html><body><h1>UI001 canonical page body</h1></body></html>' })
const source = await sources.createSource(workspaceRoot, { name: 'UI001 local source', provider: 'local', type: 'local', local: { path: workspaceRoot }, enabled: false })
if (sources.getEnabledSources(workspaceRoot).length !== 0) throw new Error('Seed has enabled sources; provider-free route proof cannot start')
const skillSlug = 'ui001-workspace-skill'
await mkdir(join(workspaceRoot, 'skills', skillSlug), { recursive: true })
await writeFile(join(workspaceRoot, 'skills', skillSlug, 'SKILL.md'), '---\nname: UI001 skill\ndescription: Disposable native selection acceptance\n---\n\nUI001 canonical skill body.\n')
await writeFile(join(noteRoot, 'ui001-note.md'), '---\ntitle: UI001 note\n---\n\n# UI001 note\n\nUI001 canonical note body.\n')
const stored = config.loadStoredConfig()!
stored.activeWorkspaceId = workspace.id
stored.activeSessionId = sessionA.id
config.saveConfig(stored)
console.log(JSON.stringify({ profile, workspaceId: workspace.id, workspaceSlug: workspace.slug, workspaceRoot, noteRoot,
  sessionA: sessionA.id, sessionB: sessionB.id, projectSlug: project.slug, pageSlug: page.slug, sourceSlug: source.slug, skillSlug,
  noteId: 'ui001-note', runtime, disabledSeedSources }))
