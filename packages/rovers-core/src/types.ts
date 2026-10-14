/**
 * @rox/rovers-core — frozen runtime contracts (M1).
 *
 * The seam between the slices: `<configDir>/rovers/engine.json` (M1-B2), the
 * local Lima engine spawn (M1-B2), the Docker Engine API container client
 * (M1-B4) and the container-socket authorization gate (M1-B5). Hosts inject the
 * config dir; this package imports no `@rox/shared` and no node built-ins beyond
 * `node:path` joins, so it stays unit-testable and side-effect free.
 *
 * Ownership labels are the second contract: every container Rox creates carries
 * `ROVERS_LABEL_SERVICE` and `ROVERS_LABEL_RUN`, and destructive operations act
 * only on ids that match them (`spec.md` §6.5:258, q7-client-decision §5.2).
 */

/* ────────────────────────────── engines ────────────────────────────── */

/** The three user-facing engines (`spec.md` §5.3); `remote` is post-v1. */
export type RoversEngineKind = 'local' | 'cluster' | 'remote'

/** How a `local` engine runs containers. */
export type RoversRuntimeKind = 'lima' | 'detected' | 'native'

/** The 7 canonical service states (`spec.md` §6.3), in lifecycle order. */
export const ROVERS_SERVICE_STATES = [
  'queued',
  'starting',
  'running',
  'degraded',
  'stopped',
  'failed',
  'updating',
] as const

export type RoversServiceState = (typeof ROVERS_SERVICE_STATES)[number]

/** Terminal states never transition on their own; the reconciler owns recovery. */
export const ROVERS_TERMINAL_STATES = ['running', 'degraded', 'stopped', 'failed'] as const

export function isTerminalServiceState(state: RoversServiceState): boolean {
  return (ROVERS_TERMINAL_STATES as readonly string[]).includes(state)
}

/** Cleanup policy for the engine-owned caches (M1-B2). */
export interface RoversCacheCleanupPolicy {
  /** Evict cache entries older than this many days; `0` disables age eviction. */
  maxAgeDays: number
  /** Also run cleanup when the engine is stopped, not only on explicit calls. */
  onEngineStop: boolean
}

/** One registered engine in `<configDir>/rovers/engine.json`. */
export interface RoversEngineRecord {
  id: string
  kind: RoversEngineKind
  runtime: RoversRuntimeKind
  /** Reported engine version (e.g. Lima `2.2.1`), when known. */
  version?: string
  /** Absolute path to the VM binary (`limactl`), when the engine owns one. */
  binaryPath?: string
}

/**
 * `<configDir>/rovers/engine.json` (M1-B2).
 *
 * `cacheRoot` is the single engine-owned cache directory. Every helper is
 * spawned with `HOME`, `XDG_CACHE_HOME` and `LIMA_HOME` pointing inside it, so
 * the user's `~/Library/Caches/lima` and `~/.docker/config.json` are never
 * touched (the M1-B2 acceptance assertion).
 */
export interface RoversEngineConfig {
  schemaVersion: 1
  /** Engine-owned cache root; every helper cache path lives under it. */
  cacheRoot: string
  /** `LIMA_HOME`; holds VM instances, images and downloads. */
  limaHome: string
  cleanup: RoversCacheCleanupPolicy
  engines: RoversEngineRecord[]
}

/** Absolute paths derived from a config (all inside `cacheRoot`). */
export interface RoversEnginePaths {
  cacheRoot: string
  limaHome: string
  /** The `HOME` exported to helpers — engine-private, never the user's home. */
  home: string
  /** The `XDG_CACHE_HOME` exported to helpers. */
  xdgCacheHome: string
}

/** Environment overlay applied to every helper spawn (M1-B2). */
export type RoversSpawnEnv = Record<string, string>

/* ──────────────────────────── containers ──────────────────────────── */

/** Ownership label: the Rovers service id a container belongs to. */
export const ROVERS_LABEL_SERVICE = 'ro.rox.rovers.service'
/** Ownership label: the deployment run id (a uuid per deploy). */
export const ROVERS_LABEL_RUN = 'ro.rox.rovers.run'

