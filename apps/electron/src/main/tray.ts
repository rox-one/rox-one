/**
 * Tray shell — the macOS menu-bar item.
 *
 * The menu is a pure model (`buildTrayMenuModel`) built from a `TrayView`
 * snapshot, so every item, label, accelerator and enablement is testable
 * without Electron. `TrayController` owns the `Tray`-like surface: tooltip,
 * unread badge (via the injected `setBadge`) and the context menu.
 * `RecordingTrayController` owns the separate red record/stop item that sits to
 * the left of the Rox icon while a meeting or voice capture is running.
 *
 * Navigation goes through the frozen `menu:*` channels or `shell:action`
 * payloads (the same event-sink paths the app menu and dock use), never a raw
 * `webContents.send`.
 */

import type { ServiceState, TrayStatus } from '@rox/shared/service-lifecycle'
import type { ShellActionPayload, TrayStateReport } from '@rox/shared/protocol'
import { RPC_CHANNELS } from '@rox/shared/protocol/channels'
import { formatElapsed } from './tray-badge'

/** Most recent sessions listed in the submenu. */
export const TRAY_RECENT_SESSIONS = 5

export interface TrayWorkspace {
  readonly id: string
  readonly name: string
}

/** Everything the menu-bar item renders. Main assembles it from several sources. */
export interface TrayView {
  readonly agentState: TrayStatus['agentState']
  readonly serviceState: ServiceState
  /** Aggregated renderer snapshot (unread, recents, balance, recording). */
  readonly report: TrayStateReport
  readonly workspaces: readonly TrayWorkspace[]
  readonly activeWorkspaceId: string | null
  /** Do Not Disturb = desktop notifications switched off. */
  readonly doNotDisturb: boolean
  /** An update is downloaded and ready to install. */
  readonly updateReadyVersion: string | null
  /** Display-only accelerators for items that have a real binding. */
  readonly accelerators: { readonly askRox?: string; readonly voice?: string }
}

export const EMPTY_TRAY_REPORT: TrayStateReport = {
  unreadCount: 0,
  activeAgents: 0,
  recentSessions: [],
  balance: null,
  recording: null,
}

export const INITIAL_TRAY_VIEW: TrayView = {
  agentState: 'idle',
  serviceState: 'unavailable',
  report: EMPTY_TRAY_REPORT,
  workspaces: [],
  activeWorkspaceId: null,
  doNotDisturb: false,
  updateReadyVersion: null,
  accelerators: {},
}

export type TrayAction =
  | { readonly kind: 'channel'; readonly channel: string }
  | { readonly kind: 'shell'; readonly action: ShellActionPayload['action']; readonly deepLink?: ShellActionPayload['deepLink']; readonly show: boolean }
  | { readonly kind: 'voice' }
  | { readonly kind: 'toggleDnd' }
  | { readonly kind: 'checkUpdates' }
  | { readonly kind: 'installUpdate' }
  | { readonly kind: 'showWindow' }
  | { readonly kind: 'toggleMini' }
  | { readonly kind: 'quit' }

export interface TrayMenuEntry {
  readonly id: string
  readonly type: 'normal' | 'checkbox' | 'radio' | 'submenu' | 'separator'
  readonly labelKey?: string
  readonly labelParams?: Record<string, string | number>
  /** Literal label (session titles, workspace names) — never translated. */
  readonly label?: string
  readonly enabled?: boolean
  readonly checked?: boolean
  readonly accelerator?: string
  readonly action?: TrayAction
  readonly submenu?: readonly TrayMenuEntry[]
}

const SEPARATOR = (id: string): TrayMenuEntry => ({ id, type: 'separator' })

/** Human status line, or null when there is nothing worth saying. */
export function trayStatusLine(view: TrayView): TrayMenuEntry | null {
  if (view.serviceState === 'failed' || view.serviceState === 'degraded') {
    return {
      id: 'status',
      type: 'normal',
      labelKey: 'tray.status.serviceProblem',
      action: { kind: 'channel', channel: RPC_CHANNELS.menu.RUN_DOCTOR },
    }
  }
  const agents = Math.max(0, Math.floor(view.report.activeAgents))
  if (agents > 0) {
    return { id: 'status', type: 'normal', labelKey: 'tray.status.agentsWorking', labelParams: { count: agents }, enabled: false }
  }
  return null
}

