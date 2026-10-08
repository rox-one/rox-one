import type { SshHostConfig } from '@rox/shared/config'
import type { RemoteTarget, ResolvedArtifact } from './server-artifact.ts'

export type BootstrapPhase =
  | 'checking-server'
  | 'detecting-os'
  | 'building-server'
  | 'uploading-server'
  | 'installing-server'
  | 'starting-server'
  | 'waiting-for-server'
  | 'connecting-tunnel'
  | 'creating-workspace'
  | 'ready'
  | 'error'

export interface BootstrapProgress {
  phase: BootstrapPhase
  /** Human-readable detail (never contains secrets). */
  detail?: string
}

export interface BootstrapResult {
  /** The token the server was started with (managed secret). */
  token: string
}

/** Directory on the remote host where the managed server is installed. */
export const REMOTE_INSTALL_DIR = '~/.rox/remote-server'
export const REMOTE_LOG_PATH = '~/.rox/remote-server/server.log'
/** Token file on the remote (0600). The token travels over ssh stdin, never argv. */
export const REMOTE_TOKEN_PATH = '~/.rox/remote-server/.token'

/**
 * W1-13 (#1510): where the managed remote install lives. With
 * `storage.visible-root.v1` OFF (default) every command uses
 * {@link LEGACY_REMOTE_LAYOUT}, i.e. exactly main's paths and commands.
 */
export interface RemoteServerLayout {
  /** Rox home on the remote host. */
  home: string
  installDir: string
  logPath: string
  tokenPath: string
}

/** Flag OFF: main's layout, byte-for-byte. */
export const LEGACY_REMOTE_LAYOUT: RemoteServerLayout = {
  home: '~/.rox', // legacy hidden home (main)
  installDir: REMOTE_INSTALL_DIR,
  logPath: REMOTE_LOG_PATH,
  tokenPath: REMOTE_TOKEN_PATH,
}

/** Flag ON: the visible remote home (only when it is ours or brand new). */
export const VISIBLE_REMOTE_LAYOUT: RemoteServerLayout = {
  home: '~/rox',
  installDir: '~/rox/remote-server',
  logPath: '~/rox/remote-server/server.log',
  tokenPath: '~/rox/remote-server/.token',
}

export interface RunRemoteOptions {
  /** Timeout for the remote command, ms. */
  timeoutMs?: number
  /** Data piped to the remote command's stdin. Transfers the token without it
   * ever appearing in any argv (local or remote `ps`). */
  stdin?: string
}

export interface ServerBootstrapDeps {
  /** Run a command over ssh on the remote host; resolves stdout. */
  runRemote: (host: SshHostConfig, command: string, opts?: RunRemoteOptions) => Promise<string>
  /** Upload a local file to a remote absolute-ish path via scp. */
  uploadFile: (host: SshHostConfig, localPath: string, remotePath: string) => Promise<void>
  /** Detect remote target from `uname -sm`. */
  detectTarget: (unameOutput: string) => RemoteTarget
  /** Ensure a server artifact for the target exists locally; returns its path. */
  resolveArtifact: (target: RemoteTarget) => Promise<ResolvedArtifact>
  /** Probe the (already forwarded) local port for a live server. */
  probe: () => Promise<boolean>
  /** Generate a fresh server auth token. */
  generateToken: () => string
  /** Persist the managed token for this host in the encrypted credential store. */
  storeToken: (hostId: string, token: string) => Promise<void>
  /** Read a previously stored managed token for this host, if any. */
  loadStoredToken: (hostId: string) => Promise<string | undefined>
  /** Injectable delay (ms) for probe retry loops. */
  sleep?: (ms: number) => Promise<void>
  /** Max attempts (with delay) to re-probe after starting the server. */
  probeAttempts?: number
  /** Delay between post-start probe attempts, ms. */
  probeIntervalMs?: number
  /** W1-13: `storage.visible-root.v1` is active locally. Absent/false = main's remote behaviour. */
  visibleRoot?: boolean
}

const DEFAULT_PROBE_ATTEMPTS = 40
const DEFAULT_PROBE_INTERVAL_MS = 500

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** POSIX single-quote a string for safe embedding in a remote shell command. */
export function posixSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Build the remote shell command that writes the token file from stdin. The
 * token is piped over ssh stdin so the secret never appears in any argv; umask 077 makes it 0600 from creation. */
