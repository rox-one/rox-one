/**
 * Tray shell (e2.1) — a menu-bar status indicator plus navigation dispatch.
 *
 * The menu is a pure model (`buildTrayMenuModel`) so items and enablement are
 * testable without Electron. The controller owns a `Tray`-like surface and keeps
 * the tooltip/indicator in sync with the current `TrayStatus`. Navigation items
 * dispatch the frozen `menu:*` channels through the injected dispatcher (the
 * same event-sink path the application menu uses) — never a raw
 * `webContents.send`.
 */

import type { ServiceState, TrayStatus } from '@rox/shared/service-lifecycle'
import type { ShellActionPayload } from '@rox/shared/protocol'
import { RPC_CHANNELS } from '../shared/types'

export type TrayMenuItemId =
  | 'service-status'
  | 'newNote'
  | 'newTask'
  | 'quickComposer'
  | 'openInbox'
  | 'openDashboard'
  | 'runDoctor'
  | 'settings'
  | 'showWindow'
  | 'quit'

export interface TrayMenuItemModel {
  readonly id: TrayMenuItemId
  readonly labelKey: string
  readonly enabled: boolean
}

/** Dynamic per-state label; a static record is the single source of truth. */
export const SERVICE_STATE_LABEL_KEY: Record<ServiceState, string> = {
  unavailable: 'service.state.unavailable',
  'not-installed': 'service.state.notInstalled',
  installed: 'service.state.installed',
  running: 'service.state.running',
  starting: 'service.state.starting',
  stopped: 'service.state.stopped',
  degraded: 'service.state.degraded',
  failed: 'service.state.failed',
  unsupported: 'service.state.unsupported',
}

/** menu channel each navigation item dispatches; `quit` is handled locally. */
export const TRAY_ITEM_CHANNEL: Record<TrayMenuItemId, string | undefined> = {
  'service-status': undefined,
  newNote: undefined,
  newTask: undefined,
  quickComposer: undefined,
  openInbox: undefined,
  openDashboard: RPC_CHANNELS.menu.OPEN_DASHBOARD,
  runDoctor: RPC_CHANNELS.menu.RUN_DOCTOR,
  settings: RPC_CHANNELS.menu.OPEN_SETTINGS,
  showWindow: undefined,
  quit: undefined,
}

/** Native affordance each tray item dispatches as a `shell:action`. */
export const TRAY_ITEM_SHELL_ACTION: Record<TrayMenuItemId, ShellActionPayload['action'] | undefined> = {
  'service-status': undefined,
  newNote: 'new-note',
  newTask: 'new-task',
  quickComposer: 'quick-composer',
  openInbox: 'open-inbox',
  openDashboard: undefined,
  runDoctor: undefined,
  settings: undefined,
  showWindow: undefined,
  quit: undefined,
}

export function trayTooltipKey(agentState: TrayStatus['agentState']): string {
  return `tray.tooltip.${agentState}`
}

/** Monochrome status glyph shown next to the tray icon on macOS. */
export function trayStatusIndicator(status: TrayStatus): string {
  if (status.agentState === 'working') return '◐'
  if (status.agentState === 'error') return '▲'
  return '●'
}

export function buildTrayMenuModel(status: TrayStatus): readonly TrayMenuItemModel[] {
  return [
    { id: 'service-status', labelKey: SERVICE_STATE_LABEL_KEY[status.serviceState], enabled: false },
    { id: 'newNote', labelKey: 'menu.newNote', enabled: true },
    { id: 'newTask', labelKey: 'menu.newTask', enabled: true },
    { id: 'quickComposer', labelKey: 'menu.quickComposer', enabled: true },
    { id: 'openInbox', labelKey: 'menu.openInbox', enabled: true },
    { id: 'openDashboard', labelKey: 'tray.menu.openDashboard', enabled: true },
    { id: 'runDoctor', labelKey: 'tray.menu.runDoctor', enabled: true },
    { id: 'settings', labelKey: 'tray.menu.settings', enabled: true },
    { id: 'showWindow', labelKey: 'menu.showWindow', enabled: true },
    { id: 'quit', labelKey: 'tray.menu.quit', enabled: true },
  ]
}

export interface TrayTemplateItem {
  readonly type: 'normal' | 'separator'
  readonly label?: string
  readonly enabled?: boolean
  readonly click?: () => void
}

/**
 * Pure model → menu template. Separators precede the status header and the
 * final quit item so the menu reads: status | navigation | diagnostics | quit.
 */
export function toTrayTemplate(
  model: readonly TrayMenuItemModel[],
  translate: (key: string) => string,
  onClick: (id: TrayMenuItemId) => void,
): readonly TrayTemplateItem[] {
  const template: TrayTemplateItem[] = []
  for (const item of model) {
    if (item.id === 'newNote' || item.id === 'openDashboard' || item.id === 'quit') {
      template.push({ type: 'separator' })
    }
    template.push({
      type: 'normal',
      label: translate(item.labelKey),
      enabled: item.enabled,
      ...(item.id === 'service-status' ? {} : { click: () => onClick(item.id) }),
    })
  }
  return template
}

export interface TrayLike {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  setTitle?(title: string): void
  destroy(): void
}

export interface TrayControllerDependencies {
  readonly tray: TrayLike
  /** Builds (and applies) the native menu from the pure template. */
  readonly buildMenu: (template: readonly TrayTemplateItem[]) => unknown
  readonly translate: (key: string) => string
  readonly dispatchChannel: (channel: string) => void
  /** Dispatch a native affordance to the focused window (new note/task/etc.). */
  readonly dispatchShellAction?: (action: ShellActionPayload['action']) => void
  /** Show + focus an existing window (or restore the last one). */
  readonly showWindow?: () => void
  readonly quit: () => void
}

export const INITIAL_TRAY_STATUS: TrayStatus = { agentState: 'idle', serviceState: 'not-installed' }

export class TrayController {
  private status: TrayStatus = INITIAL_TRAY_STATUS

  constructor(private readonly deps: TrayControllerDependencies) {
    this.apply()
  }

  getStatus(): TrayStatus {
    return this.status
  }

  /** Applies a new status: indicator, tooltip, then menu. */
  setStatus(status: TrayStatus): void {
    this.status = status
    this.apply()
  }

  private apply(): void {
    this.deps.tray.setToolTip(this.deps.translate(trayTooltipKey(this.status.agentState)))
    this.deps.tray.setTitle?.(trayStatusIndicator(this.status))
    const template = toTrayTemplate(buildTrayMenuModel(this.status), this.deps.translate, id => this.onClick(id))
    this.deps.tray.setContextMenu(this.deps.buildMenu(template))
  }

  private onClick(id: TrayMenuItemId): void {
    if (id === 'quit') {
      this.deps.quit()
      return
    }
    if (id === 'showWindow') {
      this.deps.showWindow?.()
      return
    }
    const shellAction = TRAY_ITEM_SHELL_ACTION[id]
    if (shellAction) {
      this.deps.dispatchShellAction?.(shellAction)
      return
    }
    const channel = TRAY_ITEM_CHANNEL[id]
    if (channel) this.deps.dispatchChannel(channel)
  }

  dispose(): void {
    this.deps.tray.destroy()
  }
}