/** A digest-pinned image reference: `repo[/path][:tag]@sha256:<64 hex>`. */
export const ROVERS_DIGEST_IMAGE_RE = /^[a-z0-9][a-z0-9.-]*(?::[0-9]+)?\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/

export interface RoversPortMapping {
  host: number
  container: number
  protocol?: 'tcp' | 'udp'
}

export interface RoversVolumeMount {
  hostPath: string
  containerPath: string
  readOnly?: boolean
}

export interface RoversHealthcheck {
  /** Docker HEALTHCHECK `test`, e.g. `['CMD-SHELL', 'wget -qO- http://localhost/ || exit 1']`. */
  test: string[]
  intervalMs?: number
  timeoutMs?: number
  retries?: number
  startPeriodMs?: number
}

export interface RoversContainerSpec {
  serviceId: string
  runId: string
  name: string
  /** Must be digest-pinned (`ROVERS_DIGEST_IMAGE_RE`); `latest` is refused. */
  image: string
  /**
   * Overrides the image `ENTRYPOINT`, crossing verbatim to the Engine API
   * (`Entrypoint`).
   *
   * Setting a **non-empty** array also suppresses the image `CMD`: the Engine
   * only adopts the image `Cmd` while `Entrypoint` is empty, so pass `command`
   * explicitly to supply the entrypoint's arguments. `[]` clears the entrypoint;
   * `['']` resets it to the image default.
   */
  entrypoint?: string[]
  /**
   * Overrides the image `CMD`, crossing verbatim to the Engine API (`Cmd`).
   * Required by any catalog template whose compose sets `command:`.
   *
   * Omitting it keeps the image default. Note the asymmetry with
   * {@link entrypoint}: `[]` here is a **no-op** — the Engine treats an empty
   * `Cmd` as unset and re-adopts the image `CMD`, so an empty array cannot clear
   * a command, and a spec cannot express "run nothing". Only a non-empty
   * `entrypoint` drops the image `CMD`.
   */
  command?: string[]
  env?: Record<string, string>
  ports?: RoversPortMapping[]
  volumes?: RoversVolumeMount[]
  labels?: Record<string, string>
  healthcheck?: RoversHealthcheck
  memoryBytes?: number
  cpus?: number
  restartPolicy?: 'no' | 'unless-stopped' | 'always' | 'on-failure'
}

export interface RoversPullResult {
  id: string
  /** The resolved manifest digest (`sha256:…`) the pull verified. */
  digest: string
}

export interface RoversContainerSummary {
  id: string
  names: string[]
  image: string
  state: string
  labels: Record<string, string>
}

export interface RoversContainerInspect {
  id: string
  state: {
    status: string
    running: boolean
    exitCode?: number
    health?: { status: 'starting' | 'healthy' | 'unhealthy' | 'none' }
  }
  config: {
    image: string
    labels: Record<string, string>
  }
}

export interface RoversLogOptions {
  tail?: number
  /** Hard cap on returned bytes; the client never returns a truncated tail. */
  maxBytes?: number
}

/**
 * The Docker Engine API client contract (`spec.md` §5.1, q7-client-decision §6).
 * Reached only through the authorization gate; the raw socket is never exposed
 * as a `docker` exec.
 */
export interface RoversContainerClient {
  /** Engine reachability probe; typed failure on an unreachable engine. */
  ping(): Promise<void>
  /** Pull strictly by digest; resolves the manifest digest the engine stored. */
  pull(imageRef: string): Promise<RoversPullResult>
  create(spec: RoversContainerSpec): Promise<{ id: string }>
  start(containerId: string): Promise<void>
  inspect(containerId: string): Promise<RoversContainerInspect>
  logs(containerId: string, options?: RoversLogOptions): Promise<string>
  stop(containerId: string, timeoutSec?: number): Promise<void>
  remove(containerId: string, options?: { force?: boolean; volumes?: boolean }): Promise<void>
  /** Every container owned by a run id (label filter), never a name prefix. */
  listByRun(runId: string): Promise<RoversContainerSummary[]>
}

/** A pinned local Docker endpoint (validated by the gate). */
export interface RoversDockerEndpoint {
  uri: string
  socket: string
  device: number
  inode: number
}