export function buildWriteTokenCommand(layout: RemoteServerLayout = LEGACY_REMOTE_LAYOUT): string {
  return (
    `mkdir -p ${layout.installDir} && umask 077 && ` +
    `cat > ${layout.tokenPath} && chmod 600 ${layout.tokenPath}`
  )
}

/** Build the remote shell command that installs an uploaded archive and starts
 * the server. The token is read from the 0600 file, never argv; detached under nohup. */
function buildLaunch(remotePort: number, legacyCompatibility = false, layout: RemoteServerLayout = LEGACY_REMOTE_LAYOUT): string {
  // Literal file reads keep token values out of argv. Legacy aliases are only
  // enabled for a copied legacy artifact, and use the same canonical state.
  const { installDir, tokenPath, logPath } = layout
  const legacyEnv = legacyCompatibility
    ? `CRAFT_SERVER_TOKEN="$(cat ${tokenPath})" CRAFT_RPC_PORT=${remotePort} CRAFT_CONFIG_DIR=${installDir}/config `
    : ''
  return (
    `ROX_SERVER_TOKEN="$(cat ${tokenPath})" ROX_RPC_PORT=${remotePort} ` +
    `ROX_CONFIG_DIR=${installDir}/config ` + legacyEnv +
    `nohup ${installDir}/start.sh > ${logPath} 2>&1 < /dev/null &`
  )
}

/** Detached launcher: `sh -c '... &'` with all fds redirected so ssh returns immediately. */
function detach(launch: string): string {
  // Must fully detach so the ssh channel closes immediately (else ssh blocks
  // until the server exits and times out): nohup + background, all fds redirected.
  return `sh -c ${posixSingleQuote(launch)} > /dev/null 2>&1 < /dev/null`
}

export function buildStartCommand(archiveRemotePath: string, remotePort: number, layout: RemoteServerLayout = LEGACY_REMOTE_LAYOUT): string {
  // Extract into the install dir, then start start.sh detached, logging to server.log.
  const { installDir } = layout
  return [
    `mkdir -p ${installDir}`,
    `tar -xzf ${archiveRemotePath} -C ${installDir}`,
    `chmod +x ${installDir}/start.sh ${installDir}/bin/craft-server 2>/dev/null || true`,
    `rm -f ${archiveRemotePath}`,
    detach(buildLaunch(remotePort, false, layout)),
  ].join(' && ')
}

/** Restart an already-installed server without re-uploading the artifact — the
 * path taken when the process died but the install dir is intact. */
export function buildRestartCommand(remotePort: number, legacyCompatibility = false, layout: RemoteServerLayout = LEGACY_REMOTE_LAYOUT): string {
  return detach(buildLaunch(remotePort, legacyCompatibility, layout))
}

/** Explicit compatibility source; never used for new installs. */
export const LEGACY_REMOTE_INSTALL_DIR = '~/.craft-agent/remote-server'
const legacyMarker = (installDir: string) => `${installDir}/.legacy-env-compat`

/** Canonical installation wins; legacy is only imported on requested restart. */
export function checkInstalledCommand(layout: RemoteServerLayout = LEGACY_REMOTE_LAYOUT): string {
  const { installDir } = layout
  return (
    `if test -x ${installDir}/start.sh; then ` +
    `if test -f ${legacyMarker(installDir)}; then echo INSTALLED_LEGACY; else echo INSTALLED; fi; ` +
    `elif test -x ${LEGACY_REMOTE_INSTALL_DIR}/start.sh; then echo LEGACY_INSTALLED; fi`
  )
}
export const CHECK_INSTALLED_COMMAND = checkInstalledCommand()

/** Copy missing legacy files, preserving canonical conflicts and the source. */
export function importLegacyInstallCommand(layout: RemoteServerLayout = LEGACY_REMOTE_LAYOUT): string {
  const { installDir } = layout
  return (
  `test -x ${LEGACY_REMOTE_INSTALL_DIR}/start.sh || { echo 'Legacy remote install is missing; reinstall the managed ROX server.' >&2; exit 1; }; ` +
  `copy_missing() { for source in "$1"/* "$1"/.[!.]* "$1"/..?*; do ` +
  `test -e "$source" || test -L "$source" || continue; target="$2/\${source##*/}"; ` +
  `if test -d "$source" && ! test -L "$source"; then ` +
  `if test -L "$target" || { test -e "$target" && ! test -d "$target"; }; then continue; fi; ` +
  `mkdir -p "$target" && copy_missing "$source" "$target" || return 1; ` +
  `elif ! test -e "$target" && ! test -L "$target"; then cp -pP "$source" "$target" || return 1; fi; done; }; ` +
  `mkdir -p ${installDir} && copy_missing ${LEGACY_REMOTE_INSTALL_DIR} ${installDir} && ` +
  `touch ${legacyMarker(installDir)} && test -x ${installDir}/start.sh`
  )
}
export const IMPORT_LEGACY_INSTALL_COMMAND = importLegacyInstallCommand()

