// PERF-01: must stay the first import so `main:entry` precedes heavy module evaluation.
import { markStartup, markStartupOnce, recordRendererMark, reportStartupTimelineWhenSettled, whenStartupMark } from './startup-marks'
import { STARTUP_MARKS, STARTUP_PERF_MARK_CHANNEL, isValidRendererMarkName } from '../shared/startup-perf'
import { createPocketAccountStore } from './pocket-account-store'
import { RoxAccountAuthority, setRoxAccountAuthority } from '@rox/shared/auth'
import { validateConfigurationCliEntries } from './configuration-cli-compat'
import { resolveNumberedUserDataDir } from './numbered-user-data'
// Load user's shell environment first (before other imports that may use env)
// This ensures tools like Homebrew, nvm, etc. are available to the agent.
// PERF-03: non-blocking — applies the cached env (or fallback PATH) now and
// refreshes from the login shell in the background; agent spawns await it.
import { shellEnvSpawnGate, startShellEnvLoad } from './shell-env'
import { registerSpawnEnvGate, whenSpawnEnvReady } from '@rox/shared/toolchain/spawn-readiness'
startShellEnvLoad()
// Builtin MCP / MCP validation / git / siyuan / agent spawns await this gate.
registerSpawnEnvGate('shell-env', shellEnvSpawnGate)
markStartup(STARTUP_MARKS.shellEnv)

import './brand-config-boot'

import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, safeStorage, session, shell, Tray, type BrowserWindowConstructorOptions, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { createHash, randomUUID } from 'crypto'


// Initialize i18n for main process (menus, dialogs, etc.)
//
// The main-process i18n instance has no detection plugin (no localStorage in Node)
// — it always starts at `fallbackLng: 'en'`. We hydrate it here from the persisted
// `uiLanguage` preference, which is maintained by the `i18n:changeLanguage` IPC
// handler whenever the user changes Appearance → Language. Without this, the
// renderer would restore its language from localStorage on every restart while
// the main process silently stayed at English — breaking session title language,
// the system prompt's "Preferred language" line, and the native menu.
import { setupI18n, i18n, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from '@rox/shared/i18n'
import { getPersistedUiLanguage, setPersistedUiLanguage } from '@rox/shared/config'
import { initTelemetry, telemetryConfigFromEnv, track as trackProductEvent, type TelemetryHandle } from '@rox/shared/telemetry'
import { loadGamificationState } from '@rox/shared/gamification'
setupI18n()
const persistedUiLanguage = getPersistedUiLanguage()
if (persistedUiLanguage) {
  void i18n.changeLanguage(persistedUiLanguage)
}
// Note: deferred startup log lives below where mainLog is available (after log.initialize()).

// Product analytics: PostHog capture/feature flags + OTLP traces.
//
// Self-hosted endpoints are baked at build time via esbuild --define (see
// scripts/electron-build-main.ts) — with the live defaults, so analytics sends
// out of the box; an explicit env value still overrides them. The renderer
// receives the same distinct_id + endpoints over `__telemetry-config`.
// Egress is gated by the «Аналитика продукта» consent (gamification.json
// analyticsConsent, default ON) — local Electron clients have no native
// principal, so that file is the authoritative store; a read failure fails closed.

// Anonymous per-install identifier (no PII — a hash of hostname + homedir)
// used as the analytics distinct_id for both PostHog and OTLP.
const machineId = createHash('sha256').update(hostname() + homedir()).digest('hex').slice(0, 16)
const telemetryEndpoints = telemetryConfigFromEnv({
  POSTHOG_HOST: process.env.POSTHOG_HOST,
  POSTHOG_KEY: process.env.POSTHOG_KEY,
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
})
// `POSTHOG_FLAGS_DISABLED=1` disables `/decide` entirely (shared with renderer).
const telemetryFlagsDisabled = process.env.POSTHOG_FLAGS_DISABLED === '1'
const telemetryBootstrapConfig = {
  distinctId: machineId,
  ...telemetryEndpoints,
  flagsDisabled: telemetryFlagsDisabled,
}
const productTelemetry: TelemetryHandle = initTelemetry({
  ...telemetryEndpoints,
  distinctId: machineId,
  version: app.getVersion(),
  platform: process.platform,
  flagsDisabled: telemetryFlagsDisabled,
  getConsent: () => loadGamificationState().analyticsConsent,
})
app.on('will-quit', () => {
  productTelemetry.dispose()
})
trackProductEvent('app_launched', { platform: process.platform, version: app.getVersion() })

import { homedir, hostname, userInfo } from 'os'
import { join, delimiter, resolve, sep } from 'path'
import { refreshLegacySeededWorkspaceIcons } from './brand-icon-migration'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { resolveOemManagedLayout } from '@rox/shared/knowledge/oem-pin'
import { RPC_CHANNELS } from '@rox/shared/protocol'

{
  const oemRoot = app.isPackaged ? process.resourcesPath : process.cwd()
  const layout = resolveOemManagedLayout({ cwd: oemRoot, existsSync })
  if (layout.kernelBinary) {
    if (!process.env.G2_RECORD_PATH && layout.g2RecordPath) process.env.G2_RECORD_PATH = layout.g2RecordPath
    if (!process.env.OEM_PIN_PATH && layout.pinPath) process.env.OEM_PIN_PATH = layout.pinPath
    if (!process.env.OEM_KERNEL_BINARY) process.env.OEM_KERNEL_BINARY = layout.kernelBinary
  }
}

import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@rox/server-core/sessions'
import { PageThumbnailer } from './page-thumbnailer'
import { registerAllRpcHandlers, startClipboardMonitor } from './handlers/index'
import { createDriveService } from './drive/register'
import { registerCoreRpcHandlers, cleanupCoreClientResources } from '@rox/server-core/handlers/rpc'
import { NodeRegistry, DEFAULT_PRESENCE_TTL_MS } from '@rox/server-core/nodes'
import { createWorkGraphKernel, type WorkGraphKernel } from '@rox/server-core/workgraph'
import type { PlatformServices } from '../runtime/platform'
import { createElectronPlatform } from './platform'
import type { HandlerDeps } from './handlers/handler-deps'
import { resolveNativeTransportCredential } from './native-transport-credential'
import { createBrowserCredentialPermissionAdapter } from './browser-credential-permissions'
import { createOnboardingPermissionsHost } from './onboarding-permissions'
import { registerDesktopBridgeIpc, type DesktopBridgeBrowserHost } from './desktop-bridge'
import { createBrowserCredentialVaultKeyStore } from './browser-credential-vault-keys'
import { bootstrapServer, releaseServerLock, maskTokenForDisplay } from '@rox/server-core/bootstrap'
import { isAllowedServerEndpoint } from './server-endpoint-policy'
import { createMessagingBootstrap, type MessagingBootstrapHandle } from '@rox/messaging-gateway'
import { getCredentialManager } from '@rox/shared/credentials'
import { initModelRefreshService, getModelRefreshService, setFetcherPlatform } from '@rox/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@rox/server-core/services'
import { createApplicationMenu } from './menu'
import { dispatchShellAction } from './shell-actions'
import { initQuickComposer, disposeQuickComposer } from './quick-composer'
import { nativeAccessibilityPrefersSolid } from './shell-material'
import { getQuickComposerShortcut, setQuickComposerShortcut } from '@rox/shared/config'
import { WindowManager } from './window-manager'
import { readBoundWindowWorkspace } from './bootstrap-window-workspace'
import { stopAllExtensionHosts } from './extension-host-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { getWorkspaces, getWorkspaceByNameOrId, loadStoredConfig, addWorkspace, saveConfig, getConfigPath, createInitialStoredConfig, CONFIG_DIR } from '@rox/shared/config'
import { getDefaultWorkspacesDir } from '@rox/shared/workspaces'
import { resolveWorkspaceMachineName } from '@rox/shared/os/user-display-name'
import { ensureDemoPage } from '@rox/shared/pages'
import { initializeDocs } from '@rox/shared/docs'
import { ensureBundledSkillsInBackground, whenBundledSkillsReadyForAgents } from '@rox/shared/skills'
import { initializeReleaseNotes } from '@rox/shared/release-notes'
import { ensureDefaultPermissions } from '@rox/shared/agent/permissions-config'
import { ensureToolIcons, ensurePresetThemes } from '@rox/shared/config'
import { setBundledAssetsRoot } from '@rox/shared/utils'
import { initializeBackendHostRuntime } from '@rox/shared/agent/backend'
import { prependPath, pathEnvKey } from '@rox/shared/toolchain'
import { setPowerShellValidatorRoot } from '@rox/shared/agent'
import { handleDeepLink } from './deep-link'
import { loadPersistedEntitiesLinksFlag, registerEntitiesLinksIpc } from './entities-flags'
import { BrowserPaneManager } from './browser-pane-manager'
import { OpenDesignRuntimeManager, isTrustedOpenDesignIpcEvent, registerOpenDesignIpcHandlers } from './open-design-runtime'
import { OpenDesignWindowController } from './open-design-window'
import { OAuthFlowStore } from '@rox/shared/auth'
import { registerThumbnailScheme, registerThumbnailHandler } from './thumbnail-protocol'
import log, { isDebugMode, mainLog, getLogFilePath, getMessagingGatewayLogFilePath, getAutoUpdateLogFilePath, messagingGatewayLog, autoUpdateLog, errorLog } from './logger'
import { registerDeviceDiagnosticsIpc } from './device-diagnostics-ipc'
import { registerStorageVisibleRootIpc } from './storage-visible-root-ipc'
import { registerStorageMigrationNoticeIpc, runVisibleHomeBoot } from './visible-home-boot'
import { setPerfEnabled, enableDebug } from '@rox/shared/utils'
import { registerPiModelResolver } from '@rox/shared/config'
import { getPiModelsForAuthProvider, getAllPiModels } from '@rox/shared/config'
import { initNotificationService, initBadgeIcon, initInstanceBadge, updateBadgeCount } from './notifications'
import { resolveAppIconPngPath } from './app-icon-paths'
import { checkForUpdatesOnLaunch, setAutoUpdateEventSink, isUpdating, setBeforeUpdateQuitHook, setBeforeUpdateInstallHook, setInstallQuitFailedHook } from './auto-update'
import type { EventSink } from '@rox/server-core/transport'
import { validateGitBashPath, checkVCRedistInstalled } from '@rox/server-core/services'
import { createOpenClawSecurityComposition } from './openclaw-security'
import { createOpenClawHostControlConfirmation, registerOpenClawHostControlIpc } from './openclaw-host-control'
import { createLocalClientBindingRegistry } from './local-client-binding'
import { installRendererSessionPolicy } from './renderer-session-policy'
import { runQuitCleanupThenExit } from './quit-exit-guard'
import { registerMeetingCaptureIpc } from './meetings/ipc'
import { registerLocalMeetingsIpc } from './meetings/local-ipc'
import { registerMailIpc } from './mail/local-ipc'
import { registerTelegramLink } from './telegram-link/register'
import { registerCalendarGoogleOAuthIpc } from './calendar/google-oauth'
import { registerAppleCalendarHelperFromHost } from './calendar/register-helper'
import { registerNativeReplicaForWindows } from './native-replica-bootstrap'
import { initBrowserIntelRuntime } from './browser-intel/index'
import type { OpenClawRuntimeManager, OpenClawSecurityAuditService } from '@rox/server-core/openclaw'
import {
  buildLaunchAgentFiles,
  createLaunchctlRunner,
  createNodeServiceFilesystem,
  createServiceManager,
  decideOnboardDaemon,
  defaultPortAvailable,
  detectExternalSupervisor,
  guardServiceInstall,
  LaunchdRuntime,
  readOnboardDaemonFlags,
  ROX_SERVICE_LABEL,
  runDoctor,
} from '@rox/server-core/service'
import { pushTyped } from '@rox/server-core/transport'
import { registerServiceLifecycleIpc } from './service-lifecycle-ipc'
import type { MenuBroadcastChannel } from './menu'
import { TrayController } from './tray'

// Initialize electron-log for renderer process support
log.initialize()

// Diagnostic: report main-process i18n hydration result. We log here (not inline
// at the hydration site above) because mainLog is only available after this point.
mainLog.info('[i18n] startup hydration', {
  persistedUiLanguage: persistedUiLanguage ?? null,
  resolvedLanguageAfterHydration: i18n.resolvedLanguage ?? null,
})

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.CRAFT_DEBUG = '1'
  enableDebug()
  setPerfEnabled(true)
}

