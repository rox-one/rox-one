import { describe, expect, it } from 'bun:test'
import type { ShellActionPayload, TrayStateReport } from '@rox/shared/protocol'
import {
  aggregateTrayReports,
  buildTrayMenuModel,
  EMPTY_TRAY_REPORT,
  INITIAL_TRAY_VIEW,
  RecordingTrayController,
  sanitizeTrayReport,
  toTrayTemplate,
  TrayController,
  trayStatusLine,
  type TrayAction,
  type TrayMenuEntry,
  type TrayTemplateItem,
  type TrayView,
} from '../tray'
import { RPC_CHANNELS } from '@rox/shared/protocol/channels'
import { CHANNEL_MAP } from '../../transport/channel-map'

const view = (patch: Partial<TrayView> = {}, report: Partial<TrayStateReport> = {}): TrayView => ({
  ...INITIAL_TRAY_VIEW,
  serviceState: 'running',
  ...patch,
  report: { ...EMPTY_TRAY_REPORT, ...report },
})

const ids = (model: readonly TrayMenuEntry[]) => model.map(entry => entry.id)
const byId = (model: readonly TrayMenuEntry[], id: string) => model.find(entry => entry.id === id)

function collectActions(model: readonly TrayMenuEntry[]): TrayAction[] {
  return model.flatMap(entry => [...(entry.action ? [entry.action] : []), ...collectActions(entry.submenu ?? [])])
}

function createHarness() {
  const menus: TrayTemplateItem[][] = []
  const titles: string[] = []
  const badges: number[] = []
  const channels: string[] = []
  const shell: ShellActionPayload[] = []
  const calls: string[] = []
  const controller = new TrayController({
    tray: {
      setToolTip: () => {},
      setContextMenu: menu => { menus.push(menu as TrayTemplateItem[]) },
      setTitle: title => { titles.push(title) },
      destroy: () => { calls.push('destroy') },
    },
    buildMenu: template => [...template],
    translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    setBadge: count => { badges.push(count) },
    dispatchChannel: channel => { channels.push(channel) },
    dispatchShellAction: payload => { shell.push(payload) },
    toggleVoice: () => { calls.push('voice') },
    setDoNotDisturb: enabled => { calls.push(`dnd:${enabled}`) },
    checkForUpdates: () => { calls.push('check') },
    installUpdate: () => { calls.push('install') },
    showWindow: () => { calls.push('show') },
    quit: () => { calls.push('quit') },
  })
  const find = (id: string, items: readonly TrayTemplateItem[] = menus.at(-1) ?? []): TrayTemplateItem | undefined => {
    for (const item of items) {
      if (item.id === id) return item
      const nested = item.submenu ? find(id, item.submenu) : undefined
      if (nested) return nested
    }
    return undefined
  }
  return { controller, menus, titles, badges, channels, shell, calls, find, click: (id: string) => find(id)?.click?.() }
}

describe('tray status line', () => {
  it('drops the old raw service state ("Не установлена") when all is well', () => {
    expect(trayStatusLine(view({ serviceState: 'not-installed' }))).toBeNull()
    expect(ids(buildTrayMenuModel(view({ serviceState: 'not-installed' })))[0]).toBe('newSession')
  })

  it('says how many agents are working', () => {
    expect(trayStatusLine(view({}, { activeAgents: 3 }))).toMatchObject({ labelKey: 'tray.status.agentsWorking', labelParams: { count: 3 }, enabled: false })
  })

  it('turns a service failure into a clickable diagnostics line', () => {
    const line = trayStatusLine(view({ serviceState: 'failed' }, { activeAgents: 2 }))
    expect(line).toMatchObject({ labelKey: 'tray.status.serviceProblem', action: { kind: 'channel', channel: RPC_CHANNELS.menu.RUN_DOCTOR } })
  })
})