export const KILL_MANAGED_SERVER_COMMAND =
  `pkill -f '[.](rox|craft-agent)/remote-server' 2>/dev/null || true`

/** Flag ON only: also matches a server started from the visible `~/rox` home. */
export const VISIBLE_KILL_MANAGED_SERVER_COMMAND =
  `pkill -f '([./]rox|[.]craft-agent)/remote-server' 2>/dev/null || true`

/**
 * Flag ON only: classify the remote homes. Prints one of
 * - `VISIBLE`  — `~/rox/remote-server` exists, or legacy `~/.rox` already
 *               symlinks to `~/rox` (a migrated home).
 * - `FOREIGN`  — `~/rox` exists but is not a Rox home: never write into it,
 *               stay on the legacy layout.
 * - `MOVABLE`  — a managed install lives in a real legacy `~/.rox` and `~/rox` is absent.
 * - `LEGACY`   — legacy `~/.rox` exists without a managed install (e.g. a desktop
 *               Rox on that host): keep main's layout, never create an empty `~/rox`.
 * - `FRESH`    — neither home exists.
 */
export const REMOTE_LAYOUT_PROBE_COMMAND =
  `if test -d ~/rox/remote-server; then echo VISIBLE; ` +
  `elif test -L ~/.rox && test -d ~/rox && test "$(cd ~/.rox && pwd -P)" = "$(cd ~/rox && pwd -P)"; then echo VISIBLE; ` + // legacy symlink → visible
  `elif test -e ~/rox || test -L ~/rox; then echo FOREIGN; ` +
  `elif test -x ~/.rox/remote-server/start.sh && test -d ~/.rox && ! test -L ~/.rox; then echo MOVABLE; ` + // legacy install
  `elif test -e ~/.rox || test -L ~/.rox; then echo LEGACY; ` +
  `else echo FRESH; fi`

/**
 * Flag ON only: move the legacy `~/.rox` home to `~/rox` and leave a compat
 * symlink. Run only after the managed server was killed. Prints:
 * - `MOVED` — moved, compat link in place;
 * - `KEPT`  — nothing moved (or the move was rolled back): legacy layout;
 * - `SPLIT` — the data is in `~/rox` but a new legacy home appeared before the
 *   link (or the rollback could not run): visible layout, nothing nested.
 * Steps: wait (bounded, `ROX_REMOTE_MOVE_WAIT` seconds, default 10) until no
 * managed server from the legacy home runs, else keep; keep while a live
 * writer holds a home lock (incl. the managed server's own config lock);
 * re-check right before `ln -s` that the legacy path is still free (a
 * directory there would nest the link); roll back only into an absent legacy
 * path. The pattern/paths never contain the literal server path, so pgrep/ps
 * never match this shell itself. Never deletes anything.
 */
export const REMOTE_HOME_MOVE_COMMAND = String.raw`if test -d ~/.rox && ! test -L ~/.rox && ! test -e ~/rox && ! test -L ~/rox; then ` + // legacy home, ~/rox free
  String.raw`d=remote-server; w=$ROX_REMOTE_MOVE_WAIT; case "$w" in ''|*[!0-9]*) w=10;; esac; ` +
  String.raw`alive() { if command -v pgrep >/dev/null 2>&1; then pgrep -u "$(id -u)" -f "[.]rox/$d" >/dev/null 2>&1; ` + // legacy managed server
  String.raw`else ps -u "$(id -u)" -o args= 2>/dev/null | grep -q "[.]rox/$d"; fi; }; ` + // legacy managed server (no pgrep)
  String.raw`i=0; while alive && test "$i" -lt "$w"; do sleep 1; i=$((i+1)); done; ` +
  String.raw`live=; if alive; then live=1; fi; ` +
  String.raw`for lock in ~/.rox/.server.lock ~/.rox/config.json.lock ~/.rox/.app.lock ~/.rox/$d/config/.server.lock; do ` + // legacy home writer locks
  String.raw`pid=$(sed -n -e 's/.*"pid"[^0-9]*\([0-9][0-9]*\).*/\1/p' -e 's/^\([0-9][0-9]*\)$/\1/p' "$lock" 2>/dev/null | head -n 1); ` +
  String.raw`if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then live=1; fi; done; ` +
  String.raw`if test -n "$live"; then echo KEPT; ` +
  String.raw`elif mv ~/.rox ~/rox; then ` + // legacy home → visible
  String.raw`if ! test -e ~/.rox && ! test -L ~/.rox && ln -s "$HOME/rox" ~/.rox; then chmod 700 ~/rox; echo MOVED; ` + // legacy compat symlink, re-checked
  String.raw`elif ! test -e ~/.rox && ! test -L ~/.rox && mv ~/rox ~/.rox; then echo KEPT; ` + // legacy rollback, never nested
  String.raw`else chmod 700 ~/rox; echo SPLIT; fi; ` +
  String.raw`else echo KEPT; fi; else echo KEPT; fi`