// Bundle CLI tools: resolve platform-specific uv binary and wrapper scripts.
// These are available to all agent Bash sessions via CRAFT_UV, CRAFT_SCRIPTS env vars
// and PATH prepend. uv auto-downloads Python 3.12 on first use (~5s, then cached).
{
  // In packaged app: resources are at process.resourcesPath/app/resources/
  // In dev: resources are at __dirname/../resources/ (sibling of dist/)
  const resourcesBase = app.isPackaged
    ? join(process.resourcesPath, 'app')
    : join(__dirname, '..')
  const platformKey = `${process.platform}-${process.arch}`
  const uvPlatformDir = join(resourcesBase, 'resources', 'bin', platformKey)
  const uvBinary = join(uvPlatformDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
  const binDir = join(resourcesBase, 'resources', 'bin')
  const scriptsDir = join(resourcesBase, 'resources', 'scripts')

  const bundledUvExists = existsSync(uvBinary)
  const fallbackUv = bundledUvExists ? null : 'uv'

  // Runtime resolver hints for shared session tools
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? '1' : '0'
  process.env.CRAFT_RESOURCES_BASE = resourcesBase
  process.env.CRAFT_APP_ROOT = app.isPackaged ? app.getAppPath() : process.cwd()

  process.env.CRAFT_UV = bundledUvExists ? uvBinary : (fallbackUv ?? uvBinary)

  // Bun runtime (packaged builds should prefer bundled runtime over PATH)
  const bunBase = app.isPackaged && process.platform === 'win32' ? process.resourcesPath : resourcesBase
  const bunBinary = join(bunBase, 'vendor', 'bun', process.platform === 'win32' ? 'bun.exe' : 'bun')
  if (existsSync(bunBinary)) {
    process.env.CRAFT_BUN = bunBinary
  }

  process.env.CRAFT_SCRIPTS = scriptsDir
  // Configuration CLI packages are not included in this app. Preserve only
  // explicitly supplied working entries for the legacy compatibility wrapper.
  validateConfigurationCliEntries(process.env)
  process.env.CRAFT_COMMANDS_DOC_PATH = app.isPackaged
    ? join(resourcesBase, 'resources', 'docs', 'craft-cli.md')
    : join(process.cwd(), 'apps', 'electron', 'resources', 'docs', 'craft-cli.md')
  process.env.CRAFT_CLI_DOC_PATH = process.env.CRAFT_COMMANDS_DOC_PATH
  process.env.CRAFT_AGENT_VERSION = app.getVersion()
  // Prepend both generic wrappers dir and platform uv dir:
  // - binDir exposes wrapper commands (pdf-tool, docx-tool, ...)
  // - uvPlatformDir exposes raw `uv` for direct shell usage / debugging
  const rgDir = join(resourcesBase, 'node_modules', '@vscode', 'ripgrep', 'bin')
  const rgBinary = join(rgDir, process.platform === 'win32' ? 'rg.exe' : 'rg')
  const prefix = [binDir, uvPlatformDir,
    ...(existsSync(bunBinary) ? [join(bunBase, 'vendor', 'bun')] : []),
    ...(existsSync(rgBinary) ? [rgDir] : []),
  ].join(delimiter)
  const next = prependPath(process.env, prefix)
  const pathKey = pathEnvKey(process.env)
  for (const key of Object.keys(process.env)) if (key !== pathKey && key.toUpperCase() === 'PATH') delete process.env[key]
  process.env[pathKey] = next[pathKey]

  if (!bundledUvExists) {
    mainLog.warn('Bundled uv binary missing, CLI document tools may fail unless uv is available on PATH.', {
      expectedUvPath: uvBinary,
      usingCraftUv: process.env.CRAFT_UV,
    })
  }

  if (!process.env.UV_PYTHON) {
    const pyRoot = join(CONFIG_DIR, 'toolchain', 'python', '3.12')
    if (existsSync(pyRoot)) {
      for (const entry of readdirSync(pyRoot)) {
        if (!entry.startsWith('cpython-3.12')) continue
        const candidate = join(pyRoot, entry, 'bin', process.platform === 'win32' ? 'python.exe' : 'python3.12')
        if (existsSync(candidate)) {
          process.env.UV_PYTHON = candidate
          break
        }
      }
    }
  }

  if (isDebugMode) {
    mainLog.info('CLI tools configured:', { uvBinary: process.env.CRAFT_UV, binDir, scriptsDir, bundledUvExists, uvPython: process.env.UV_PYTHON ?? null })
  }
}

// Browser Intelligence runtime: background-only, opt-in pipeline whose unfurl
// stage runs in a Worker Thread. Registered after the CLI/env block so
// CRAFT_RESOURCES_BASE is set for the packaged schema lookup, and before any
// window is created. A failure must never block startup.
try {
  initBrowserIntelRuntime()
} catch (error) {
  mainLog.warn('[browser-intel] runtime initialization failed', error)
}

// Register Pi model resolver so llm-connections.ts can resolve Pi models
// without importing @earendil-works/pi-ai (which breaks the Vite renderer build)
registerPiModelResolver((piAuthProvider) =>
  piAuthProvider ? getPiModelsForAuthProvider(piAuthProvider) : getAllPiModels()
)

// Custom URL scheme for deeplinks (rox:// primary, craftagents:// alias)
// Supports multi-instance dev: ROX_DEEPLINK_SCHEME / CRAFT_DEEPLINK_SCHEME
const DEEPLINK_SCHEME = process.env.ROX_DEEPLINK_SCHEME || process.env.CRAFT_DEEPLINK_SCHEME || 'rox'
const LEGACY_DEEPLINK_SCHEME = 'craftagents'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null
let browserPaneManager: BrowserPaneManager | null = null
let openDesignRuntime: OpenDesignRuntimeManager | null = null
let oauthFlowStore: OAuthFlowStore | null = null
let moduleSink: EventSink | null = null
let moduleClientResolver: ((webContentsId: number) => string | undefined) | null = null
let openClawRuntimeManager: OpenClawRuntimeManager | null = null
let openClawSecurityAuditService: OpenClawSecurityAuditService | null = null
let workGraphKernel: WorkGraphKernel | null = null
let cleanupNativeReplicaIpc: (() => void) | null = null
const localClientBindingRegistry = createLocalClientBindingRegistry()

// PERF-01 shell-first boot: the window is created before the RPC server
// bootstrap. The preload's local client resolves its port through
// `__await-ws-port`, which settles here once `bootstrapServer` has returned and
// the Electron-side sinks are wired — so no renderer RPC is issued before the
// server listens.
let wsPortValue: number | null = null
let resolveWsPort: ((port: number) => void) | null = null
const wsPortReady = new Promise<number>((resolve) => { resolveWsPort = resolve })
function publishWsPort(port: number): void {
  if (wsPortValue !== null) return
  wsPortValue = port
  resolveWsPort?.(port)
}

// Messaging gateway: the bootstrap handle is created once sessionManager is
// available (inside createHandlerDeps) and populated with the WS publisher
// after bootstrapServer resolves. Both hosts (Electron + standalone) wire
// through createMessagingBootstrap — do not construct MessagingGatewayRegistry
// directly.
let messagingHandle: MessagingBootstrapHandle | null = null

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title
// Supports multi-instance dev: CRAFT_APP_NAME env var (e.g., "Rox [1]")
app.setName(process.env.ROX_APP_NAME || process.env.CRAFT_APP_NAME || 'Rox')
app.setAboutPanelOptions({
  applicationName: 'Rox',
  applicationVersion: app.getVersion(),
  copyright: '© 2026 Rox',
  credits: 'Rox',
})

// Isolate Chromium profile so a second dev instance does not share cookies/locks.
const numberedInstance = (process.env.ROX_INSTANCE_NUMBER || process.env.CRAFT_INSTANCE_NUMBER)?.trim()
const userDataOverride = (process.env.ROX_USER_DATA_DIR || process.env.CRAFT_USER_DATA_DIR)?.trim()
if (userDataOverride) {
  mkdirSync(userDataOverride, { recursive: true })
  app.setPath('userData', userDataOverride)
} else if (numberedInstance) {
  app.setPath('userData', resolveNumberedUserDataDir(app.getPath('appData'), numberedInstance))
}

function registerDeeplinkScheme(scheme: string): void {
  // Isolated native verification must not replace the user's OS URL associations.
  // Packaged applications always retain the primary and legacy registrations.
  if (!app.isPackaged && process.env.ROX_DEV_DISABLE_PROTOCOL_REGISTRATION === '1') return

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [process.argv[1]])
    }
  } else {
    app.setAsDefaultProtocolClient(scheme)
  }
}

// Isolated product tests still exercise deep-link dispatch, while avoiding
// changes to the user's OS protocol handlers for either supported scheme.
if (!(process.env.NODE_ENV === 'test' && process.env.ROX_SKIP_PROTOCOL_REGISTRATION === '1')) {
  registerDeeplinkScheme(DEEPLINK_SCHEME)
  if (DEEPLINK_SCHEME !== LEGACY_DEEPLINK_SCHEME) {
    registerDeeplinkScheme(LEGACY_DEEPLINK_SCHEME)
  }
}

// Apply network proxy settings early (Node-level only — Electron sessions require app.whenReady)
import { applyConfiguredProxySettings } from './network-proxy'
void applyConfiguredProxySettings()

// Register thumbnail:// custom protocol for file preview thumbnails in the sidebar.
// Must happen before app.whenReady() — Electron requires early scheme registration.
registerThumbnailScheme()

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainLog.info('Received deeplink:', url)

  if (windowManager) {
    handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined, undefined, 'os').catch(err => {
      mainLog.error('Failed to handle deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingDeepLink = url
  }
})

// Handle deeplink on Windows/Linux (single instance check).
// macOS keys this lock to the bundle id, so a second `electron:dev` from another
// tree/port would otherwise quit immediately. Numbered instances skip it.
const allowMultiInstance = Boolean(numberedInstance)
const gotTheLock = allowMultiInstance || app.requestSingleInstanceLock()
if (!gotTheLock) {
  mainLog.warn('Single-instance lock not acquired; quitting', {
    userData: app.getPath('userData'),
    instance: numberedInstance ?? null,
  })
  app.quit()
} else if (!allowMultiInstance) {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg =>
      arg.startsWith(`${DEEPLINK_SCHEME}://`) || arg.startsWith(`${LEGACY_DEEPLINK_SCHEME}://`),
    )
    if (url && windowManager) {
      mainLog.info('Received deeplink from second instance:', url)
      handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined, undefined, 'os').catch(err => {
        mainLog.error('Failed to handle deep link:', err)
      })
    } else if (url) {
      // Startup (including Windows dependency bootstrap) can precede the manager.
      // Reuse the same latest-link replay as the macOS open-url callback.
      pendingDeepLink = url
    } else if (windowManager) {
      // No deep link - just focus the first window
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

// W1-13 (#1510): the visible-home migration runs only here, in the primary
// instance after the single-instance lock (never at CONFIG_DIR import time and
// never in numbered/second instances, headless mode, the CLI or the server). This
// process keeps its resolved CONFIG_DIR; the next launch picks up ~/rox. Every
// instance that runs holds the app lifetime lock so migrations defer meanwhile.
const visibleHomeBoot = gotTheLock
  ? runVisibleHomeBoot({
      primary: !allowMultiInstance && !process.env.CRAFT_HEADLESS,
      configDir: CONFIG_DIR,
      // Data moved to ~/rox but the compat link is missing: restart onto it
      // instead of running on a vanished legacy dir (next launch resolves ~/rox).
      relaunch: () => {
        mainLog.warn('Visible Rox home moved without a compat link; relaunching onto it')
        app.relaunch()
        app.exit(0)
      },
    })
  : null
if (visibleHomeBoot) {
  if (visibleHomeBoot.notice) mainLog.info('Visible Rox home migration notice', visibleHomeBoot.notice)
  app.once('will-quit', () => visibleHomeBoot.release())
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Load saved window state
  const savedState = loadWindowState()
  let workspaces = getWorkspaces()

  // If no workspaces exist, create a default workspace named after this machine
  if (workspaces.length === 0) {
    // Ensure config file exists (addWorkspace requires it)
    if (!loadStoredConfig()) {
      if (existsSync(getConfigPath())) throw new Error('Unable to load existing global config')
      saveConfig(createInitialStoredConfig())
    }
    const defaultPath = join(getDefaultWorkspacesDir(), 'my-workspace')
    const workspaceName = resolveWorkspaceMachineName()
    // Seed workspace icon from the full-bleed Rox avatar (workspace-icon.png),
    // falling back to the app icon (icon.png) for older resource layouts.
    const appIconPath = [
      join(__dirname, 'resources/workspace-icon.png'),
      join(__dirname, '../resources/workspace-icon.png'),
      join(process.resourcesPath ?? '', 'app/resources/workspace-icon.png'),
      join(__dirname, 'resources/icon.png'),
      join(__dirname, '../resources/icon.png'),
      join(process.resourcesPath ?? '', 'app/resources/icon.png'),
      join(process.resourcesPath ?? '', 'icon.png'),
    ].find((p) => p && existsSync(p))
    if (appIconPath) {
      try {
        mkdirSync(defaultPath, { recursive: true })
        copyFileSync(appIconPath, join(defaultPath, 'icon.png'))
      } catch (err) {
        mainLog.warn('Failed to seed default workspace icon', err)
      }
    }
    addWorkspace({ rootPath: defaultPath, name: workspaceName })
    try {
      ensureDemoPage(defaultPath)
    } catch (err) {
      mainLog.warn('Failed to seed default Pages demo', err)
    }
    workspaces = getWorkspaces() // Refresh after creation
    mainLog.info(`Created default workspace on first run (name=${workspaceName})`)
  }

  // Refresh workspace avatars that are still an auto-seeded legacy app mark
  // (byte-identical to an old bundled icon.png). User-chosen icons are untouched.
  // PERF-01: deferred until after the shell window exists so this file IO stays
  // off the `window-created` critical path.
  const refreshLegacyIcons = () => {
    try {
      const avatarPath = [
        join(__dirname, 'resources/workspace-icon.png'),
        join(__dirname, '../resources/workspace-icon.png'),
        join(process.resourcesPath ?? '', 'app/resources/workspace-icon.png'),
      ].find((p) => p && existsSync(p))
      const refreshed = refreshLegacySeededWorkspaceIcons(workspaces, avatarPath)
      if (refreshed.length > 0) mainLog.info(`Refreshed legacy seeded workspace icon(s): ${refreshed.length}`)
    } catch (err) {
      mainLog.warn('Failed to refresh legacy workspace icons', err)
    }
  }

  const validWorkspaceIds = workspaces.map(ws => ws.id)

  if (savedState?.windows.length) {
    // Restore windows from saved state
    let restoredCount = 0

    for (const saved of savedState.windows) {
      // Skip invalid workspaces
      if (!validWorkspaceIds.includes(saved.workspaceId)) continue

      // Restore main window with focused mode if it was saved
      mainLog.info(`Restoring window: workspaceId=${saved.workspaceId}, focused=${saved.focused ?? false}, url=${saved.url ?? 'none'}`)
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        focused: saved.focused,
        restoreUrl: saved.url,
      })
      win.setBounds(saved.bounds)

      restoredCount++
    }

    if (restoredCount > 0) {
      mainLog.info(`Restored ${restoredCount} window(s) from saved state`)
      refreshLegacyIcons()
      return
    }
  }

  // Default: open window for first workspace
  windowManager.createWindow({ workspaceId: workspaces[0].id })
  mainLog.info(`Created window for first workspace: ${workspaces[0].name}`)
  refreshLegacyIcons()
}

