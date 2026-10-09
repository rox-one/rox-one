import { describe, expect, it } from 'bun:test'
import {
  buildTrayMenuModel,
  SERVICE_STATE_LABEL_KEY,
  toTrayTemplate,
  trayStatusIndicator,
  trayTooltipKey,
  TrayController,
  type TrayTemplateItem,
} from '../tray'
import { RPC_CHANNELS } from '../../shared/types'

function createHarness() {
  const tooltips: string[] = []
  const titles: string[] = []
  const menus: TrayTemplateItem[][] = []
  const dispatched: string[] = []
  const shellActions: string[] = []
  const broadcasts: unknown[] = []
  let shown = 0
  let quits = 0
  let destroyed = 0
  const controller = new TrayController({
    tray: {
      setToolTip: text => { tooltips.push(text) },
      setContextMenu: menu => { menus.push(menu as TrayTemplateItem[]) },
      setTitle: title => { titles.push(title) },
      destroy: () => { destroyed += 1 },
    },
    buildMenu: template => { menus.push([...template]); return template },
    translate: key => key,
    dispatchChannel: channel => { dispatched.push(channel) },
    dispatchShellAction: action => { shellActions.push(action) },
    showWindow: () => { shown += 1 },
    broadcastStatus: status => { broadcasts.push(status) },
    quit: () => { quits += 1 },
  })
  return {
    controller,
    tooltips, titles, menus, dispatched, shellActions, broadcasts,
    shown: () => shown,
    quits: () => quits,
    destroyed: () => destroyed,
    lastMenu: () => menus.at(-1) ?? [],
  }
}

describe('tray model', () => {
  it('lists the status header plus native actions, navigation, diagnostics and quit items', () => {
    const model = buildTrayMenuModel({ agentState: 'idle', serviceState: 'running' })
    expect(model.map(item => item.id)).toEqual([
      'service-status',
      'newNote', 'newTask', 'quickComposer', 'openInbox',
      'openDashboard', 'openApp', 'serviceStatus', 'runDoctor', 'settings',
      'showWindow', 'quit',
    ])
    expect(model[0]).toMatchObject({ labelKey: 'service.state.running', enabled: false })
    expect(model[1]).toMatchObject({ labelKey: 'menu.newNote', enabled: true })
    expect(model[4]).toMatchObject({ labelKey: 'menu.openInbox', enabled: true })
    expect(model[10]).toMatchObject({ labelKey: 'menu.showWindow', enabled: true })
    expect(SERVICE_STATE_LABEL_KEY.failed).toBe('service.state.failed')
  })

  it('maps agent state to tooltip key and indicator glyph', () => {
    expect(trayTooltipKey('idle')).toBe('tray.tooltip.idle')
    expect(trayTooltipKey('working')).toBe('tray.tooltip.working')
    expect(trayTooltipKey('error')).toBe('tray.tooltip.error')
    expect(trayStatusIndicator({ agentState: 'working', serviceState: 'running' })).toBe('◐')
    expect(trayStatusIndicator({ agentState: 'error', serviceState: 'failed' })).toBe('▲')
    expect(trayStatusIndicator({ agentState: 'idle', serviceState: 'stopped' })).toBe('●')
  })

  it('places separators around the status header and quit item', () => {
    const template = toTrayTemplate(
      buildTrayMenuModel({ agentState: 'idle', serviceState: 'installed' }),
      key => key,
      () => {},
    )
    expect(template.map(item => item.type)).toEqual([
      'normal', 'separator',
      'normal', 'normal', 'normal', 'normal',
      'separator', 'normal', 'normal',
      'separator', 'normal', 'normal', 'normal', 'normal',
      'separator', 'normal',
    ])
    expect(template[0]).toMatchObject({ label: 'service.state.installed', enabled: false })
  })
})

describe('tray controller', () => {
  it('applies the initial status and rebuilds the menu on transitions', () => {
    const h = createHarness()
    expect(h.tooltips).toEqual(['tray.tooltip.idle'])
    expect(h.titles).toEqual(['●'])
    expect(h.broadcasts).toEqual([])

    h.controller.setStatus({ agentState: 'working', serviceState: 'running' })
    expect(h.tooltips.at(-1)).toBe('tray.tooltip.working')
    expect(h.titles.at(-1)).toBe('◐')
    expect(h.broadcasts).toEqual([{ agentState: 'working', serviceState: 'running' }])
    expect(h.lastMenu()[0]).toMatchObject({ label: 'service.state.running' })

    h.controller.setStatus({ agentState: 'error', serviceState: 'failed' })
    expect(h.titles.at(-1)).toBe('▲')
    expect(h.broadcasts).toHaveLength(2)
  })

  it('dispatches native shell actions, menu channels, show-window and quit', () => {
    const h = createHarness()
    const click = (label: string) => {
      const item = h.lastMenu().find(candidate => candidate.label === label)
      expect(item?.click).toBeDefined()
      item!.click!()
    }
    click('menu.newNote')
    click('menu.newTask')
    click('menu.quickComposer')
    click('menu.openInbox')
    expect(h.shellActions).toEqual(['new-note', 'new-task', 'quick-composer', 'open-inbox'])

    click('tray.menu.openDashboard')
    click('tray.menu.openApp')
    click('tray.menu.serviceStatus')
    click('tray.menu.runDoctor')
    click('tray.menu.settings')
    expect(h.dispatched).toEqual([
      RPC_CHANNELS.menu.OPEN_DASHBOARD,
      RPC_CHANNELS.menu.OPEN_NATIVE_CONSOLE,
      RPC_CHANNELS.menu.SHOW_SERVICE_STATUS,
      RPC_CHANNELS.menu.RUN_DOCTOR,
      RPC_CHANNELS.menu.OPEN_SETTINGS,
    ])

    click('menu.showWindow')
    expect(h.shown()).toBe(1)

    click('tray.menu.quit')
    expect(h.quits()).toBe(1)
    h.controller.dispose()
    expect(h.destroyed()).toBe(1)
  })
})