describe('tray menu model', () => {
  it('groups quick commands with separators and no dead items', () => {
    expect(ids(buildTrayMenuModel(view()))).toEqual([
      'newSession', 'askRox', 'voice', 'meetingRecording', 'search', 'sep-create',
      'newNote', 'newTask', 'sep-notes',
      'notifications', 'doNotDisturb', 'sep-places',
      'runDoctor', 'updates', 'settings', 'showWindow', 'sep-quit',
      'quit',
    ])
  })

  it('shows accelerators where a real binding exists', () => {
    const model = buildTrayMenuModel(view({ accelerators: { askRox: 'Alt+Space', voice: 'CommandOrControl+Shift+D' } }))
    expect(byId(model, 'newSession')?.accelerator).toBe('CmdOrCtrl+N')
    expect(byId(model, 'askRox')?.accelerator).toBe('Alt+Space')
    expect(byId(model, 'voice')?.accelerator).toBe('CommandOrControl+Shift+D')
    expect(byId(model, 'search')?.accelerator).toBe('CmdOrCtrl+K')
    expect(byId(model, 'settings')?.accelerator).toBe('CmdOrCtrl+,')
    expect(byId(model, 'quit')?.accelerator).toBe('CmdOrCtrl+Q')
    expect(byId(buildTrayMenuModel(view()), 'askRox')?.accelerator).toBeUndefined()
  })

  it('lists at most five recent sessions and hides the submenu when empty', () => {
    const sessions = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, title: `Session ${i}` }))
    const recent = byId(buildTrayMenuModel(view({}, { recentSessions: sessions })), 'recentSessions')
    expect(recent?.submenu?.map(entry => entry.id)).toEqual(['session:s0', 'session:s1', 'session:s2', 'session:s3', 'session:s4'])
    expect(recent?.submenu?.[0]?.action).toEqual({ kind: 'shell', action: 'open-session', deepLink: { id: 's0' }, show: true })
    expect(byId(buildTrayMenuModel(view()), 'recentSessions')).toBeUndefined()
  })

  it('carries the unread count on «Уведомления»', () => {
    expect(byId(buildTrayMenuModel(view({}, { unreadCount: 24 })), 'notifications')).toMatchObject({ labelKey: 'tray.menu.notificationsCount', labelParams: { count: 24 } })
    expect(byId(buildTrayMenuModel(view()), 'notifications')).toMatchObject({ labelKey: 'tray.menu.notifications' })
  })

  it('shows the workspace switcher only with more than one workspace, checking the active one', () => {
    expect(byId(buildTrayMenuModel(view({ workspaces: [{ id: 'a', name: 'A' }] })), 'workspaces')).toBeUndefined()
    const ws = byId(buildTrayMenuModel(view({ workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], activeWorkspaceId: 'b' })), 'workspaces')
    expect(ws?.submenu?.map(entry => [entry.id, entry.type, entry.checked])).toEqual([['workspace:a', 'radio', false], ['workspace:b', 'radio', true]])
  })

  it('shows the balance only when it is known', () => {
    expect(byId(buildTrayMenuModel(view()), 'balance')).toBeUndefined()
    expect(byId(buildTrayMenuModel(view({}, { balance: 0 })), 'balance')).toMatchObject({ labelParams: { amount: 0 }, enabled: false })
  })

  it('flips recording items and blocks the competing capture', () => {
    const meeting = buildTrayMenuModel(view({}, { recording: { kind: 'meeting', startedAt: 1, paused: false } }))
    expect(byId(meeting, 'meetingRecording')?.labelKey).toBe('tray.menu.stopRecording')
    expect(byId(meeting, 'voice')?.enabled).toBe(false)
    const voice = buildTrayMenuModel(view({}, { recording: { kind: 'voice', startedAt: 1, paused: false } }))
    expect(byId(voice, 'voice')?.labelKey).toBe('tray.menu.voiceStop')
    expect(byId(voice, 'meetingRecording')?.enabled).toBe(false)
  })

  it('offers installing a downloaded update instead of checking', () => {
    expect(byId(buildTrayMenuModel(view({ updateReadyVersion: '2.1.0' })), 'updates')).toMatchObject({ labelKey: 'menu.installUpdateVersion', action: { kind: 'installUpdate' } })
  })

  it('routes every menu channel to a renderer listener', () => {
    const model = buildTrayMenuModel(view({ serviceState: 'failed', workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }, { recentSessions: [{ id: 's', title: 'S' }] }))
    for (const action of collectActions(model)) {
      if (action.kind !== 'channel') continue
      const entry = Object.values(CHANNEL_MAP).find(candidate => candidate.channel === action.channel)
      expect(`${action.channel}:${entry?.type}`).toBe(`${action.channel}:listener`)
    }
  })
})

describe('tray template', () => {
  it('maps accelerators as display-only and keeps literal titles untranslated', () => {
    const template = toTrayTemplate(buildTrayMenuModel(view({}, { recentSessions: [{ id: 's', title: 'tray.menu.quit' }] })), key => `T(${key})`, () => {})
    expect(template.find(item => item.id === 'search')).toMatchObject({ accelerator: 'CmdOrCtrl+K', registerAccelerator: false, label: 'T(tray.menu.search)' })
    expect(template.find(item => item.id === 'recentSessions')?.submenu?.[0]?.label).toBe('tray.menu.quit')
    expect(template.filter(item => item.type === 'separator').length).toBe(4)
  })
})