/** mkdir for the remote home; the visible home is private (0700). */
function mkdirHomeCommand(layout: RemoteServerLayout): string {
  return layout === LEGACY_REMOTE_LAYOUT ? 'mkdir -p ~/.rox' : `mkdir -p ${layout.home} && chmod 700 ${layout.home}` // legacy: main
}

/**
 * Pick the layout for this (re)start. Flag OFF: main's layout, no probe.
 * Flag ON: visible only when it is ours or brand new; a managed legacy home is
 * moved only after the managed server is killed; a foreign `~/rox` is never touched.
 */
export async function resolveRemoteLayout(host: SshHostConfig, deps: ServerBootstrapDeps): Promise<RemoteServerLayout> {
  if (deps.visibleRoot !== true) return LEGACY_REMOTE_LAYOUT
  const probe = (await deps.runRemote(host, REMOTE_LAYOUT_PROBE_COMMAND)).trim()
  if (probe === 'VISIBLE' || probe === 'FRESH') return VISIBLE_REMOTE_LAYOUT
  if (probe === 'MOVABLE') {
    // Kill the managed server BEFORE its home moves out from under it.
    await deps.runRemote(host, VISIBLE_KILL_MANAGED_SERVER_COMMAND)
    const moved = (await deps.runRemote(host, REMOTE_HOME_MOVE_COMMAND)).trim()
    // SPLIT: the data already lives in ~/rox (a new legacy dir appeared).
    return moved === 'MOVED' || moved === 'SPLIT' ? VISIBLE_REMOTE_LAYOUT : LEGACY_REMOTE_LAYOUT
  }
  return LEGACY_REMOTE_LAYOUT // FOREIGN, LEGACY or unknown output
}

async function prepareRestart(host: SshHostConfig, deps: ServerBootstrapDeps, layout: RemoteServerLayout): Promise<{ installed: boolean; legacy: boolean }> {
  const status = (await deps.runRemote(host, checkInstalledCommand(layout))).trim()
  if (status === 'LEGACY_INSTALLED') {
    await deps.runRemote(host, importLegacyInstallCommand(layout))
  }
  return { installed: ['INSTALLED', 'INSTALLED_LEGACY', 'LEGACY_INSTALLED'].includes(status), legacy: status.includes('LEGACY') }
}

/** Run the full bootstrap. Assumes the SSH tunnel is already established and the
 * remote server port is forwarded locally (so `probe()` targets it). */