// Trust boundary for main-process IPC that is only meant for Rox's own windows:
// the sender must be a window this process created, on the app's own renderer
// URL (dev server or packaged file:// index.html).
function isTrustedRoxRendererUrl(url: string): boolean {
  if (!url) return false
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return false
    const filePath = resolve(fileURLToPath(parsed))
    const rendererRoot = resolve(join(__dirname, 'renderer'))
    return filePath === join(rendererRoot, 'index.html') || filePath.startsWith(rendererRoot + sep)
  } catch {
    return false
  }
}

function isRegisteredRoxRendererWebContents(sender: WebContents): boolean {
  const win = windowManager?.getWindowByWebContentsId(sender.id)
  return !!win && win.webContents === sender
}

function isTrustedRoxRendererIpcEvent(event: IpcMainInvokeEvent): boolean {
  return isTrustedOpenDesignIpcEvent({
    event,
    isRegisteredRoxWebContents: isRegisteredRoxRendererWebContents,
    isTrustedMainFrameUrl: isTrustedRoxRendererUrl,
  })
}

/**
 * Deny-by-default guard for main-process IPC handlers that must only serve
 * Rox's own renderer. Throws the shared `IPC_SENDER_DENIED` code so a renegade
 * sender learns nothing about the handler. Preload-time sendSync channels must
 * not use this (senderFrame can be null during preload eval) — use
 * `isRegisteredRoxRendererWebContents(event.sender)` there instead.
 */
function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  if (!isTrustedRoxRendererIpcEvent(event)) throw new Error('IPC_SENDER_DENIED')
}