describe('tray controller', () => {
  it('clears the grey status glyph and drives the badge only on change', () => {
    const h = createHarness()
    expect(h.titles.at(-1)).toBe('')
    expect(h.badges).toEqual([0])
    h.controller.update({ report: { ...EMPTY_TRAY_REPORT, unreadCount: 24 } })
    h.controller.update({ doNotDisturb: true })
    h.controller.update({ report: { ...EMPTY_TRAY_REPORT, unreadCount: 0 } })
    expect(h.badges).toEqual([0, 24, 0])
  })

  it('wires each item to its real effect', () => {
    const h = createHarness()
    h.controller.update({ workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], report: { ...EMPTY_TRAY_REPORT, recentSessions: [{ id: 's1', title: 'One' }] } })
    h.click('newSession')
    expect(h.channels).toEqual([RPC_CHANNELS.menu.NEW_CHAT])
    h.click('askRox')
    h.click('meetingRecording')
    h.click('search')
    h.click('newNote')
    h.click('newTask')
    h.click('notifications')
    h.click('session:s1')
    h.click('workspace:b')
    expect(h.shell).toEqual([
      { action: 'quick-composer' },
      { action: 'toggle-meeting-recording' },
      { action: 'search' },
      { action: 'new-note' },
      { action: 'new-task' },
      { action: 'open-inbox' },
      { action: 'open-session', deepLink: { id: 's1' } },
      { action: 'switch-workspace', deepLink: { workspaceId: 'b' } },
    ])
    h.calls.length = 0
    h.click('voice')
    h.click('updates')
    h.click('settings')
    h.click('showWindow')
    h.click('quit')
    expect(h.calls).toEqual(['voice', 'check', 'show', 'show', 'quit'])
    expect(h.channels.at(-1)).toBe(RPC_CHANNELS.menu.OPEN_SETTINGS)
  })

  it('toggles Do Not Disturb and reflects it in the checkbox', () => {
    const h = createHarness()
    h.click('doNotDisturb')
    expect(h.calls).toContain('dnd:true')
    expect(h.find('doNotDisturb')?.checked).toBe(true)
    h.click('doNotDisturb')
    expect(h.calls).toContain('dnd:false')
    expect(h.find('doNotDisturb')?.checked).toBe(false)
  })
})

describe('recording tray', () => {
  function recordingHarness() {
    const log: string[] = []
    let clickHandler: (() => void) | null = null
    let tick: (() => void) | null = null
    let now = 100_000
    const ctrl = new RecordingTrayController({
      createTray: () => ({
        setTitle: title => { log.push(`title:${title}`) },
        setToolTip: text => { log.push(`tip:${text}`) },
        onClick: handler => { clickHandler = handler },
        destroy: () => { log.push('destroy') },
      }),
      translate: key => key,
      stop: kind => { log.push(`stop:${kind}`) },
      now: () => now,
      setInterval: fn => { tick = fn; return 1 },
      clearInterval: () => { log.push('clear') },
    })
    return { ctrl, log, click: () => clickHandler?.(), tick: () => tick?.(), advance: (ms: number) => { now += ms } }
  }

  it('appears with elapsed time, ticks, stops on click and disappears when recording ends', () => {
    const h = recordingHarness()
    expect(h.ctrl.isVisible()).toBe(false)
    h.ctrl.set({ kind: 'meeting', startedAt: 58_000, paused: false })
    expect(h.ctrl.isVisible()).toBe(true)
    expect(h.log).toEqual(['tip:tray.recording.stopMeeting', 'title: 0:42'])
    h.advance(1000)
    h.tick()
    expect(h.log.at(-1)).toBe('title: 0:43')
    h.click()
    expect(h.log.at(-1)).toBe('stop:meeting')
    h.ctrl.set(null)
    expect(h.ctrl.isVisible()).toBe(false)
    expect(h.log.slice(-2)).toEqual(['clear', 'destroy'])
  })

  it('stops a voice capture as voice', () => {
    const h = recordingHarness()
    h.ctrl.set({ kind: 'voice', startedAt: 100_000, paused: false })
    h.click()
    expect(h.log).toContain('tip:tray.recording.stopVoice')
    expect(h.log.at(-1)).toBe('stop:voice')
  })
})

describe('tray report plumbing', () => {
  it('sanitizes malformed IPC payloads', () => {
    expect(sanitizeTrayReport(null)).toEqual(EMPTY_TRAY_REPORT)
    expect(sanitizeTrayReport({
      unreadCount: -3, activeAgents: 2.7, balance: Number.NaN,
      recentSessions: [{ id: 'a', title: 'A' }, { id: 1 }, null, { id: '', title: 'x' }],
      recording: { kind: 'video', startedAt: 1 },
    })).toEqual({ unreadCount: 0, activeAgents: 2, balance: null, recentSessions: [{ id: 'a', title: 'A' }], recording: null })
  })

  it('takes counts from the active window but recording from whichever window records', () => {
    const reports = new Map<number, TrayStateReport>([
      [1, { ...EMPTY_TRAY_REPORT, unreadCount: 5 }],
      [2, { ...EMPTY_TRAY_REPORT, unreadCount: 9, recording: { kind: 'meeting', startedAt: 1, paused: false } }],
    ])
    const { report, recordingOwner } = aggregateTrayReports(reports, 1)
    expect(report.unreadCount).toBe(5)
    expect(report.recording?.kind).toBe('meeting')
    expect(recordingOwner).toBe(2)
    expect(aggregateTrayReports(new Map(), null)).toEqual({ report: EMPTY_TRAY_REPORT, recordingOwner: null })
  })

  it('exposes the report channel to the renderer as an invoke', () => {
    expect(CHANNEL_MAP.reportTrayState).toMatchObject({ type: 'invoke', channel: RPC_CHANNELS.tray.REPORT_STATE })
  })
})
