/**
 * Memory Repository Tool Runtime — the seam between the memory-repo session
 * tools (memory_repo_read / memory_repo_search) and the process-wide memory
 * repository runtime (`MemoryRepoService`, Wave A §7 of
 * docs/plans/2026-10-09-memory-repository-and-dreaming.md).
 *
 * This package is deliberately free of the repository implementation (that lives
 * in server-core `memory/repo/*`, over `@rox/shared/memory/repo`): the runtime is
 * REGISTERED by the memory-repo RPC layer (`registerMemoryRepoHandlers`), which
 * closes over `getMemoryRepoRuntime()` — the same object the `memory:repo*`
 * channels serve. Agent backends execute session-tool handlers in that same
 * process, so one registration covers all of them.
 *
 * In processes without the memory-repo layer (e.g. the Codex session-mcp-server
 * subprocess), no runtime is registered and the handlers answer with a typed
 * MEMORY_REPO_UNAVAILABLE error — never a hang, never a raw throw.
 *
 * Structural types only: this module must stay dependency-free of @rox/shared,
 * so the adapter in server-core supplies the concrete MemoryRepoService shapes.
 */

export interface MemoryRepoBankRef {
  /** `main` | `main#<ownerKey8>` | `ws:<workspaceId>` | `ws:<workspaceId>#<ownerKey8>`. */
  id: string
  scope: 'main' | 'workspace'
  label: string
  repoPath: string
  isMain: boolean
}

/** One node of a bank's repository file tree (flat, with depth). */
export interface MemoryRepoTreeEntry {
  path: string
  name: string
  type: 'file' | 'dir'
  depth: number
}

/** A repository file's text content, as read by MemoryRepoService.readFile. */
export interface MemoryRepoFileView {
  path: string
  content: string
  /** True when the service itself capped the content (READ_FILE_LIMIT). */
  truncated: boolean
  edited: boolean
  /** Frontmatter `id:` when the file carries one (lesson files). */
  lessonId?: string
}

/** The narrow surface the memory-repo tool handlers use. */
export interface MemoryRepoToolRuntime {
  listBanks(): Promise<MemoryRepoBankRef[]>
  tree(bankId: string): Promise<MemoryRepoTreeEntry[]>
  readFile(bankId: string, path: string): Promise<MemoryRepoFileView>
  /**
   * Workspace id owning a session's workspace folder, or null when the path is
   * not a known workspace. Session tools run as the local user, so handlers
   * restrict every bank address to this workspace's bank plus the local `main`
   * bank — a session bound to workspace A must never read workspace B's bank.
   */
  resolveWorkspaceId(workspacePath: string): string | null
}

let registeredRuntime: MemoryRepoToolRuntime | null = null

/** Register the process-wide memory-repo tool runtime. Last registration wins (server reload). */
export function registerMemoryRepoToolRuntime(runtime: MemoryRepoToolRuntime): void {
  registeredRuntime = runtime
}

/** The registered runtime, or null when the memory-repo layer is absent in this process. */
export function getMemoryRepoToolRuntime(): MemoryRepoToolRuntime | null {
  return registeredRuntime
}

/** Test seam: drop the registration (afterEach) so suites don't leak into each other. */
export function clearMemoryRepoToolRuntime(): void {
  registeredRuntime = null
}