app.whenReady().then(async () => {
  // Entity links flag (entities.links.v1) — FIRST, before any await: every
  // renderer reports its persisted toggle with a synchronous IPC at
  // bootstrap, so the listener must exist even if later init throws (a
  // window created afterwards, e.g. macOS 'activate', must never block on an
  // unanswered sendSync). Registered unconditionally — local, thin-client
  // and headless hosts all parse rox:// deep links in this process. Main
  // owns the effective state (env override > toggle) and keeps a durable
  // copy so cold-start entity deep links see the user's setting.
  try {
    loadPersistedEntitiesLinksFlag(CONFIG_DIR, { logger: mainLog })
  } catch (error) {
    mainLog.error('[entities] failed to load the entities.links.v1 durable copy:', error)
  }
  registerEntitiesLinksIpc(ipcMain, {
    // Evaluated at call time (windowManager is assigned below); the
    // registered-webcontents form is safe for the preload sendSync channel.
    isTrustedSender: (event) => isRegisteredRoxRendererWebContents(event.sender),
    broadcast: (channel, state) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, state)
      }
    },
  })

  markStartup(STARTUP_MARKS.appReady)
  // PERF-01: one compact `[perf] startup …` line (and ROX_PERF_OUT JSON) with ROX_PERF=1.
  reportStartupTimelineWhenSettled((line) => mainLog.info(line))
  // Renderer startup/navigation marks (fire-and-forget, Rox windows only).
  ipcMain.on(STARTUP_PERF_MARK_CHANNEL, (event, name: unknown, epochMs: unknown) => {
    if (!isValidRendererMarkName(name) || typeof epochMs !== 'number') return
    if (!isRegisteredRoxRendererWebContents(event.sender)) return
    recordRendererMark(name, epochMs)
  })

  // Export packaged state as env var so logger.ts (and headless Bun) don't need 'electron'
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? 'true' : 'false'

  // Register bundled assets root so all seeding functions can find their files
  // (docs, permissions, themes, tool-icons resolve via getBundledAssetsDir)
  setBundledAssetsRoot(__dirname)

  // ── PERF-01 shell-first boot ─────────────────────────────────────────────
  // Create the shell window (and the preload-critical IPC it evaluates
  // synchronously) before the heavy startup work: credential vault restore,
  // proxy apply, the RPC server bootstrap and everything after it (messaging
  // init, model refresh, workspace connects). The renderer renders its loading
  // splash and waits for the local transport through `__await-ws-port`, which
  // main settles only once the server is listening and its sinks are wired —
  // so no renderer RPC is issued before the server, while the window is on
  // screen throughout.
  const isClientOnly = !!process.env.CRAFT_SERVER_URL
  const isHeadless = !!process.env.CRAFT_HEADLESS
  try {
    windowManager = new WindowManager()
    ipcMain.on('__get-web-contents-id', (e) => {
      e.returnValue = e.sender.id
    })
    ipcMain.on('__get-workspace-id', (e) => {
      e.returnValue = readBoundWindowWorkspace(e, windowManager)
    })
    ipcMain.on('__get-local-client-proof', (e) => {
      const owner = windowManager?.getWindowByWebContentsId(e.sender.id)
      e.returnValue = owner && !owner.isDestroyed() && owner.webContents === e.sender
        ? localClientBindingRegistry.issue(e.sender)
        : ''
    })
    ipcMain.on('__get-workspace-remote-config', (e) => {
      const wsId = windowManager?.getWorkspaceForWindow(e.sender.id)
      if (!wsId) { e.returnValue = null; return }
      const ws = getWorkspaceByNameOrId(wsId)
      e.returnValue = ws?.remoteServer ?? null
    })
    ipcMain.handle('__await-ws-port', async (event) => {
      if (!isRegisteredRoxRendererWebContents(event.sender)) throw new Error('IPC_SENDER_DENIED')
      const port = await wsPortReady
      markStartupOnce(STARTUP_MARKS.wsPortHanded)
      return port
    })
    // PERF-01 shell-first boot: the preload unconditionally resolves the project
    // authority during its eval (publish → setWorkspace → invoke). The channel
    // must therefore exist by the time the shell window evaluates its preload,
    // i.e. before createInitialWindows — otherwise the invoke rejects and the
    // connection silently settles as 'denied' with no retry. Dependencies are
    // only windowManager (already constructed) and a lazy import — kept dynamic
    // so the project-authority implementation stays off the shell-first boot
    // critical path (its graph is only needed once a renderer actually asks).
    ipcMain.handle('__project-authority:resolve', async (event, localWorkspaceId: unknown) => {
      const bound = windowManager?.getWorkspaceForWindow(event.sender.id)
      if (!bound || typeof localWorkspaceId !== 'string' || localWorkspaceId !== bound) throw new Error('WORKSPACE_MISMATCH')
      const { resolveStoredProjectAuthority } = await import('./project-authority')
      const result = await resolveStoredProjectAuthority(bound)
      if (windowManager?.getWorkspaceForWindow(event.sender.id) !== bound) throw new Error('WORKSPACE_MISMATCH')
      return result
    })
    if (!isHeadless) await createInitialWindows()
    // Application menu is built after the window so its native construction
    // stays off the `window-created` critical path (it needs windowManager for
    // the New Window action).
    if (windowManager) createApplicationMenu(windowManager)
  } catch (error) {
    mainLog.error('[startup] shell-first window creation failed:', error)
  }

  if (process.platform === 'win32' && !process.env.CRAFT_SERVER_URL) {
    markStartup(STARTUP_MARKS.winBootstrapStart)
    const { initializeWindowsBootstrap, scheduleWindowsBootstrapRepair, createWindowsRepairSpawnGate } = await import('./windows-bootstrap')
    const { getToolchainDependencyMode, getGitBashPath } = await import('@rox/shared/config')
    const bootstrapOptions = {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      managedRoot: join(CONFIG_DIR, 'toolchain'),
      preference: getToolchainDependencyMode(),
      gitBashPreference: getGitBashPath(),
      appVersion: app.getVersion(),
    }
    // PERF-03: parallel, cached `--version` probes; never runs bootstrap.ps1 here.
    const result = await initializeWindowsBootstrap(bootstrapOptions)
    markStartup(STARTUP_MARKS.winBootstrapEnd)
    // Structured non-secret diagnostics; never log receipt errors or process output.
    if (result?.missingTools.length) mainLog.warn('[windows-bootstrap]', result)
    else if (result) mainLog.info('[windows-bootstrap]', result)
    if (result?.repairNeeded) {
      // Offline repair runs at most once per backoff window, after first paint —
      // or immediately once a spawn needs the prerequisites (gate waiter expedites).
      // Spawns wait up to 6 s from bootstrap.ps1 start, 12 s overall; latching.
      const repairGate = createWindowsRepairSpawnGate()
      registerSpawnEnvGate('windows-repair', repairGate.gate)
      void scheduleWindowsBootstrapRepair({
        ...bootstrapOptions,
        missingTools: result.missingTools,
        mode: result.mode,
        after: whenStartupMark(STARTUP_MARKS.rendererFirstPaint),
        signals: repairGate.signals,
      }).then((repair) => {
        if (repair.ran) mainLog.warn('[windows-bootstrap] background repair', repair)
        else mainLog.info('[windows-bootstrap] background repair skipped', repair)
      }).catch((err) => mainLog.warn('[windows-bootstrap] background repair failed:', err))
        .finally(() => repairGate.settle())
    }
  }

  try {
    const vault = await getCredentialManager().tryRestoreVaultFromBackup()
    if (vault === 'restored') {
      mainLog.warn('[credentials] Recovered credentials.enc from backup after vault repair')
    } else if (vault === 'unavailable') {
      mainLog.error('[credentials] Encrypted credential vault needs repair; local WS auth may fail until restored')
    }
  } catch (err) {
    mainLog.error('[credentials] Vault auto-restore failed:', err)
  }
  // Initialize backend runtime bootstrapping (Codex vendor root, Claude SDK runtime paths).
  initializeBackendHostRuntime({
    hostRuntime: {
      appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
    },
  })

  // Register PowerShell validator root so it can find the bundled parser script
  // (Windows only: validates PowerShell commands in Explore mode using AST analysis)
  setPowerShellValidatorRoot(join(__dirname, 'resources'))

  // Initialize bundled docs
  initializeDocs()

  // Sync bundled skill packs into <config>/skills (never throws; hash-merge).
  // PERF-02: claimed now (so the server bootstrap does not run it again), but
  // the work starts only after the renderer's first paint: an O(1) stamp check,
  // and only when the bundle/config changed a full merge in a worker thread.
  void ensureBundledSkillsInBackground({
    workerScript: join(__dirname, 'bundled-skills-worker.cjs'),
    after: whenStartupMark(STARTUP_MARKS.rendererFirstPaint).then(() => markStartup(STARTUP_MARKS.skillsSyncStart)),
    log: (level, message, data) => mainLog[level](message, data),
  }).then((outcome) => {
    if (outcome.via === 'inline') markStartupOnce(STARTUP_MARKS.skillsSyncInline)
    markStartupOnce(STARTUP_MARKS.skillsSyncEnd)
    if (outcome.status === 'failed') mainLog.warn('[bundled-skills] background sync failed:', outcome.error)
  })

  // Initialize bundled release notes
  initializeReleaseNotes()

  // Ensure default permissions file exists (copies bundled default.json on first run)
  ensureDefaultPermissions()

  // Seed tool icons to {configDir}/tool-icons/ (copies bundled SVGs on first run)
  ensureToolIcons()

  // Seed preset themes to ~/.craft-agent/themes/ (copies bundled theme JSONs on first run)
  ensurePresetThemes()

  // Register thumbnail:// protocol handler (scheme was registered earlier, before app.whenReady)
  registerThumbnailHandler()

  // Re-apply proxy settings now that Electron sessions are available
  // (first call before app.whenReady only configured Node-level proxy)
  await applyConfiguredProxySettings()

  // Cancel third-party citation-favicon fetches on the app renderer session.
  // Installed once here, before any window is created/loaded.
  installRendererSessionPolicy(session.defaultSession)

  // Note: electron-updater handles pending updates internally via autoInstallOnAppQuit

  // Application menu is created after windowManager initialization (see below)

  // Set dock icon on macOS — force full-color PNG (Tahoe / Assets.car can look dimmed in Dock).
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = resolveAppIconPngPath()

    if (dockIconPath) {
      try {
        const dockIcon = nativeImage.createFromPath(dockIconPath)
        if (!dockIcon.isEmpty()) {
          app.dock.setIcon(dockIcon)
        }
      } catch (err) {
        mainLog.warn('Failed to set dock icon', err)
      }
      initBadgeIcon(dockIconPath)
    }

    // Multi-instance dev: show instance number badge on dock icon
    // CRAFT_INSTANCE_NUMBER is set by detect-instance.sh for numbered folders
    const instanceNum = numberedInstance
    if (instanceNum) {
      const num = parseInt(instanceNum, 10)
      if (!isNaN(num) && num > 0) {
        initInstanceBadge(num)
      }
    }
  }

  try {
    // windowManager was created in the shell-first block above; if that failed
    // the app cannot open any window, so fail the same way the old in-try
    // construction did.
    if (!windowManager) throw new Error('Window manager was not initialized')
    openDesignRuntime = new OpenDesignRuntimeManager({
      userDataDir: join(app.getPath('userData'), 'open-design-runtime'),
      windowController: new OpenDesignWindowController(),
    })
    registerOpenDesignIpcHandlers({
      ipcMain,
      isTrustedSender: isTrustedRoxRendererIpcEvent,
      runtime: openDesignRuntime,
    })

    // When CRAFT_SERVER_URL is set, this Electron instance is a thin client —
    // it only creates windows whose preload connects to the remote server.
    // Skip server-side initialization (SessionManager, model refresh, platform injection).
    if (isClientOnly) {
      mainLog.info(`Client-only mode: CRAFT_SERVER_URL=${process.env.CRAFT_SERVER_URL} (server initialization skipped)`)
    }

    // Initialize notification service (always — triggered by server push events)
    initNotificationService(windowManager)

    // Initialize browser pane manager (always — even in headless, for deps wiring)
    browserPaneManager = new BrowserPaneManager()
    browserPaneManager.setWindowManager(windowManager)
    browserPaneManager.registerToolbarIpc()
    browserPaneManager.registerCapabilityIpc()

    const { registerVoiceHotkeys } = await import('./voice/overlay-window')
    const { sendVoiceHotkeyToClient } = await import('./voice/command-input')
    const sendVoiceCommand = (command: import('@rox/shared/voice/hotkey-types').HotkeyCommand, webContentsId?: number, recordingId?: string) => {
      const target = webContentsId === undefined
        ? windowManager?.getLastActiveWindow()
        : windowManager?.getWindowByWebContentsId(webContentsId)
      if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return false
      return sendVoiceHotkeyToClient({
        webContentsId: target.webContents.id,
        isManagedWindow: id => Boolean(windowManager?.getWindowByWebContentsId(id)),
        resolveClient: id => windowManager?.getClientIdForWindow(id),
        push: windowManager?.getRpcEventSink(),
        channel: RPC_CHANNELS.voice.HOTKEY,
      }, command, recordingId)
    }
    const disposeVoiceHotkeys = registerVoiceHotkeys(sendVoiceCommand, id => windowManager?.getFocusedWindow()?.webContents.id === id)
    const { createNativeVoiceOverlayHost } = await import('./voice/overlay-owner')
    const voiceOverlay = !isHeadless && !isClientOnly ? createNativeVoiceOverlayHost({
      resolveOwner(context) {
        if (context.webContentsId == null || !context.workspaceId) return null
        const owner = windowManager?.getWindowByWebContentsId(context.webContentsId)
        return owner && !owner.isDestroyed() && windowManager?.getWorkspaceForWindow(context.webContentsId) === context.workspaceId
          && windowManager?.getClientIdForWindow(context.webContentsId) === context.clientId ? owner : null
      },
      sendCommand: (context, command, recordingId) => context.webContentsId != null && sendVoiceCommand(command, context.webContentsId, recordingId),
    }) : undefined
    app.once('will-quit', () => { disposeVoiceHotkeys(); voiceOverlay?.dispose() })
    registerMeetingCaptureIpc({
      getWorkspaceForWindow: (id) => windowManager?.getWorkspaceForWindow(id) ?? null,
      getWorkspaceGenerationForWindow: (id) => windowManager?.getWorkspaceGenerationForWindow(id) ?? null,
    })
    const localMeetings = registerLocalMeetingsIpc((message, error) => (error ? mainLog.warn(message, error) : mainLog.info(message)), {
      getWorkspaceForWindow: (id) => windowManager?.getWorkspaceForWindow(id) ?? null,
      getWorkspaceGenerationForWindow: (id) => windowManager?.getWorkspaceGenerationForWindow(id) ?? null,
    })
    registerMailIpc((message, error) => (error ? mainLog.warn(message, error) : mainLog.info(message)), {
      isTrustedSender: isTrustedRoxRendererIpcEvent,
    })

    // R4: point the shared tg-link RPC handlers at this host's linkd daemon.
    const telegramLink = registerTelegramLink()
    mainLog.info(`[telegram-link] service endpoint ${telegramLink.baseUrl}${telegramLink.authTokenConfigured ? ' (bearer configured)' : ''}`)
    registerCalendarGoogleOAuthIpc({
      ipcMain,
      isTrustedSender: (event) => Boolean(windowManager?.getWindowByWebContentsId(event.sender.id)),
      openExternal: (url) => shell.openExternal(url),
    })

    // Apple Calendar (macOS EventKit): register the helper binding only when
    // APPLE_CALENDAR_LIVE=1 and the bundled binary exists. Fail-closed — with the
    // gate off or the binary absent the connector keeps returning Unavailable.
    registerAppleCalendarHelperFromHost({
      log: (message, error) => {
        if (error) mainLog.warn(message, error)
        else mainLog.info(message)
      },
    })

    // Build real PlatformServices from Electron APIs
    const platform: PlatformServices = createElectronPlatform({
      app,
      nativeImage,
      shell,
      nativeTheme,
      logger: log,
      isDebugMode,
      getLogFilePath,
      captureError: (err) => {
        errorLog.error('[captureError]', { error: err })
      },
    })

    // W1-13: Settings toggle for storage.visible-root.v1 (applies on next launch).
    registerStorageVisibleRootIpc({
      ipcMain,
      isTrustedSender: (event) => Boolean(windowManager?.getWindowByWebContentsId(event.sender.id)),
    })
    registerStorageMigrationNoticeIpc({
      ipcMain,
      isTrustedSender: (event) => Boolean(windowManager?.getWindowByWebContentsId(event.sender.id)),
      notice: visibleHomeBoot?.notice ?? null,
    })

    registerDeviceDiagnosticsIpc({
      ipcMain,
      windowManager,
      rendererFilePath: join(__dirname, 'renderer/index.html'),
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      getLogPaths: () => ({
        main: getLogFilePath(),
        messaging: getMessagingGatewayLogFilePath(),
        updates: getAutoUpdateLogFilePath(),
      }),
    })

    // Bootstrap IPC handlers — preload uses sendSync for window-local details
    ipcMain.on('__get-web-contents-id', (e) => {
      e.returnValue = e.sender.id
    })
    ipcMain.on('__get-workspace-id', (e) => {
      e.returnValue = readBoundWindowWorkspace(e, windowManager)
    })
    ipcMain.on('__get-local-client-proof', (e) => {
      const owner = windowManager?.getWindowByWebContentsId(e.sender.id)
      e.returnValue = owner && !owner.isDestroyed() && owner.webContents === e.sender
        ? localClientBindingRegistry.issue(e.sender)
        : ''
    })
    // Product analytics bootstrap: the renderer reuses main's baked endpoints and
    // anonymous distinct_id so both processes report the same person.
    ipcMain.on('__telemetry-config', (e) => {
      e.returnValue = telemetryBootstrapConfig
    })
    // Language change: sync from renderer to main process, persist, and rebuild native menu.
    // Persistence here is what lets the next app launch hydrate main's i18n correctly —
    // see the `getPersistedUiLanguage()` block at the top of this file.
    ipcMain.handle('i18n:changeLanguage', async (event, lang: unknown) => {
      assertTrustedRenderer(event)
      const previousResolved = i18n.resolvedLanguage ?? null
      if (typeof lang !== 'string' || !SUPPORTED_LANGUAGE_CODES.includes(lang as LanguageCode)) {
        // Defense-in-depth: renderer guarantees a supported code, but if a renegade
        // caller hands us garbage we drop it silently rather than poison i18n state.
        mainLog.warn('[i18n] changeLanguage IPC rejected — unsupported code', {
          incoming: lang,
          previousResolved,
        })
        return
      }
      const code = lang as LanguageCode
      await i18n.changeLanguage(code)
      setPersistedUiLanguage(code)
      mainLog.info('[i18n] changeLanguage IPC applied', {
        incoming: code,
        previousResolved,
        newResolved: i18n.resolvedLanguage ?? null,
      })
      const { rebuildMenu } = await import('./menu')
      await rebuildMenu()
    })

    // W1-07 (#1504): unified surface route gate (renderer flags → main deep
    // links). Registered in every mode, thin client included: deep links are
    // parsed in main either way and the gate is default-closed until pushed.
    const { registerSurfaceRoutesIpc } = await import('./surface-routes-ipc')
    registerSurfaceRoutesIpc(ipcMain, {
      isTrustedSender: (event) => isRegisteredRoxRendererWebContents(event.sender),
    })

    // Transport diagnostics bridge — preload reports remote WS connection state changes
    // so failures are visible in terminal/main.log (not only renderer console).
    ipcMain.on('__transport:status', (event, payload: unknown) => {
      // Log-only channel; preload `send` — registered-webcontents guard only.
      if (!isRegisteredRoxRendererWebContents(event.sender)) return
      if (!payload || typeof payload !== 'object') return
      const p = payload as {
        level?: 'info' | 'warn' | 'error'
        message?: string
        status?: string
        attempt?: number
        nextRetryInMs?: number
        error?: unknown
        close?: unknown
        url?: string
      }

      const level = p.level ?? 'info'
      const message = p.message ?? '[transport] status update'
      const context = {
        status: p.status,
        attempt: p.attempt,
        nextRetryInMs: p.nextRetryInMs,
        error: p.error,
        close: p.close,
        url: p.url,
      }

      if (level === 'error') {
        mainLog.error(message, context)
      } else if (level === 'warn') {
        mainLog.warn(message, context)
      } else {
        mainLog.info(message, context)
      }
    })

    // Dialog bridge — preload capability handlers use ipcRenderer.invoke to
    // call main-process-only dialog APIs (dialog, BrowserWindow).
    ipcMain.handle('__dialog:showMessageBox', async (event, spec) => {
      assertTrustedRenderer(event)
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showMessageBox(win, spec)
      return { response: result.response }
    })
    ipcMain.handle('__dialog:showOpenDialog', async (event, spec) => {
      assertTrustedRenderer(event)
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, spec)
      return { canceled: result.canceled, filePaths: result.filePaths }
    })
    ipcMain.handle('notes:exportPdf', async (event, opts: { html: string; defaultPath: string }) => {
      assertTrustedRenderer(event)
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      if (!win) return { canceled: true }
      const result = await dialog.showSaveDialog(win, {
        defaultPath: opts.defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      const hidden = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
      await hidden.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(opts.html)}`)
      const pdfBuffer = await hidden.webContents.printToPDF({ printBackground: true })
      hidden.destroy()
      const { writeFile } = await import('fs/promises')
      await writeFile(result.filePath, pdfBuffer)
      return { canceled: false, filePath: result.filePath }
    })
    // Generic text save dialog (knowledge surface markdown export, etc.)
    ipcMain.handle(
      'file:saveText',
      async (
        event,
        opts: { content: string; defaultPath: string; filters?: Array<{ name: string; extensions: string[] }> },
      ) => {
        assertTrustedRenderer(event)
        const win =
          BrowserWindow.fromWebContents(event.sender) ||
          BrowserWindow.getFocusedWindow() ||
          BrowserWindow.getAllWindows()[0]
        if (!win) return { canceled: true as const }
        const result = await dialog.showSaveDialog(win, {
          defaultPath: opts.defaultPath,
          filters: opts.filters ?? [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        })
        if (result.canceled || !result.filePath) return { canceled: true as const }
        const { writeFile } = await import('fs/promises')
        await writeFile(result.filePath, opts.content, 'utf-8')
        return { canceled: false as const, filePath: result.filePath }
      },
    )

    // Thin clients also keep local encrypted Notes custody; the remote server
    // supplies canonical actor/workspace context through the preload bridge.
    cleanupNativeReplicaIpc = registerNativeReplicaForWindows(ipcMain, {
      configDir: realpathSync(CONFIG_DIR),
      credentials: getCredentialManager(),
      getWindowManager: () => windowManager,
    })

    if (!isClientOnly) {
      // Restore persisted Git Bash path on Windows (must happen before any SDK subprocess spawn)
      if (process.platform === 'win32') {
        const { getGitBashPath } = await import('@rox/shared/config')
        const gitBashPath = getGitBashPath()
        if (gitBashPath) {
          const validation = await validateGitBashPath(gitBashPath)
          if (validation.valid) {
            process.env.CLAUDE_CODE_GIT_BASH_PATH ??= validation.path
          } else {
            mainLog.warn('Persisted Git Bash path is unusable; preference retained for repair')
          }
        }
      }

      // Check for VC++ Redistributable on Windows (required by onnxruntime / markitdown).
      // Without it, document conversion tools (PDF, PPTX, DOCX, XLSX) crash with DLL errors.
      // Sets env var so renderer can show an actionable toast with install button.
      if (process.platform === 'win32') {
        const vcCheck = checkVCRedistInstalled()
        if (!vcCheck.installed) {
          mainLog.warn('[vcredist]', vcCheck.message)
          process.env.CRAFT_VCREDIST_MISSING = '1'
          if (vcCheck.downloadUrl) {
            process.env.CRAFT_VCREDIST_URL = vcCheck.downloadUrl
          }
        } else if (isDebugMode) {
          mainLog.info('[vcredist]', vcCheck.message)
        }
      }

      // Pre-import power manager (async import needed for applyPlatformToSubsystems)
      const { onSessionStarted, onSessionStopped } = await import('./power-manager')

      // Client ID tracking for Electron IPC bridge (webContentsId → clientId)
      const clientMap = new Map<number, string>()
      const resolveClientId = (wcId: number) => clientMap.get(wcId)

      // WorkGraph is an Electron-main capability. Constructor work is inert;
      // native database provisioning remains lazy behind its local-only RPCs.
      workGraphKernel = isHeadless ? null : createWorkGraphKernel({ configDir: CONFIG_DIR })

      // Native Electron is the only host that composes a managed runtime.
      // Headless and thin-client paths intentionally leave the optional core
      // service absent, so they return its controlled unsupported response.
      const openClawSecurity = isHeadless ? null : createOpenClawSecurityComposition()
      if (openClawSecurity) {
        openClawSecurityAuditService = openClawSecurity.auditService
        openClawRuntimeManager = openClawSecurity.runtimeManager
        if (windowManager) {
          const confirmOpenClawHostControl = createOpenClawHostControlConfirmation({
            translate: (key, interpolation) => i18n.t(key, interpolation),
            showMessageBox: (owner, options) => dialog.showMessageBox(owner as BrowserWindow, options),
          })
          registerOpenClawHostControlIpc({
            ipcMain,
            windowManager,
            runtimeManager: openClawSecurity.runtimeManager,
            clipboard,
            createEphemeralSession: partition => session.fromPartition(partition),
            createControlUiWindow: options => {
              // This object is built solely by the host-control module, not
              // from IPC input. Electron's richer structural type is required
              // only at this main-process construction boundary.
              const browserWindowOptions = options as unknown as BrowserWindowConstructorOptions
              return new BrowserWindow(browserWindowOptions)
            },
            desktopBridge: {
              isClientOnly,
              preloadPath: join(__dirname, 'rox-desktop-preload.cjs'),
            },
            confirm: async ({ action, workspaceId, owner }) => {
              const ownerWindow = windowManager?.getWindowByWebContentsId(owner.webContents.id)
              if (!ownerWindow) return false
              return confirmOpenClawHostControl({ action, workspaceId, owner: ownerWindow })
            },
          })

          // Main-process side of the embedded desktop bridge. Handlers reuse the
          // BrowserPaneManager, the onboarding permission host, the OpenClaw
          // runtime manager, the system clipboard opener and native notifications.
          const browserPaneHost = browserPaneManager!
          const desktopBridgeBrowser: DesktopBridgeBrowserHost = {
            async openInstance({ id, workspaceId, url, show }) {
              const instanceId = browserPaneHost.createInstance(id, { workspaceId, show, ownerType: 'manual' })
              if (url) await browserPaneHost.navigate(instanceId, url)
              return instanceId
            },
            navigateInstance: ({ id, url }) => browserPaneHost.navigate(id, url),
            async releaseScope({ workspaceId }) {
              const released = browserPaneHost
                .listInstances()
                .filter(info => info.workspaceId === workspaceId)
                .map(info => info.id)
              for (const instanceId of released) browserPaneHost.destroyInstance(instanceId)
              return { released }
            },
          }
          registerDesktopBridgeIpc({
            ipcMain,
            browser: desktopBridgeBrowser,
            permissions: { probePermissions: () => createOnboardingPermissionsHost().probePermissions() },
            openExternal: url => shell.openExternal(url),
            gateway: { getStatus: workspaceId => openClawSecurity.runtimeManager.getRuntimeStatus(workspaceId) },
            notify: ({ title, body }) => {
              if (Notification.isSupported()) new Notification({ title, body }).show()
            },
          })
        }
      }

      // Read embedded server config (Server settings page)
      const { getServerConfig, resolveConfigDir } = await import('@rox/shared/config')
      const embeddedServerConfig = getServerConfig()
      const serverModeEnabled = embeddedServerConfig.enabled && !isClientOnly

      // Derive host/port/token from server config (or env overrides)
      const serverToken = serverModeEnabled && embeddedServerConfig.token
        ? embeddedServerConfig.token
        : randomUUID()
      const rpcHost = process.env.CRAFT_RPC_HOST
        ?? (serverModeEnabled ? '0.0.0.0' : '127.0.0.1')
      const rpcPort = process.env.CRAFT_RPC_PORT
        ? parseInt(process.env.CRAFT_RPC_PORT, 10)
        : (serverModeEnabled ? embeddedServerConfig.port : 0)

      // Load TLS certificates if configured
      let tls: import('@rox/server-core/transport').WsRpcTlsOptions | undefined
      if (serverModeEnabled && embeddedServerConfig.tlsCertPath && embeddedServerConfig.tlsKeyPath) {
        try {
          tls = {
            cert: readFileSync(embeddedServerConfig.tlsCertPath),
            key: readFileSync(embeddedServerConfig.tlsKeyPath),
          }
          mainLog.info('[server-mode] TLS enabled')
        } catch (err) {
          mainLog.error('[server-mode] Failed to load TLS certificates:', err)
        }
      }

      if (serverModeEnabled) {
        mainLog.info(`[server-mode] Enabled — binding ${rpcHost}:${rpcPort}${tls ? ' (TLS)' : ''}`)
      }

      // Bootstrap the WS RPC server via shared bootstrap function.
      let localNativeAuthority: NonNullable<HandlerDeps['nativeData']>['authority'] | null = null
      // f.9 — server-owned node/device registry (default bounds). Mirrors the
      // standalone headless server so `nodes:*` is live instead of
      // CHANNEL_NOT_FOUND on the real WS RPC server.
      const nodeRegistry = new NodeRegistry()
      const instance = await bootstrapServer<SessionManager, HandlerDeps>({
        serverToken,
        rpcHost,
        rpcPort,
        tls,
        bundledAssetsRoot: __dirname,
        serverId: 'local',
        serverVersion: app.getVersion(),
        platformFactory: () => platform,
        applyPlatformToSubsystems: (p) => {
          setFetcherPlatform(p)
          setSessionPlatform(p)
          setSessionRuntimeHooks({
            updateBadgeCount,
            onSessionStarted,
            onSessionStopped,
            // PERF-03: a new agent waits (bounded, latching) for the spawn env
            // (macOS shell capture / Windows repair) and, only on first install
            // or upgrade (stamp miss), for the bundled-skills merge (~10 s cap).
            // Both run concurrently: worst case max(env, 10 s), and the skills
            // merge is released immediately rather than after the env wait.
            beforeAgentSpawn: async () => {
              await Promise.all([whenSpawnEnvReady(), whenBundledSkillsReadyForAgents(10_000)])
            },
            captureException: (error, context) => {
              const normalized = error instanceof Error ? error : new Error(String(error))
              errorLog.error('[captureException]', {
                message: normalized.message,
                error: normalized,
                errorSource: context?.errorSource,
                sessionId: context?.sessionId,
              })
            },
          })
          setSearchPlatform(p)
          setImageProcessor(p.imageProcessor)
        },
        createSessionManager: () => {
          const sm = new SessionManager()
          sm.setBrowserPaneManager(browserPaneManager!)
          // Page preview posters: offscreen capture is Electron-main-only. On
          // capture, nudge the watcher so the pages:changed push carries the
          // fresh thumbnail pointer to open grids.
          const pageThumbnailer = new PageThumbnailer({
            log: (m) => mainLog.info(m),
            onCaptured: ({ workspaceRootPath, slug }) => {
              sm.notifyConfigFileChange(workspaceRootPath, `pages/${slug}/page.json`)
            },
          })
          sm.setPageThumbnailer((req) => pageThumbnailer.enqueue(req))
          return sm
        },
        bindRpcServer: (sm, server) => sm.setRpcServer(server),
        createHandlerDeps: ({ sessionManager: sm, platform: p, oauthFlowStore: ofs, nativeAuthority, nativeJournal, collaborationSync }) => {
          setRoxAccountAuthority(new RoxAccountAuthority(createPocketAccountStore({ directory: join(app.getPath('userData'), 'pocket-accounts'), safeStorage })))
          localNativeAuthority = nativeAuthority
          const browserCredentialPermissions = createBrowserCredentialPermissionAdapter({
            async confirm(request) {
              const owner = request.webContentsId == null ? null : windowManager?.getWindowByWebContentsId(request.webContentsId)
              if (!owner || owner.isDestroyed() || windowManager?.getWorkspaceForWindow(owner.webContents.id) !== request.workspaceId) return 'cancel'
              const answer = await dialog.showMessageBox(owner, {
                type: 'question',
                title: i18n.t('settings.browserImport.credentials.nativeTitle'),
                message: i18n.t('settings.browserImport.credentials.nativeMessage', { profile: request.profile.name }),
                detail: i18n.t('settings.browserImport.credentials.nativeDetail'),
                buttons: [i18n.t('common.cancel'), i18n.t('settings.browserImport.credentials.nativeAllow')],
                defaultId: 0, cancelId: 0, noLink: true,
              })
              if (owner.isDestroyed() || windowManager?.getWorkspaceForWindow(owner.webContents.id) !== request.workspaceId) return 'cancel'
              return answer.response === 1 ? 'allow' : 'cancel'
            },
          })
          const browserCredentialVaultKeys = createBrowserCredentialVaultKeyStore({
            directory: join(app.getPath('userData'), 'browser-credential-keys'), safeStorage,
          })
          const browserCredentials = {
            capabilities: browserCredentialPermissions.capabilities,
            async requestAccess(request: Parameters<typeof browserCredentialPermissions.requestAccess>[0]) {
              const currentOwner = () => {
                const owner = request.webContentsId == null ? null : windowManager?.getWindowByWebContentsId(request.webContentsId)
                return owner && !owner.isDestroyed() && windowManager?.getWorkspaceForWindow(owner.webContents.id) === request.workspaceId
              }
              if (!currentOwner()) return { status: 'cancelled' as const, reason: 'browser-credential-access-cancelled' }
              const grant = await browserCredentialPermissions.requestAccess(request)
              if (grant.status === 'granted' && !currentOwner()) {
                grant.release()
                return { status: 'cancelled' as const, reason: 'browser-credential-access-cancelled' }
              }
              return grant
            },
            vaultKeys: browserCredentialVaultKeys,
          }
          // The messaging handle is built here because it needs sessionManager.
          // The WS publisher is attached after bootstrapServer resolves (via
          // handle.setPublisher) because wsServer isn't available yet.
          messagingHandle = createMessagingBootstrap({
            sessionManager: sm,
            credentialManager: getCredentialManager(),
            getMessagingDir: (wsId: string) =>
              join(CONFIG_DIR, 'workspaces', wsId, 'messaging'),
            getLegacyMessagingDir: (wsId: string) => {
              const ws = getWorkspaces().find((w) => w.id === wsId)
              return ws ? join(ws.rootPath, 'messaging') : undefined
            },
            // Route messaging diagnostics through the dedicated messaging log
            // at ~/.craft-agent/logs/messaging-gateway.log.
            logger: messagingGatewayLog,
            // WhatsApp worker runs under Electron's embedded Node via
            // ELECTRON_RUN_AS_NODE (WhatsAppAdapter defaults nodeBin to
            // process.execPath). In dev we resolve worker.cjs from the
            // monorepo; in packaged builds it's shipped via extraResources
            // (see apps/electron/electron-builder.yml).
            whatsapp: {
              workerEntry: app.isPackaged
                ? join(process.resourcesPath, 'messaging-whatsapp-worker', 'worker.cjs')
                : join(process.cwd(), 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs'),
              pairingMode: 'qr',
            },
            // Discord worker: same embedded-Node spawn model as WhatsApp.
            // Dev resolves worker.cjs from the monorepo; packaged builds ship
            // it via extraResources (see apps/electron/electron-builder.yml).
            discord: {
              workerEntry: app.isPackaged
                ? join(process.resourcesPath, 'messaging-discord-worker', 'worker.cjs')
                : join(process.cwd(), 'packages', 'messaging-discord-worker', 'dist', 'worker.cjs'),
            },
          })
          const learning = sm.getLearningRpcService()
          return {
            sessionManager: sm,
            platform: p,
            windowManager: windowManager ?? undefined,
            browserPaneManager: browserPaneManager ?? undefined,
            oauthFlowStore: ofs,
            messagingRegistry: messagingHandle.registry,
            // Workspace-work link validation: a meeting link only resolves when the
            // local meeting belongs to the workspace (and the action anchor exists).
            workspaceWorkReferences: {
              exists: (workspaceId, _root, link) => {
                if (link.kind !== 'meeting') return false
                const meeting = localMeetings.read(link.id)
                return meeting?.workspaceId === workspaceId && (!link.anchor || meeting.actions.some(action => action.id === link.anchor))
              },
            },
            ...(!isHeadless ? { browserCredentials } : {}),
            ...(voiceOverlay ? { voiceOverlay } : {}),
            // OS permission probes for onboarding; absent when headless so the
            // handler answers honest `unsupported` instead of faking a grant.
            ...(!isHeadless ? { onboardingPermissions: createOnboardingPermissionsHost() } : {}),
            ...(openClawSecurity ? { openClawSecurity: openClawSecurity.service } : {}),
            nativeData: { authority: nativeAuthority, journal: nativeJournal, sync: collaborationSync },
            // WP-117: `learning:*` RPC surface (UNSUPPORTED_OPERATION when absent).
            ...(learning ? { learning } : {}),
            // ROX Drive (wave 1): device-local storage engine.
            drive: createDriveService(),
            // f.9 — node/device RPC surface (see the headless server for context).
            nodes: nodeRegistry,
          }
        },
        // Headless: register only core handlers (no GUI handlers for browser, settings, etc.)
        // GUI: register all handlers plus the main-process-owned WorkGraph profile.
        registerAllRpcHandlers: isHeadless
          ? (server, deps, serverCtx) => registerCoreRpcHandlers(server, deps, serverCtx)
          : (server, deps, serverCtx) => {
              registerAllRpcHandlers(
                server,
                deps,
                serverCtx,
                workGraphKernel ?? undefined,
              )
              // Rox History capture loop: idempotent, fail-soft without storage.
              startClipboardMonitor(deps)
            },
        setSessionEventSink: (sm, sink) => sm.setEventSink(sink),
        initializeSessionManager: (sm) => sm.initialize(),
        initModelRefreshService: () => initModelRefreshService(async (slug: string) => {
          const { getCredentialManager } = await import('@rox/shared/credentials')
          const manager = getCredentialManager()
          const [apiKey, oauth] = await Promise.all([
            manager.getLlmApiKey(slug).catch(() => null),
            manager.getLlmOAuth(slug).catch(() => null),
          ])
          return {
            apiKey: apiKey ?? undefined,
            oauthAccessToken: oauth?.accessToken,
            oauthRefreshToken: oauth?.refreshToken,
            oauthIdToken: oauth?.idToken,
          }
        }),
        resolveLocalClientBinding: candidate => localClientBindingRegistry.resolve(candidate, webContentsId => {
          const owner = windowManager?.getWindowByWebContentsId(webContentsId)
          const workspaceId = windowManager?.getWorkspaceForWindow(webContentsId)
          if (!owner || owner.isDestroyed() || !workspaceId) return null
          return {
            webContentsId: owner.webContents.id,
            renderer: owner.webContents,
            workspaceId,
          }
        }),
        onClientConnected: ({ clientId, webContentsId, isLocalElectronClient }) => {
          if (isLocalElectronClient && webContentsId != null) clientMap.set(webContentsId, clientId)
        },
        cleanupClientResources: (clientId) => {
          for (const [wcId, cId] of clientMap) {
            if (cId === clientId) { clientMap.delete(wcId); break }
          }
          cleanupCoreClientResources(clientId)
        },
      })

      markStartup(STARTUP_MARKS.serverReady)
      // f.9 — drive node presence TTL expiry. The bootstrap-owned scheduler owns
      // the timer; Electron's quit path terminates the process, which reclaims it.
      instance.scheduler.scheduleEvery({
        id: 'nodes:presence-sweep',
        everyMs: DEFAULT_PRESENCE_TTL_MS,
        run: () => { nodeRegistry.sweep() },
      })
      // Capture module-level references for before-quit cleanup and deep-link handlers
      sessionManager = instance.sessionManager
      oauthFlowStore = instance.oauthFlowStore
      moduleSink = instance.wsServer.push.bind(instance.wsServer)
      moduleClientResolver = resolveClientId

      // -----------------------------------------------------------------------
      // Messaging Gateway — attach the WS publisher, init local workspaces,
      // install the fan-out event sink. The handle was created inside
      // createHandlerDeps so the registry could be wired into HandlerDeps.
      // -----------------------------------------------------------------------
      try {
        if (!messagingHandle) {
          throw new Error('Messaging handle was not constructed in createHandlerDeps')
        }

        messagingHandle.setPublisher(instance.wsServer.push.bind(instance.wsServer))

        // Skip remote-owned workspaces — messaging runs on the remote server.
        const localWorkspaceIds = getWorkspaces()
          .filter((ws) => !ws.remoteServer)
          .map((ws) => ws.id)
        await messagingHandle.initializeWorkspaces(localWorkspaceIds)

        // Compose fan-out event sink: RPC push + messaging gateway dispatch.
        // Always install — this lets workspaces enable messaging at runtime
        // without a process restart.
        const baseSink = instance.wsServer.push.bind(instance.wsServer)
        instance.sessionManager.setEventSink(messagingHandle.wrapSink(baseSink))
        if (messagingHandle.registry.size > 0) {
          mainLog.info(`[messaging] Fan-out sink active for ${messagingHandle.registry.size} workspace(s)`)
        }
      } catch (err) {
        mainLog.error('[messaging] Gateway initialization failed:', err)
      }

      // IPC handlers — preload uses sendSync to get WS connection details

      // Remove workspace from config (cleanup stale entries)
      ipcMain.handle('workspace:remove', async (event, workspaceId: string) => {
        assertTrustedRenderer(event)
        const { removeWorkspace: remove } = await import('@rox/shared/config')
        return remove(workspaceId)
      })

      // SSH remote hosts + tunnels (Remote-SSH style bootstrap to a remote server)
      const { registerSshTunnelIpc } = await import('./ssh-tunnel/ipc')
      registerSshTunnelIpc({ isTrustedSender: isTrustedRoxRendererIpcEvent })

      // Cross-server RPC — invoke a channel on an arbitrary remote server.
      // RX-SEC-0006: URL рендерера проходит политику транспорта — открытый
      // текст только на loopback, иначе TLS. Без этого компрометированный
      // рендерер получает SSRF во внутреннюю сеть с нашим токеном.
      ipcMain.handle('server:invokeOnServer', async (event, url: string, token: string, channel: string, ...args: unknown[]) => {
        assertTrustedRenderer(event)
        const policy = isAllowedServerEndpoint(url)
        if (!policy.ok) throw new Error(`Blocked by server endpoint policy: ${policy.reason}`)
        const { connectToRemote } = await import('./handlers/workspace')
        const { client, error } = await connectToRemote(url, token)
        if (!client) throw new Error(error ?? 'Connection failed')
        try {
          return await client.invoke(channel, ...args)
        } finally {
          client.destroy()
        }
      })

      // Transfer session to another workspace — orchestrated in main process so
      // bundles can be moved directly between owning servers. Every connection is
      // outbound from this process: remote sources/targets are reached over WS,
      // a local target imports in-process on the embedded server — the local
      // machine never needs to accept an inbound connection.
      ipcMain.handle('session:transferToWorkspace', async (_event, sessionId: string, targetWorkspaceId: string, sessionIndex?: number, sessionCount?: number) => {
        const idx = sessionIndex ?? 0
        const count = sessionCount ?? 1
        const { getWorkspaceByNameOrId } = await import('@rox/shared/config')
        const { connectToRemote } = await import('./handlers/workspace')
        const { CHUNKED_TRANSFER_THRESHOLD, getChunkCount, invokeChunked, prepareChunkedPayload } = await import('./chunked-rpc')

        // The pull side (sessions:export) returns the whole bundle as a single
        // unchunked response frame — up to MAX_BUNDLE_SIZE_BYTES over WAN — so
        // the 30s default request timeout is not enough for transfer clients.
        const TRANSFER_REQUEST_TIMEOUT_MS = 120_000

        const targetWorkspace = getWorkspaceByNameOrId(targetWorkspaceId)
        if (!targetWorkspace) throw new Error(`Workspace ${targetWorkspaceId} not found`)
        if (!sessionManager) throw new Error('Session manager not initialized')

        // SSH-backed configs persist a stale forwarded port — resolve a live
        // { url, token } through the tunnel/bootstrap machinery before dialing.
        const { resolveRemoteConnection } = await import('./ssh-tunnel/connection-resolver')
        const { getSshTunnelManager } = await import('./ssh-tunnel/ssh-tunnel-manager')
        const resolverDeps = getSshTunnelManager().connectionResolverDeps()

        const sourceWorkspaceLocalId = windowManager?.getWorkspaceForWindow(_event.sender.id)
        if (!sourceWorkspaceLocalId) throw new Error('Unable to resolve source workspace for transfer')

        const sourceWorkspace = getWorkspaceByNameOrId(sourceWorkspaceLocalId)
        if (!sourceWorkspace) throw new Error(`Source workspace ${sourceWorkspaceLocalId} not found`)

        let bundle: any = null

        if (sourceWorkspace.remoteServer) {
          const { url: sourceUrl, token: sourceToken, remoteWorkspaceId: sourceRemoteWorkspaceId } =
            await resolveRemoteConnection(sourceWorkspace.remoteServer, resolverDeps)
          console.log(`[Transfer] Exporting remote-owned session ${sessionId} from workspace ${sourceRemoteWorkspaceId}...`)
          const { client: sourceClient, error: sourceError } = await connectToRemote(sourceUrl, sourceToken, sourceRemoteWorkspaceId, { requestTimeout: TRANSFER_REQUEST_TIMEOUT_MS })
          if (!sourceClient) throw new Error(sourceError ?? 'Connection failed to source remote server')

          try {
            bundle = await sourceClient.invoke('sessions:export', sessionId)
            if (!bundle) throw new Error(`Failed to export session ${sessionId}`)

            try {
              console.log('[Transfer] Generating conversation summary on source server...')
              const transferPayload = await sourceClient.invoke('sessions:exportRemoteTransfer', sessionId)
              if (transferPayload?.summary && bundle.session?.header) {
                ;(bundle.session.header as any).transferredSessionSummary = transferPayload.summary
                ;(bundle.session.header as any).transferredSessionSummaryApplied = false
                console.log(`[Transfer] Summary generated: ${transferPayload.summary.length} chars`)
              }
            } catch (err) {
              console.warn('[Transfer] Source-server summary generation failed:', err)
            }
          } finally {
            sourceClient.destroy()
          }
        } else {
          console.log(`[Transfer] Exporting local-owned session ${sessionId} from workspace ${sourceWorkspace.id}...`)
          bundle = await sessionManager.exportSession(sessionId, sourceWorkspace.id)
          if (!bundle) throw new Error(`Failed to export session ${sessionId}`)

          try {
            console.log('[Transfer] Generating conversation summary...')
            const transferPayload = await sessionManager.exportRemoteSessionTransfer(sessionId, sourceWorkspace.id)
            if (transferPayload?.summary && bundle.session?.header) {
              ;(bundle.session.header as any).transferredSessionSummary = transferPayload.summary
              ;(bundle.session.header as any).transferredSessionSummaryApplied = false
              console.log(`[Transfer] Summary generated: ${transferPayload.summary.length} chars`)
            }
          } catch (err) {
            console.warn('[Transfer] Summary generation failed:', err)
          }
        }

        console.log(`[Transfer] Export complete: ${bundle.session?.messages?.length ?? 0} messages, ${bundle.files?.length ?? 0} files`)

        const emitProgress = (chunkSent: number, chunkTotal: number) => {
          try { _event.sender.send('transfer:progress', { sessionIndex: idx, sessionCount: count, chunkSent, chunkTotal }) } catch { /* renderer may be gone */ }
        }

        if (!targetWorkspace.remoteServer) {
          // Local target — import in-process on the embedded server. Same method
          // the sessions:import RPC handler runs on a remote target, so the
          // result shape matches the remote path.
          console.log(`[Transfer] Target workspace ${targetWorkspace.id} is local → importing in-process`)
          emitProgress(0, 1)
          const result = await sessionManager.importSession(targetWorkspace.id, bundle, 'fork')
          emitProgress(1, 1)
          return result
        }

        const { url, token, remoteWorkspaceId } =
          await resolveRemoteConnection(targetWorkspace.remoteServer, resolverDeps)
        console.log(`[Transfer] Connecting to target remote server: ${url}`)
        const { client, error } = await connectToRemote(url, token, remoteWorkspaceId, { requestTimeout: TRANSFER_REQUEST_TIMEOUT_MS })
        if (!client) throw new Error(error ?? 'Connection failed to target remote server')
        console.log('[Transfer] Connected to target remote server')

        try {
          const preparedBundle = prepareChunkedPayload(bundle)
          const payloadSize = preparedBundle.bytes.length
          const payloadMB = (payloadSize / (1024 * 1024)).toFixed(1)

          if (payloadSize < CHUNKED_TRANSFER_THRESHOLD) {
            console.log(`[Transfer] Bundle size: ${payloadMB}MB (< 5MB threshold) → using direct RPC`)
            emitProgress(0, 1)
            const result = await client.invoke('sessions:import', remoteWorkspaceId, bundle, 'fork')
            emitProgress(1, 1)
            return result
          }

          const chunkCount = getChunkCount(payloadSize)
          console.log(`[Transfer] Bundle size: ${payloadMB}MB (>= 5MB threshold) → using chunked transfer (${chunkCount} chunks)`)
          return await invokeChunked(
            client,
            'sessions:import',
            [remoteWorkspaceId, bundle, 'fork'],
            1,
            emitProgress,
            preparedBundle,
          )
        } finally {
          client.destroy()
        }
      })

      // App relaunch (for server config changes — NOT an update install)
      ipcMain.handle('app:relaunch', (event) => {
        assertTrustedRenderer(event)
        app.relaunch()
        app.exit(0)
      })

      ipcMain.on('__get-ws-port', (e) => {
        // Preload sendSync; registered-webcontents guard only (senderFrame may be null).
        if (!isRegisteredRoxRendererWebContents(e.sender)) return
        // PERF-01 shell-first boot: the port is authoritative only once the
        // server has bound and its sinks are wired (publishWsPort). Before that
        // leave returnValue unset so the preload falls back to `__await-ws-port`
        // instead of dialling an unbooted server.
        if (wsPortValue === null) return
        markStartupOnce(STARTUP_MARKS.wsPortHanded)
        e.returnValue = wsPortValue
      })
      ipcMain.handle('__resolve-local-ws-token', async (event, expectedWorkspaceId: unknown) => {
        try {
          if (typeof expectedWorkspaceId !== 'string' || !localNativeAuthority) throw new Error('Unavailable')
          return await resolveNativeTransportCredential({
            credentials: getCredentialManager(),
            authority: localNativeAuthority,
            expectedWorkspaceId,
            legacyToken: instance.token,
            getBinding: () => {
              const owner = windowManager?.getWindowByWebContentsId(event.sender.id)
              if (!owner || owner.isDestroyed() || owner.webContents !== event.sender || event.sender.isDestroyed()) return null
              const workspaceId = windowManager?.getWorkspaceForWindow(event.sender.id)
              const workspace = workspaceId ? getWorkspaceByNameOrId(workspaceId) : null
              return workspace ? { workspaceId: workspace.id, nativeRoot: workspace.rootPath } : null
            },
          })
        } catch (err) {
          // Never propagate storage/provider exceptions or enrolled secrets through IPC errors.
          // Surface only the coarse store code so WRITE_BLOCKED and PROVIDER_UNAVAILABLE stay distinguishable.
          let code = 'UNAVAILABLE'
          if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
            code = err.code
          }
          mainLog.warn('[native-transport] resolve-local-ws-token failed:', { code, err })
          throw new Error(`Local transport credential unavailable or denied (${code})`)
        }
      })
      const projectAuthorityRequests = new Map<number, number>()
      const quiesceProjectAuthorityWindows = (workspaceId: string, initiatingSenderId: number): void => {
        for (const window of windowManager?.getAllWindowsForWorkspace(workspaceId) ?? []) {
          if (!window.isDestroyed() && window.webContents.id !== initiatingSenderId) window.webContents.send('__project-authority:configuration-changed')
        }
      }
      // __project-authority:resolve is registered in the shell-first block above
      // so the preload's eval-time invoke always finds it (PERF-01).
      ipcMain.handle('__project-authority:configuration', async (event, localWorkspaceId: unknown) => {
        const bound = windowManager?.getWorkspaceForWindow(event.sender.id)
        if (!bound || typeof localWorkspaceId !== 'string' || localWorkspaceId !== bound) throw new Error('WORKSPACE_MISMATCH')
        const { getStoredProjectAuthorityConfiguration } = await import('./project-authority')
        const result = await getStoredProjectAuthorityConfiguration(bound)
        if (event.sender.isDestroyed() || windowManager?.getWorkspaceForWindow(event.sender.id) !== bound) throw new Error('WORKSPACE_MISMATCH')
        return result
      })
      ipcMain.handle('__project-create-intent', async (event, localWorkspaceId: unknown, action: unknown, input: unknown) => {
        const senderId = event.sender.id
        const bound = windowManager?.getWorkspaceForWindow(senderId)
        if (!bound || localWorkspaceId !== bound || (typeof action !== 'string' || !['get', 'queue', 'retry', 'cancel'].includes(action))
          || (action !== 'queue' && input !== undefined)) return { state: 'blocked', eligible: false, code: 'WORKSPACE_MISMATCH' }
        const { storedProjectCreateIntent } = await import('./project-authority')
        const intentAction = action === 'get' ? 'get' : action === 'queue' ? 'queue' : action === 'retry' ? 'retry' : 'cancel'
        const result = await storedProjectCreateIntent(bound, intentAction, input, () => !event.sender.isDestroyed()
          && windowManager?.getWorkspaceForWindow(senderId) === bound)
        if (event.sender.isDestroyed() || windowManager?.getWorkspaceForWindow(senderId) !== bound) return { state: 'blocked', eligible: false, code: 'WORKSPACE_MISMATCH' }
        return result
      })
      ipcMain.handle('__license-audit-intent', async (event, localWorkspaceId: unknown, action: unknown, input: unknown) => {
        const senderId = event.sender.id
        const bound = windowManager?.getWorkspaceForWindow(senderId)
        if (!bound || localWorkspaceId !== bound || (typeof action !== 'string' || !['get', 'queue', 'retry', 'cancel'].includes(action))
          || (action !== 'queue' && input !== undefined)) return { state: 'blocked', eligible: false, code: 'WORKSPACE_MISMATCH' }
        const { storedLicenseAuditIntent } = await import('./project-authority')
        const intentAction = action === 'get' ? 'get' : action === 'queue' ? 'queue' : action === 'retry' ? 'retry' : 'cancel'
        const result = await storedLicenseAuditIntent(bound, intentAction, input, () => !event.sender.isDestroyed()
          && windowManager?.getWorkspaceForWindow(senderId) === bound)
        if (event.sender.isDestroyed() || windowManager?.getWorkspaceForWindow(senderId) !== bound) return { state: 'blocked', eligible: false, code: 'WORKSPACE_MISMATCH' }
        return result
      })
      ipcMain.handle('__project-authority:connect', async (event, localWorkspaceId: unknown, input: unknown) => {
        const senderId = event.sender.id
        const bound = windowManager?.getWorkspaceForWindow(senderId)
        if (!bound || typeof localWorkspaceId !== 'string' || localWorkspaceId !== bound) {
          return { ok: false, error: { code: 'WORKSPACE_MISMATCH', status: 403 } }
        }
        const generation = (projectAuthorityRequests.get(senderId) ?? 0) + 1
        projectAuthorityRequests.set(senderId, generation)
        const { connectStoredProjectAuthority } = await import('./project-authority')
        const result = await connectStoredProjectAuthority(bound, input, () => !event.sender.isDestroyed()
          && windowManager?.getWorkspaceForWindow(senderId) === bound && projectAuthorityRequests.get(senderId) === generation)
        if (result.ok) quiesceProjectAuthorityWindows(bound, senderId)
        return result
      })
      ipcMain.handle('__project-authority:disconnect', async (event, localWorkspaceId: unknown) => {
        const senderId = event.sender.id
        const bound = windowManager?.getWorkspaceForWindow(senderId)
        if (!bound || typeof localWorkspaceId !== 'string' || localWorkspaceId !== bound) {
          return { ok: false, error: { code: 'WORKSPACE_MISMATCH', status: 403 } }
        }
        const generation = (projectAuthorityRequests.get(senderId) ?? 0) + 1
        projectAuthorityRequests.set(senderId, generation)
        const { disconnectStoredProjectAuthority } = await import('./project-authority')
        const result = await disconnectStoredProjectAuthority(bound, undefined, () => !event.sender.isDestroyed()
          && windowManager?.getWorkspaceForWindow(senderId) === bound && projectAuthorityRequests.get(senderId) === generation)
        if (result.ok) quiesceProjectAuthorityWindows(bound, senderId)
        return result
      })

      ipcMain.handle('remoteTls:inspect', async (event, url: string) => {
        assertTrustedRenderer(event)
        const { inspectRemoteTlsPeer, beginEnrollment } = await import('./remote-tls-enrollment')
        const result = await inspectRemoteTlsPeer(url)
        return { nonce: beginEnrollment(result), result }
      })
      ipcMain.handle('remoteTls:decide', async (event, payload: {
        nonce: string
        action: 'accept' | 'reject' | 'confirm-rollover'
        workspaceId?: string
      }) => {
        assertTrustedRenderer(event)
        // The nonce map in remote-tls-enrollment is global; bind the decision to
        // the sender's own workspace so one window cannot pin another's origin.
        if (payload.workspaceId) {
          const bound = windowManager?.getWorkspaceForWindow(event.sender.id)
          if (!bound || bound !== payload.workspaceId) throw new Error('WORKSPACE_MISMATCH')
        }
        const { applyEnrollmentDecision } = await import('./remote-tls-enrollment')
        const { updateWorkspaceRemoteServer } = await import('@rox/shared/config')
        const ws = payload.workspaceId ? getWorkspaceByNameOrId(payload.workspaceId) : null
        const stored = ws?.remoteServer?.tlsTrust
        const storedPin = stored?.mode === 'spki-pin'
          ? { origin: stored.origin, spkiSha256: stored.spkiSha256 }
          : undefined
        const decision = applyEnrollmentDecision({
          nonce: payload.nonce,
          action: payload.action,
          storedPin,
        })
        if (decision.persist && ws?.remoteServer) {
          updateWorkspaceRemoteServer(ws.id, { ...ws.remoteServer, tlsTrust: decision.persist })
        }
        return decision
      })

      // Server config RPC handlers (LOCAL_ONLY — Electron-specific)
      const runningServerState = {
        host: rpcHost,
        port: instance.port,
        tls: !!tls,
        token: serverToken,
        enabled: serverModeEnabled,
      }

      instance.wsServer.handle(RPC_CHANNELS.settings.GET_SERVER_CONFIG, async () => {
        const { getServerConfig: getConfig } = await import('@rox/shared/config')
        return getConfig()
      })

      instance.wsServer.handle(RPC_CHANNELS.settings.SET_SERVER_CONFIG, async (_ctx: unknown, config: unknown) => {
        const { setServerConfig: setConfig } = await import('@rox/shared/config')
        const cfg = config as import('@rox/shared/config/server-config').ServerConfig
        // Validate port range
        if (cfg.port < 1024 || cfg.port > 65535) {
          throw new Error(`Port must be between 1024 and 65535, got ${cfg.port}`)
        }
        // Validate cert/key files exist if provided
        if (cfg.tlsCertPath && !existsSync(cfg.tlsCertPath)) {
          throw new Error(`Certificate file not found: ${cfg.tlsCertPath}`)
        }
        if (cfg.tlsKeyPath && !existsSync(cfg.tlsKeyPath)) {
          throw new Error(`Private key file not found: ${cfg.tlsKeyPath}`)
        }
        setConfig(cfg)
      })

      instance.wsServer.handle(RPC_CHANNELS.settings.GET_SERVER_STATUS, async () => {
        const { getServerConfig: getConfig } = await import('@rox/shared/config')
        const saved = getConfig()
        const protocol = runningServerState.tls ? 'wss' : 'ws'

        // Determine display host (LAN IP if bound to 0.0.0.0)
        let displayHost = runningServerState.host
        if (displayHost === '0.0.0.0' || displayHost === '::') {
          const os = await import('os')
          const nets = os.networkInterfaces()
          for (const name of Object.keys(nets)) {
            for (const net of nets[name] ?? []) {
              if (net.family === 'IPv4' && !net.internal) {
                displayHost = net.address
                break
              }
            }
            if (displayHost !== '0.0.0.0' && displayHost !== '::') break
          }
        }

        // Only compare port/tls/token when at least one side has server mode enabled.
        // When both are disabled, the running port is random — comparing it to the
        // saved default (9100) would always produce a false "restart required" banner.
        const needsRestart = saved.enabled !== runningServerState.enabled
          || ((saved.enabled || runningServerState.enabled) && (
            saved.port !== runningServerState.port
            || (!!saved.tlsCertPath) !== runningServerState.tls
            || (saved.token ?? '') !== runningServerState.token
          ))

        return {
          running: true,
          host: runningServerState.host,
          port: runningServerState.port,
          tls: runningServerState.tls,
          url: `${protocol}://${displayHost}:${runningServerState.port}`,
          token: runningServerState.token,
          needsRestart,
          insecureWarning: isInsecureBind,
        }
      })

      // TLS enforcement — warn when server mode binds to a network address without TLS
      // Mirrors the hard guard in packages/server/src/index.ts but warns instead of blocking,
      // since the user explicitly enabled server mode via UI (may be on a trusted LAN).
      const isInsecureBind = serverModeEnabled && !tls
        && !['127.0.0.1', 'localhost', '::1'].includes(rpcHost)
      if (isInsecureBind) {
        mainLog.warn(
          '[server-mode] WARNING: Listening on a network address without TLS. ' +
          'Auth tokens will be sent in cleartext. ' +
          'Configure TLS certificates in Settings > Server.'
        )
      }

      // Wire EventSink to Electron-specific services. The shell window already
      // exists (PERF-01 shell-first boot), but its renderer only connects after
      // this point: the WS port is published below, so event handlers use the
      // WS sinks from the first client connection.
      windowManager.setRpcEventSink(moduleSink!, resolveClientId)
      const { setMenuEventSink, dispatchMenuChannel } = await import('./menu')
      setMenuEventSink(moduleSink!, resolveClientId)
      const { setNotificationEventSink } = await import('./notifications')
      setNotificationEventSink(moduleSink!, resolveClientId)

      // Native integration — floating quick composer + its global accelerator.
      // GUI-only: the window is a real renderer (same preload) bound to a
      // workspace, and the accelerator is a host-level global shortcut.
      if (!isHeadless && !isClientOnly) {
        initQuickComposer({
          createWindow: options => new BrowserWindow(options),
          registerAuxiliaryWindow: (win, workspaceId) => { windowManager?.registerAuxiliaryWindow(win, workspaceId) },
          shortcuts: globalShortcut,
          readShortcut: getQuickComposerShortcut,
          writeShortcut: setQuickComposerShortcut,
          resolveWorkspaceId: () => {
            const win = windowManager?.getFocusedWindow() ?? windowManager?.getLastActiveWindow() ?? null
            return win ? windowManager?.getWorkspaceForWindow(win.webContents.id) ?? null : null
          },
          isMac: process.platform === 'darwin',
          prefersSolid: nativeAccessibilityPrefersSolid,
        })
        app.once('will-quit', () => disposeQuickComposer())
      }

      // Dock menu (macOS): the native integration actions, dispatched as one
      // structured `shell:action` to the focused (or first) window.
      if (!isHeadless && process.platform === 'darwin' && app.dock) {
        app.dock.setMenu(Menu.buildFromTemplate([
          { label: i18n.t('menu.newNote'), click: () => { dispatchShellAction(windowManager, { action: 'new-note' }) } },
          { label: i18n.t('menu.newTask'), click: () => { dispatchShellAction(windowManager, { action: 'new-task' }) } },
          { label: i18n.t('menu.quickComposer'), click: () => { dispatchShellAction(windowManager, { action: 'quick-composer' }) } },
          { label: i18n.t('menu.openInbox'), click: () => { dispatchShellAction(windowManager, { action: 'open-inbox' }) } },
        ]))
      }