function truncate(title: string, max = 48): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function buildTrayMenuModel(view: TrayView): readonly TrayMenuEntry[] {
  const { report } = view
  const entries: TrayMenuEntry[] = []
  const status = trayStatusLine(view)
  if (status) entries.push(status, SEPARATOR('sep-status'))

  // Create / ask.
  const recording = report.recording
  const meetingRecording = recording?.kind === 'meeting'
  entries.push(
    { id: 'newSession', type: 'normal', labelKey: 'tray.menu.newSession', accelerator: 'CmdOrCtrl+N', action: { kind: 'channel', channel: RPC_CHANNELS.menu.NEW_CHAT } },
    { id: 'askRox', type: 'normal', labelKey: 'tray.menu.askRox', ...(view.accelerators.askRox ? { accelerator: view.accelerators.askRox } : {}), action: { kind: 'shell', action: 'quick-composer', show: false } },
    {
      id: 'voice',
      type: 'normal',
      labelKey: recording?.kind === 'voice' ? 'tray.menu.voiceStop' : 'tray.menu.voice',
      ...(view.accelerators.voice ? { accelerator: view.accelerators.voice } : {}),
      // A meeting holds the microphone; dictation would fight it.
      ...(meetingRecording ? { enabled: false } : {}),
      action: { kind: 'voice' },
    },
    {
      id: 'meetingRecording',
      type: 'normal',
      labelKey: meetingRecording ? 'tray.menu.stopRecording' : 'tray.menu.startRecording',
      ...(recording?.kind === 'voice' ? { enabled: false } : {}),
      action: { kind: 'shell', action: 'toggle-meeting-recording', show: false },
    },
    { id: 'search', type: 'normal', labelKey: 'tray.menu.search', accelerator: 'CmdOrCtrl+K', action: { kind: 'shell', action: 'search', show: true } },
    SEPARATOR('sep-create'),
    { id: 'newNote', type: 'normal', labelKey: 'menu.newNote', action: { kind: 'shell', action: 'new-note', show: true } },
    { id: 'newTask', type: 'normal', labelKey: 'menu.newTask', action: { kind: 'shell', action: 'new-task', show: true } },
    SEPARATOR('sep-notes'),
    // Open a surface.
    { id: 'openMessenger', type: 'normal', labelKey: 'tray.menu.openMessenger', action: { kind: 'shell', action: 'navigate', deepLink: { route: 'messenger' }, show: true } },
    { id: 'openTasks', type: 'normal', labelKey: 'tray.menu.openTasks', action: { kind: 'shell', action: 'navigate', deepLink: { route: 'tasks' }, show: true } },
    { id: 'roxMini', type: 'normal', labelKey: 'tray.menu.roxMini', action: { kind: 'toggleMini' } },
    SEPARATOR('sep-open'),
  )

  // Where things are.
  const recent = report.recentSessions.slice(0, TRAY_RECENT_SESSIONS)
  if (recent.length > 0) {
    entries.push({
      id: 'recentSessions',
      type: 'submenu',
      labelKey: 'tray.menu.recentSessions',
      submenu: recent.map(session => ({
        id: `session:${session.id}`,
        type: 'normal' as const,
        label: truncate(session.title),
        action: { kind: 'shell' as const, action: 'open-session' as const, deepLink: { id: session.id }, show: true },
      })),
    })
  }
  const unread = Math.max(0, Math.floor(report.unreadCount))
  entries.push(
    {
      id: 'notifications',
      type: 'normal',
      labelKey: unread > 0 ? 'tray.menu.notificationsCount' : 'tray.menu.notifications',
      ...(unread > 0 ? { labelParams: { count: unread } } : {}),
      action: { kind: 'shell', action: 'open-inbox', show: true },
    },
    { id: 'doNotDisturb', type: 'checkbox', labelKey: 'tray.menu.doNotDisturb', checked: view.doNotDisturb, action: { kind: 'toggleDnd' } },
  )
  if (view.workspaces.length > 1) {
    entries.push({
      id: 'workspaces',
      type: 'submenu',
      labelKey: 'tray.menu.switchWorkspace',
      submenu: view.workspaces.map(ws => ({
        id: `workspace:${ws.id}`,
        type: 'radio' as const,
        label: truncate(ws.name),
        checked: ws.id === view.activeWorkspaceId,
        action: { kind: 'shell' as const, action: 'switch-workspace' as const, deepLink: { workspaceId: ws.id }, show: true },
      })),
    })
  }
  if (report.balance != null && Number.isFinite(report.balance)) {
    entries.push({ id: 'balance', type: 'normal', labelKey: 'tray.menu.balance', labelParams: { amount: report.balance }, enabled: false })
  }
  entries.push(SEPARATOR('sep-places'))

  // App.
  entries.push(
    { id: 'runDoctor', type: 'normal', labelKey: 'tray.menu.runDoctor', action: { kind: 'channel', channel: RPC_CHANNELS.menu.RUN_DOCTOR } },
    view.updateReadyVersion
      ? { id: 'updates', type: 'normal', labelKey: 'menu.installUpdateVersion', labelParams: { version: view.updateReadyVersion }, action: { kind: 'installUpdate' } }
      : { id: 'updates', type: 'normal', labelKey: 'menu.checkForUpdatesEllipsis', action: { kind: 'checkUpdates' } },
    { id: 'settings', type: 'normal', labelKey: 'tray.menu.settings', accelerator: 'CmdOrCtrl+,', action: { kind: 'channel', channel: RPC_CHANNELS.menu.OPEN_SETTINGS } },
    { id: 'showWindow', type: 'normal', labelKey: 'menu.showWindow', action: { kind: 'showWindow' } },
    SEPARATOR('sep-quit'),
    { id: 'quit', type: 'normal', labelKey: 'tray.menu.quit', accelerator: 'CmdOrCtrl+Q', action: { kind: 'quit' } },
  )
  return entries
}