export async function bootstrapRemoteServer(
  host: SshHostConfig,
  deps: ServerBootstrapDeps,
  onProgress: (p: BootstrapProgress) => void = () => {},
): Promise<BootstrapResult> {
  const sleep = deps.sleep ?? defaultSleep
  const probeAttempts = deps.probeAttempts ?? DEFAULT_PROBE_ATTEMPTS
  const probeIntervalMs = deps.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS

  // 1. If a server already answers and we have a stored token, we're done.
  onProgress({ phase: 'checking-server' })
  const alreadyAlive = await deps.probe()
  const stored = await deps.loadStoredToken(host.id)
  if (alreadyAlive && stored) {
    onProgress({ phase: 'ready' })
    return { token: stored }
  }
  const layout = await resolveRemoteLayout(host, deps)
  const killCommand = deps.visibleRoot === true ? VISIBLE_KILL_MANAGED_SERVER_COMMAND : KILL_MANAGED_SERVER_COMMAND
  if (alreadyAlive) {
    // A server answers but we hold no token for it. If OUR install dir is present,
    // it's a managed server whose token we lost — restart with a fresh token.
    const installation = await prepareRestart(host, deps, layout)
    if (installation.installed) {
      const token = deps.generateToken()
      await deps.storeToken(host.id, token)
      onProgress({ phase: 'starting-server', detail: 'restart' })
      await deps.runRemote(host, buildWriteTokenCommand(layout), { stdin: token })
      // The old (token-less to us) server still holds the port; kill it first.
      await deps.runRemote(host, killCommand)
      await deps.runRemote(host, buildRestartCommand(host.remotePort, installation.legacy, layout))
      onProgress({ phase: 'waiting-for-server' })
      for (let attempt = 0; attempt < probeAttempts; attempt++) {
        if (await deps.probe()) {
          onProgress({ phase: 'ready' })
          return { token }
        }
        await sleep(probeIntervalMs)
      }
      const detail = 'The managed server did not come back up after a restart with a new token.'
      onProgress({ phase: 'error', detail })
      throw new Error(detail)
    }
    // A server we don't manage occupies the port. Installing another would fail
    // to bind and the re-probe would hit the old server — fail fast with a clear message.
    const detail =
      `A server is already running on port ${host.remotePort} on this host, but it is not managed by this app. ` +
      `Connect to it via "Connect to remote server" (with its own token), or change this host's server port to install a managed server.`
    onProgress({ phase: 'error', detail })
    throw new Error(detail)
  }

  // 2. Server not answering but we manage this host and the install is intact
  //    (process died: crash, reboot, OOM kill) — restart it without re-uploading.
  if (stored) {
    const installation = await prepareRestart(host, deps, layout)
    if (installation.installed) {
      onProgress({ phase: 'starting-server', detail: 'restart' })
      // Re-write the token file (cheap to refresh) and relaunch; fall through to
      // a full reinstall if the restart doesn't bring the server up.
      await deps.runRemote(host, buildWriteTokenCommand(layout), { stdin: stored })
      await deps.runRemote(host, buildRestartCommand(host.remotePort, installation.legacy, layout))
      onProgress({ phase: 'waiting-for-server' })
      for (let attempt = 0; attempt < probeAttempts; attempt++) {
        if (await deps.probe()) {
          onProgress({ phase: 'ready' })
          return { token: stored }
        }
        await sleep(probeIntervalMs)
      }
      // Restart failed — continue into the full install path below.
    }
  }

  // 3. Detect the remote OS/arch.
  onProgress({ phase: 'detecting-os' })
  const uname = await deps.runRemote(host, 'uname -sm')
  const target = deps.detectTarget(uname)

  // 4. Ensure a local artifact for the target (build on demand in dev).
  onProgress({ phase: 'building-server', detail: `${target.platform}-${target.arch}` })
  const artifact = await deps.resolveArtifact(target)

  // 5. Upload + extract.
  const remoteArchive = `${layout.home}/${artifact.archiveName}`
  onProgress({ phase: 'uploading-server' })
  await deps.runRemote(host, mkdirHomeCommand(layout))
  await deps.uploadFile(host, artifact.archivePath, remoteArchive)

  // 6. Generate + store token, transfer it via stdin (never argv), then
  //    install + start the server (which reads the token from the 0600 file).
  const token = stored ?? deps.generateToken()
  await deps.storeToken(host.id, token)

  onProgress({ phase: 'installing-server' })
  await deps.runRemote(host, buildWriteTokenCommand(layout), { stdin: token })

  onProgress({ phase: 'starting-server' })
  // Extracting a large archive + launching can take a while; allow generous time.
  await deps.runRemote(host, buildStartCommand(remoteArchive, host.remotePort, layout), {
    timeoutMs: 180_000,
  })

  // 7. Re-probe until the server answers.
  onProgress({ phase: 'waiting-for-server' })
  for (let attempt = 0; attempt < probeAttempts; attempt++) {
    if (await deps.probe()) {
      onProgress({ phase: 'ready' })
      return { token }
    }
    await sleep(probeIntervalMs)
  }

  // Failure — surface a tail of the remote log to help diagnosis (no secrets in it).
  let logTail = ''
  try {
    logTail = (await deps.runRemote(host, `tail -n 30 ${layout.logPath} 2>/dev/null || true`)).trim()
  } catch {
    /* best effort */
  }
  const detail = logTail
    ? `Server did not come up in time. Remote log tail:\n${logTail}`
    : 'Server did not come up in time and no remote log was available.'
  onProgress({ phase: 'error', detail })
  throw new Error(detail)
}