// Release the local transport to the shell window(s): every renderer RPC
      // (`__resolve-local-ws-token`, then the WS transport itself) is now wired.
      publishWsPort(instance.port)

      // S7: host-local service lifecycle + doctor (e1.4/e1.5, e1.6). All
      // channels are LOCAL_ONLY; the launchd LaunchAgent relaunches the app
      // binary (override with ROX_SERVICE_EXECUTABLE/ROX_SERVICE_ARGS).
      // auto-update is loaded dynamically so its autoUpdater side effects stay
      // off the main-process boot path (same as the other call sites here).
      const { detectMacAdHocSigned } = await import('./auto-update')
      const homeDir = app.getPath('home')
      const configDir = resolveConfigDir()
      const serviceLabel = ROX_SERVICE_LABEL
      const serviceDirectory = join(configDir, 'service')
      const launchAgentsDirectory = join(homeDir, 'Library', 'LaunchAgents')
      const isBuildTrusted = () => !detectMacAdHocSigned(process.execPath)
      const serviceManagerBase = createServiceManager({
        platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
        launchd: process.platform === 'darwin'
          ? {
              files: buildLaunchAgentFiles({
                label: serviceLabel,
                executable: process.env.ROX_SERVICE_EXECUTABLE ?? process.execPath,
                args: process.env.ROX_SERVICE_ARGS
                  ? process.env.ROX_SERVICE_ARGS.split('\u0000')
                  : [app.getAppPath()],
                environment: {
                  ROX_SERVICE_MANAGED: '1',
                  ROX_CONFIG_DIR: configDir,
                  ...(serverModeEnabled ? { CRAFT_SERVER_TOKEN: serverToken } : {}),
                },
                serviceDirectory,
                launchAgentsDirectory,
                workingDirectory: configDir,
                logDirectory: join(configDir, 'logs'),
              }),
              fs: createNodeServiceFilesystem(),
              runtime: new LaunchdRuntime({
                label: serviceLabel,
                uid: userInfo().uid,
                runner: createLaunchctlRunner(),
              }),
              serviceDirectory,
              launchAgentsDirectory,
            }
          : undefined,
      })
      const serviceManager = guardServiceInstall(serviceManagerBase, isBuildTrusted)

      // Onboard daemon tri-state (e1.3): explicit flags beat defaults; an
      // external supervisor, an already-installed service, or --skip-daemon wins
      // over install; a classic non-interactive launch with no signal is a
      // reasoned refusal. This startup call site cannot prompt, so a plain
      // launch never installs the service — only an explicit flag or a
      // quickstart flow does.
      const onboardFlags = readOnboardDaemonFlags(process.argv)
      const supervisor = detectExternalSupervisor(process.env, process.platform)
      const existingServiceStatus = await serviceManager.getStatus()
      const serviceAlreadyPresent = existingServiceStatus.state !== 'not-installed' && existingServiceStatus.state !== 'unsupported'
      const onboardDecision = decideOnboardDaemon({
        installDaemon: onboardFlags.installDaemon,
        skipDaemon: onboardFlags.skipDaemon,
        flow: onboardFlags.quickstart ? 'quickstart' : 'classic',
        externallySupervised: supervisor !== null || serviceAlreadyPresent,
        interactive: false,
      })
      mainLog.info(`[onboard] daemon decision: ${onboardDecision.state} (${onboardDecision.reason}) — ${onboardDecision.note}`)
      if (onboardDecision.state === 'install') {
        const installed = await serviceManager.install()
        if (installed.ok) {
          await serviceManager.start()
        } else {
          mainLog.warn(`[onboard] service install failed: ${installed.status.safeError ?? 'unknown'}`)
        }
      }
      const doctorLogPaths = [getMessagingGatewayLogFilePath(), getAutoUpdateLogFilePath(), getLogFilePath()]
        .filter((path): path is string => typeof path === 'string')
      registerServiceLifecycleIpc({
        server: instance.wsServer,
        service: serviceManager,
        runDoctor: () => runDoctor({
          getServiceStatus: () => serviceManager.getStatus(),
          // Only a real bound port can conflict; port 0 (ephemeral loopback) is skipped.
          servicePorts: serverModeEnabled ? [embeddedServerConfig.port] : [],
          isPortAvailable: defaultPortAvailable,
          configDir,
          pathExists: async path => existsSync(path),
          appVersion: app.getVersion(),
          runtimeVersion: null,
          logPaths: doctorLogPaths,
        }),
      })

      // Menu-bar status shell (e2.1). Only with a real UI; the indicator tracks
      // the service state and every transition is broadcast to the renderer.
      if (!isHeadless && process.platform === 'darwin') {
        const iconPath = resolveAppIconPngPath()
        const tray = new Tray(iconPath ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 }) : nativeImage.createEmpty())
        const trayController = new TrayController({
          tray,
          buildMenu: template => Menu.buildFromTemplate([...template]),
          translate: key => i18n.t(key),
          // The channel set comes from the tray model, never from IPC input.
          dispatchChannel: channel => dispatchMenuChannel(channel as MenuBroadcastChannel),
          dispatchShellAction: action => { dispatchShellAction(windowManager, { action }) },
          showWindow: () => {
            const win = windowManager?.getLastActiveWindow() ?? windowManager?.getAllWindows()[0]?.window ?? null
            if (!win || win.isDestroyed()) return
            if (win.isMinimized()) win.restore()
            win.show()
            win.focus()
          },
          broadcastStatus: status => pushTyped(instance.wsServer, RPC_CHANNELS.menu.TRAY_STATUS_CHANGED, { to: 'all' }, status),
          quit: () => app.quit(),
        })
        let lastTrayState: string | null = null
        const refreshTray = async () => {
          const status = await serviceManager.getStatus()
          if (status.state === lastTrayState) return
          lastTrayState = status.state
          trayController.setStatus({
            agentState: status.state === 'failed' || status.state === 'degraded' ? 'error' : 'idle',
            serviceState: status.state,
          })
        }
        void refreshTray()
        const trayTimer = setInterval(() => { void refreshTray() }, 30_000)
        trayTimer.unref?.()
        app.once('will-quit', () => {
          clearInterval(trayTimer)
          trayController.dispose()
        })
      }

      // Headless: print connection details
      if (isHeadless) {
        console.log(`CRAFT_SERVER_URL=${instance.protocol}://${instance.host}:${instance.port}`)
        console.log(`CRAFT_SERVER_TOKEN=${maskTokenForDisplay(instance.token)}`)
      }
    }

    // Windows were created early (PERF-01 shell-first boot); this flag marks the
    // end of startup init so a quit from here on snapshots real window state.
    appInitialized = true

    // Run credential health check at startup to detect issues early
    // (corruption, machine migration, missing credentials for default connection)
    // Skip in thin-client mode — credentials are managed by the remote server.
    if (!isClientOnly) {
      try {
        const { getCredentialManager } = await import('@rox/shared/credentials')
        const credentialManager = getCredentialManager()
        const health = await credentialManager.checkHealth()
        if (!health.healthy) {
          mainLog.warn('Credential health check failed:', health.issues)
          // Issues will be displayed in Settings → AI when user navigates there
        }
      } catch (err) {
        mainLog.error('Credential health check error:', err)
      }
    }

    // Initialize power manager (loads setting, must happen after config is available)
    // Non-critical — powerSaveBlocker may not work on headless/xvfb setups
    try {
      const { initPowerManager } = await import('./power-manager')
      await initPowerManager()
    } catch (err) {
      mainLog.warn('[power] Power manager init failed (non-critical):', err instanceof Error ? err.message : err)
    }

    // Initialize auto-update (check immediately on launch)
    // Skip in dev mode to avoid replacing /Applications app and launching it instead
    if (moduleSink) setAutoUpdateEventSink(moduleSink)
    // Snapshot multi-window state BEFORE quitAndInstall. electron-updater
    // (Squirrel.Mac) destroys BrowserWindows between quitAndInstall and
    // before-quit firing; saving from before-quit alone would overwrite
    // window-state.json with an empty array.
    setBeforeUpdateQuitHook(() => captureAndSaveWindowState('pre-update'))
    // Before the installer hands off, run the full quit cleanup and mark the app
    // as quitting so before-quit's guard returns early instead of cancelling
    // Squirrel.Mac's quit with preventDefault (#891).
    setBeforeUpdateInstallHook(async () => {
      isQuitting = true
      windowManager?.setAppQuitting(true)
      await performQuitCleanup()
    })
    // If quitAndInstall throws after the cleanup above already ran, the process
    // is a zombie: sessions flushed but no watchers/messaging/lock, and isQuitting
    // makes the next quit skip the flush. The only honest recovery is a controlled
    // relaunch into a fresh process (#891).
    setInstallQuitFailedHook(() => {
      mainLog.error('[auto-update] quitAndInstall failed after cleanup — relaunching')
      dialog.showMessageBoxSync({
        type: 'error',
        title: i18n.t('dialog.updateFailed.title'),
        message: i18n.t('dialog.updateFailed.message'),
        detail: i18n.t('dialog.updateFailed.detail'),
      })
      app.relaunch()
      app.exit(0)
    })
    if (app.isPackaged) {
      checkForUpdatesOnLaunch().catch(err => {
        mainLog.error('[auto-update] Launch check failed:', err)
      })
    } else {
      mainLog.info('[auto-update] Skipping auto-update in dev mode')
    }

    // Process pending deep link from cold start
    // Not awaited: an entity link may be held for up to 10 s until the
    // entities.links.v1 state is known, which must not delay the rest of
    // init (the 'activate' handler below, the "initialized" log). There is no
    // retry: the link is consumed here, and a failure is logged and dropped.
    if (pendingDeepLink) {
      const coldStartLink = pendingDeepLink
      pendingDeepLink = null
      mainLog.info('Processing pending deep link:', coldStartLink)
      handleDeepLink(coldStartLink, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined, undefined, 'os').catch(err => {
        mainLog.error('Failed to handle pending deep link (dropped, no retry):', err)
      })
    }

    mainLog.info('App initialized successfully')
    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
    mainLog.info('Messaging gateway log path:', getMessagingGatewayLogFilePath())
  } catch (error) {
    mainLog.error('Failed to initialize app:', error instanceof Error ? error.message : error, (error as any)?.stack)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
      // Open first workspace or last focused
      const workspaces = getWorkspaces()
      if (workspaces.length > 0) {
        const savedState = loadWindowState()
        const wsId = savedState?.lastFocusedWorkspaceId || workspaces[0].id
        // Verify workspace still exists
        if (workspaces.some(ws => ws.id === wsId)) {
          windowManager.createWindow({ workspaceId: wsId })
        } else {
          windowManager.createWindow({ workspaceId: workspaces[0].id })
        }
      }
    }
  })
})