/** Electron `MenuItemConstructorOptions`-compatible template entry. */
export interface TrayTemplateItem {
  readonly id?: string
  readonly type: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu'
  readonly label?: string
  readonly enabled?: boolean
  readonly checked?: boolean
  readonly accelerator?: string
  /** Display only: the real binding lives in the app / global shortcut layer. */
  readonly registerAccelerator?: boolean
  readonly submenu?: readonly TrayTemplateItem[]
  readonly click?: () => void
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

export function toTrayTemplate(
  model: readonly TrayMenuEntry[],
  translate: TranslateFn,
  onAction: (action: TrayAction) => void,
): readonly TrayTemplateItem[] {
  return model.map((entry): TrayTemplateItem => {
    if (entry.type === 'separator') return { type: 'separator' }
    const label = entry.label ?? (entry.labelKey ? translate(entry.labelKey, entry.labelParams) : '')
    const action = entry.action
    return {
      id: entry.id,
      type: entry.type,
      label,
      ...(entry.enabled === false ? { enabled: false } : {}),
      ...(entry.checked !== undefined ? { checked: entry.checked } : {}),
      ...(entry.accelerator ? { accelerator: entry.accelerator, registerAccelerator: false } : {}),
      ...(entry.submenu ? { submenu: toTrayTemplate(entry.submenu, translate, onAction) } : {}),
      ...(action ? { click: () => onAction(action) } : {}),
    }
  })
}

export function trayTooltipKey(agentState: TrayStatus['agentState']): string {
  return `tray.tooltip.${agentState}`
}

export interface TrayLike {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  setTitle?(title: string): void
  destroy(): void
}

export interface TrayControllerDependencies {
  readonly tray: TrayLike
  /** Builds the native menu from the pure template. */
  readonly buildMenu: (template: readonly TrayTemplateItem[]) => unknown
  readonly translate: TranslateFn
  /** Swap the icon for one carrying the red unread badge (0 = plain icon). */
  readonly setBadge?: (count: number) => void
  readonly dispatchChannel: (channel: string) => void
  readonly dispatchShellAction?: (payload: ShellActionPayload) => void
  readonly toggleVoice?: () => void
  readonly setDoNotDisturb?: (enabled: boolean) => void
  readonly checkForUpdates?: () => void
  readonly installUpdate?: () => void
  /** Show + focus an existing window (or restore the last one). */
  readonly showWindow?: () => void
  /** Enter / leave the compact Rox Mini window (macOS). */
  readonly toggleMini?: () => void
  readonly quit: () => void
}

export class TrayController {
  private view: TrayView = INITIAL_TRAY_VIEW
  private lastBadge = -1

  constructor(private readonly deps: TrayControllerDependencies) {
    this.apply()
  }

  getView(): TrayView {
    return this.view
  }

  /** Merge a partial view and re-render tooltip, badge and menu. */
  update(patch: Partial<TrayView>): void {
    this.view = { ...this.view, ...patch }
    this.apply()
  }

  private apply(): void {
    const { deps, view } = this
    deps.tray.setToolTip(deps.translate(trayTooltipKey(view.agentState)))
    // The old monochrome status glyph read as a meaningless grey dot.
    deps.tray.setTitle?.('')
    const badge = Math.max(0, Math.floor(view.report.unreadCount))
    if (badge !== this.lastBadge) {
      this.lastBadge = badge
      deps.setBadge?.(badge)
    }
    const template = toTrayTemplate(buildTrayMenuModel(view), deps.translate, action => this.run(action))
    deps.tray.setContextMenu(deps.buildMenu(template))
  }

  private run(action: TrayAction): void {
    const { deps } = this
    switch (action.kind) {
      case 'quit': deps.quit(); return
      case 'showWindow': deps.showWindow?.(); return
      case 'toggleMini': deps.toggleMini?.(); return
      case 'channel':
        deps.showWindow?.()
        deps.dispatchChannel(action.channel)
        return
      case 'shell':
        if (action.show) deps.showWindow?.()
        deps.dispatchShellAction?.({ action: action.action, ...(action.deepLink ? { deepLink: action.deepLink } : {}) })
        return
      case 'voice': deps.toggleVoice?.(); return
      case 'toggleDnd': {
        const next = !this.view.doNotDisturb
        deps.setDoNotDisturb?.(next)
        this.update({ doNotDisturb: next })
        return
      }
      case 'checkUpdates': deps.checkForUpdates?.(); return
      case 'installUpdate': deps.installUpdate?.(); return
    }
  }