app.on('window-all-closed', () => {
  if (process.env.CRAFT_HEADLESS) return  // headless server stays alive
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Track if we're in the process of quitting (to avoid re-entry)
let isQuitting = false
// Set once whenReady() init finishes. A launch that failed init (e.g. another
// instance holds the server lock for the same config dir) never restored any
// window, so its quit must not clobber that instance's window-state.json.
let appInitialized = false

/**
 * Capture the current multi-window state and persist it to disk.
 * Called from two sites:
 *   - before-quit (normal quit path, reason='before-quit')
 *   - installUpdate hook (auto-update path, reason='pre-update'), because
 *     electron-updater destroys BrowserWindows between quitAndInstall and
 *     before-quit firing — by the time before-quit runs, getWindowStates()
 *     returns an empty array and would clobber the on-disk state.
 * Returns the number of windows saved, or -1 if windowManager isn't ready.
 */
function captureAndSaveWindowState(reason: 'before-quit' | 'pre-update'): number {
  if (!windowManager) return -1
  const windows = windowManager.getWindowStates()
  const lastActiveWindow = windowManager.getLastActiveWindow()
  const lastFocusedWorkspaceId = lastActiveWindow
    ? windowManager.getWorkspaceForWindow(lastActiveWindow.webContents.id) ?? undefined
    : undefined
  if (!saveWindowState({ windows, lastFocusedWorkspaceId })) {
    mainLog.error('[window-state] save failed', { windowCount: windows.length, reason })
    return -1
  }
  mainLog.info('[window-state] saved', { windowCount: windows.length, reason })
  return windows.length
}

// Flush sessions and release all quit-time resources. Shared by the normal quit
// path (before-quit) and the update-install handoff (beforeUpdateInstallHook), so
// the two cleanup sequences can't drift (#891).
let quitCleanupRan = false
async function performQuitCleanup(): Promise<void> {
  // Idempotent: a failed update install may retry, and the update path plus a
  // subsequent quit must not dispose already-disposed services.
  if (quitCleanupRan) {
    mainLog.info('Quit cleanup already ran, skipping')
    return
  }
  quitCleanupRan = true
  if (cleanupNativeReplicaIpc) {
    cleanupNativeReplicaIpc()
    cleanupNativeReplicaIpc = null
  }

  if (sessionManager) {
    try {
      await sessionManager.flushAllSessions()
      mainLog.info('Flushed all pending session writes')
    } catch (error) {
      mainLog.error('Failed to flush sessions:', error)
    }
    // Clean up SessionManager resources (file watchers, timers, etc.)
    sessionManager.cleanup()
  }

  // Clean up browser pane instances
  if (browserPaneManager) {
    browserPaneManager.destroyAll()
  }

  // Stop only the namespace this process started. The manager talks through
  // Open Design sidecar IPC and never falls back to process-wide killing.
  if (openDesignRuntime) {
    try {
      await openDesignRuntime.stop()
    } catch (err) {
      mainLog.warn('[open-design] shutdown failed:', err instanceof Error ? err.message : err)
    }
  }

  // Stop all per-workspace Extension Hosts (utilityProcess children) cleanly.
  try {
    await stopAllExtensionHosts()
  } catch (err) {
    mainLog.warn('[extension-host] stopAll on quit failed:', err)
  }

  // Clean up OAuth flow store (stop periodic cleanup timer)
  if (oauthFlowStore) {
    oauthFlowStore.dispose()
  }

  // Stop all model refresh timers
  getModelRefreshService().stopAll()

  // Stop messaging gateways so the WhatsApp worker subprocess exits cleanly.
  if (messagingHandle) {
    try {
      await messagingHandle.dispose()
    } catch (err) {
      mainLog.error('[messaging] dispose failed:', err)
    }
  }

  // Stop and await in-flight managed audits before their runtime disappears.
  if (openClawSecurityAuditService) {
    try {
      await openClawSecurityAuditService.dispose()
    } catch {
      mainLog.warn('[openclaw] security audit disposal failed')
    }
  }

  // Stop only manager-owned OpenClaw children; never inspect or affect a
  // user-managed OpenClaw process outside this runtime manager.
  if (openClawRuntimeManager) {
    try {
      await openClawRuntimeManager.shutdown()
    } catch {
      mainLog.warn('[openclaw] managed runtime shutdown failed')
    }
  }

  if (workGraphKernel) {
    try {
      await workGraphKernel.close()
    } catch {
      mainLog.warn('[workgraph] local database close failed')
    } finally {
      workGraphKernel = null
    }
  }

  // Clean up power manager (release power blocker)
  const { cleanup: cleanupPowerManager } = await import('./power-manager')
  cleanupPowerManager()

  // Release the server lock file so the next launch doesn't see a stale PID.
  releaseServerLock()
}

// Save window state and clean up resources before quitting
app.on('before-quit', async (event) => {
  // Avoid re-entry when we call app.exit()
  if (isQuitting) return
  isQuitting = true

  // Ensure Cmd+Q/app quit bypasses layered window close interception (Cmd+W behavior).
  windowManager?.setAppQuitting(true)

  if (windowManager) {
    const windows = windowManager.getWindowStates()
    // Empty-snapshot guard: during update-quit, electron-updater has already
    // destroyed all BrowserWindows by the time before-quit fires. The pre-update
    // hook already saved the real state — don't let this late save overwrite it.
    if (windows.length === 0 && isUpdating()) {
      mainLog.warn('[window-state] skip save: empty snapshot during update-quit (pre-update snapshot wins)')
    } else if (windows.length === 0 && !appInitialized) {
      mainLog.warn('[window-state] skip save: init failed and no windows (keep the existing window-state.json)')
    } else {
      captureAndSaveWindowState('before-quit')
    }
    // Diagnostic correlation with installUpdate's [update-flow] log. During an
    // update-quit, record it to the dedicated always-on auto-update log (#891)
    // so the install/quit handoff is diagnosable in production; normal quits
    // stay on the debug-only main log.
    const isUpdateQuit = isUpdating()
    const beforeQuitSave = {
      windowCount: windows.length,
      electronWindowCount: BrowserWindow.getAllWindows().length,
      isUpdating: isUpdateQuit,
      reason: isUpdateQuit ? 'update-quit' : 'user-quit',
    }
    if (isUpdateQuit) {
      autoUpdateLog.info('before-quit save', beforeQuitSave)
    } else {
      mainLog.info('[update-flow] before-quit save', beforeQuitSave)
    }
  }

  // Normal quit: flush + clean up, then exit. The update-install path does NOT
  // reach here — installUpdate's beforeUpdateInstallHook already ran
  // performQuitCleanup and set isQuitting, so the guard at the top returns early
  // and Squirrel.Mac's quit proceeds uninterrupted so the update installs (#891).
  if (sessionManager || openDesignRuntime?.hasActiveRuntime()) {
    event.preventDefault()
    // performQuitCleanup has unguarded steps (model-refresh stopAll, the
    // power-manager import, releaseServerLock). Whatever throws, we must still
    // exit: the quit was already cancelled above, so a rejection here would
    // leave a windowless process holding the server/config locks.
    await runQuitCleanupThenExit(
      performQuitCleanup,
      code => app.exit(code),
      error => mainLog.error('[quit] cleanup failed; forcing exit:', error),
    )
  }
})

// Handle uncaught exceptions.
process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
  errorLog.error('Uncaught exception', { error })
})

process.on('unhandledRejection', (reason, promise) => {
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
  errorLog.error('Unhandled rejection', { reason, promise })
})