  dispose(): void {
    this.deps.tray.destroy()
  }
}

// ── Recording indicator ─────────────────────────────────────────────────────

export interface RecordingTrayLike {
  setTitle(title: string): void
  setToolTip(text: string): void
  onClick(handler: () => void): void
  destroy(): void
}

export interface RecordingTrayDependencies {
  /** Creates the red-dot tray. Created after the Rox item, so macOS places it to its left. */
  readonly createTray: () => RecordingTrayLike
  readonly translate: TranslateFn
  /** Stop the running capture (meeting or voice). */
  readonly stop: (kind: 'meeting' | 'voice') => void
  readonly now?: () => number
  readonly setInterval?: (fn: () => void, ms: number) => unknown
  readonly clearInterval?: (handle: unknown) => void
}

/** Shows `● 0:42` left of the Rox icon while recording; click stops it. */
export class RecordingTrayController {
  private tray: RecordingTrayLike | null = null
  private timer: unknown = null
  private recording: TrayStateReport['recording'] = null

  constructor(private readonly deps: RecordingTrayDependencies) {}

  isVisible(): boolean {
    return this.tray !== null
  }

  set(recording: TrayStateReport['recording']): void {
    const prev = this.recording
    this.recording = recording
    if (!recording) {
      this.hide()
      return
    }
    if (!this.tray) {
      const tray = this.deps.createTray()
      tray.onClick(() => { if (this.recording) this.deps.stop(this.recording.kind) })
      this.tray = tray
      const start = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms))
      this.timer = start(() => this.tick(), 1000)
    }
    if (!prev || prev.kind !== recording.kind) {
      this.tray.setToolTip(this.deps.translate(recording.kind === 'voice' ? 'tray.recording.stopVoice' : 'tray.recording.stopMeeting'))
    }
    this.tick()
  }

  private tick(): void {
    if (!this.tray || !this.recording) return
    const now = (this.deps.now ?? Date.now)()
    this.tray.setTitle(` ${formatElapsed(now - this.recording.startedAt)}`)
  }

  private hide(): void {
    if (this.timer !== null) {
      const clear = this.deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>))
      clear(this.timer)
      this.timer = null
    }
    this.tray?.destroy()
    this.tray = null
  }

  dispose(): void {
    this.recording = null
    this.hide()
  }
}

/**
 * Fold per-window reports into one: badge, recents and balance come from the
 * active window; a capture running in any window is shown, and its window is
 * the one targeted when stopping.
 */
export function aggregateTrayReports(
  reports: ReadonlyMap<number, TrayStateReport>,
  activeWebContentsId: number | null,
): { report: TrayStateReport; recordingOwner: number | null } {
  const first = reports.values().next()
  const active = (activeWebContentsId != null ? reports.get(activeWebContentsId) : undefined)
    ?? (first.done ? EMPTY_TRAY_REPORT : first.value)
  let recording: TrayStateReport['recording'] = null
  let recordingOwner: number | null = null
  for (const [id, report] of reports) {
    if (report.recording && (!recording || id === activeWebContentsId)) {
      recording = report.recording
      recordingOwner = id
    }
  }
  return { report: { ...active, recording }, recordingOwner }
}

/** Defensive parse of an IPC payload; anything malformed collapses to safe defaults. */
export function sanitizeTrayReport(input: unknown): TrayStateReport {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
  const sessions: unknown[] = Array.isArray(raw.recentSessions) ? raw.recentSessions : []
  const rec = raw.recording && typeof raw.recording === 'object' ? raw.recording as Record<string, unknown> : null
  const recentSessions: { id: string; title: string }[] = []
  for (const s of sessions) {
    if (recentSessions.length >= TRAY_RECENT_SESSIONS) break
    const item = s as { id?: unknown; title?: unknown } | null
    if (item && typeof item.id === 'string' && item.id && typeof item.title === 'string') {
      recentSessions.push({ id: item.id, title: item.title })
    }
  }
  return {
    unreadCount: count(raw.unreadCount),
    activeAgents: count(raw.activeAgents),
    recentSessions,
    balance: typeof raw.balance === 'number' && Number.isFinite(raw.balance) ? raw.balance : null,
    recording: rec && (rec.kind === 'meeting' || rec.kind === 'voice') && typeof rec.startedAt === 'number' && Number.isFinite(rec.startedAt)
      ? { kind: rec.kind, startedAt: rec.startedAt, paused: rec.paused === true }
      : null,
  }
}
