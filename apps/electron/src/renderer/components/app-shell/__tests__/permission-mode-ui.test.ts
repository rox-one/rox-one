import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import * as React from 'react'
import { PERMISSION_MODE_CONFIG, PERMISSION_MODE_ORDER, type PermissionMode } from '@rox/shared/agent/modes'
import { defaultSessionOptions, mergeSessionOptions, type SessionOptions } from '../../../hooks/useSessionOptions'
import { readLocalSessionCapability } from '../../../lib/caller-session-loading'

const renderer = resolve(import.meta.dir, '../../..')

/** Execute the actual UI and App callbacks; substitute scheduling, IPC and DOM target registration. */
function declaration(path: string, name: string): string {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let text: string | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(source).replace(/^export\s+/, '')
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      text = `const ${name} = ${node.initializer.getText(source)};`
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!text) throw new Error(`Missing declaration ${name}`)
  return text
}

function evaluate<T>(path: string, name: string, bindings: Record<string, unknown>, extras: string[] = []): T {
  const source = [...extras, name].map(key => declaration(path, key)).join('\n')
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  return new Function(...Object.keys(bindings), `${output}\nreturn ${name};`)(...Object.values(bindings))
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  // The baseline callback ignores RPC rejection. Observe the same rejection here
  // so the regression can report the stuck UI, without an unhandled test process error.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve() }

function descendants(node: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!React.isValidElement(node)) return []
  return [node, ...descendants((node.props as any).children)]
}

function uiHarness(kind: 'desktop' | 'compact') {
  const slots: unknown[] = []
  let cursor = 0
  // Without a tour provider, the hook returns a DOM ref callback and registers nothing.
  const tourTarget = (_node: HTMLElement | null) => {}
  const react = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? (value as Function)(slots[index]) : value }]
    },
    useCallback: (callback: unknown) => callback,
    useMemo: (create: () => unknown) => create(),
    useEffect(create: () => void, deps: unknown[]) {
      const index = cursor++
      const previous = slots[index] as unknown[] | undefined
      if (!previous || deps.some((value, i) => value !== previous[i])) { slots[index] = deps; create() }
    },
  }
  const bindings = {
    React: react, useTranslation: () => ({ t: (key: string) => key }), cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
    useTourTarget: () => tourTarget,
    PERMISSION_MODE_CONFIG, PERMISSION_MODE_ORDER, isWebUI: false,
    Popover: 'popover', PopoverContent: 'popover-content', PopoverTrigger: 'popover-trigger',
    SlashCommandMenu: 'slash-menu', DEFAULT_SLASH_COMMAND_GROUPS: [],
    PermissionModeIcon: 'permission-icon', ModeIcon: 'permission-icon', ChevronDown: 'chevron', Check: 'check',
    // No active learning runtime is installed in this controlled UI fixture.
    useTourTarget: () => () => {},
    Drawer: 'drawer', DrawerTrigger: 'drawer-trigger', DrawerContent: 'drawer-content', DrawerHeader: 'drawer-header', DrawerTitle: 'drawer-title', DrawerClose: 'drawer-close',
  }
  const path = kind === 'desktop'
    ? resolve(renderer, 'components/app-shell/ActiveOptionBadges.tsx')
    : resolve(renderer, 'components/app-shell/input/CompactPermissionModeSelector.tsx')
  const component = evaluate<(props: { permissionMode: PermissionMode; onPermissionModeChange: (mode: PermissionMode) => void }) => React.ReactNode>(
    path, kind === 'desktop' ? 'PermissionModeDropdown' : 'CompactPermissionModeSelector', bindings,
    kind === 'desktop' ? [] : ['MODE_STYLES', 'MODE_LABEL_KEYS'],
  )
  return {
    render(mode: PermissionMode, onChange: (mode: PermissionMode) => void) {
      cursor = 0
      const nodes = descendants(component({ permissionMode: mode, onPermissionModeChange: onChange }))
      if (kind === 'desktop') {
        const menu = nodes.find(node => node.type === 'slash-menu')!
        return { select: (value: PermissionMode) => menu.props.onSelect(value), selected: menu.props.activeCommands[0] }
      }
      const choices = nodes.filter(node => node.type === 'button' && node.props.onClick)
      const selectedChoice = choices.find(node => descendants(node.props.children).some(child => child.type === 'check'))
      return {
        select: (value: PermissionMode) => choices.find(node => descendants(node.props.children).some(child => child.type === 'permission-icon' && child.props.mode === value))!.props.onClick(),
        selected: descendants(selectedChoice?.props.children).find(child => child.type === 'permission-icon')?.props.mode,
      }
    },
  }
}

function appHarness() {
  let options = new Map<string, SessionOptions>()
  const optionsRef = { current: options }
  const requests: Array<{ sessionId: string; command: any; response: ReturnType<typeof deferred> }> = []
  const readbacks: string[] = []
  const backend = new Map<string, { permissionMode: PermissionMode; modeVersion: number; changedAt: string; changedBy: 'user' }>()
  const errors: string[] = []
  let failReadback = false
  let heldReadback: Promise<unknown> | null = null
  const bindings: Record<string, any> = {
    useCallback: (callback: unknown) => callback,
    setSessionOptions: (update: (current: Map<string, SessionOptions>) => Map<string, SessionOptions>) => { options = update(options); optionsRef.current = options },
    sessionOptionsRef: optionsRef, permissionModeRequestsRef: { current: new Map() }, callerAuthorityRef: { current: 'local' },
    defaultSessionOptions, mergeSessionOptions, readLocalSessionCapability,
    sessionOptions: options,
    t: (key: string) => key, toast: { error: (message: string) => errors.push(message) },
    window: { electronAPI: {
      debugLog: () => {},
      sessionCommand: (sessionId: string, command: unknown) => {
        const response = deferred(); requests.push({ sessionId, command, response }); return response.promise
      },
      getSessionPermissionModeState: async (sessionId: string) => {
        readbacks.push(sessionId)
        if (failReadback) throw new Error('Offline')
        return heldReadback ?? backend.get(sessionId) ?? null
      },
    } },
  }
  const appPath = process.env.ROX_PERMISSION_APP_TEST_SOURCE ?? resolve(renderer, 'App.tsx')
  bindings.applyPermissionModeState = evaluate(appPath, 'applyPermissionModeState', bindings)
  bindings.reconcilePermissionModeState = evaluate(appPath, 'reconcilePermissionModeState', bindings)
  const change = evaluate<(id: string, updates: Partial<SessionOptions>) => void>(appPath, 'handleSessionOptionsChange', bindings)
  const hook = evaluate<(id: string) => { options: SessionOptions; setPermissionMode: (mode: PermissionMode) => void }>(
    resolve(renderer, 'context/AppShellContext.tsx'), 'useSessionOptionsFor', {
      useCallback: bindings.useCallback, defaultSessionOptions,
      useAppShellContext: () => ({ sessionOptions: options, onSessionOptionsChange: change }),
    },
  )
  return {
    requests, readbacks, errors, backend, hook,
    seed(id: string) {
      options.set(id, { ...defaultSessionOptions, permissionMode: 'allow-all', permissionModeVersion: 4 })
      backend.set(id, { permissionMode: 'allow-all', modeVersion: 4, changedAt: '2026-10-03T00:00:00Z', changedBy: 'user' })
    },
    setFailReadback() { failReadback = true },
    holdReadback(response: Promise<unknown> | null) { heldReadback = response },
    switchToNative() {
      options = new Map(); optionsRef.current = options
      bindings.callerAuthorityRef.current = 'native'
    },
    applyEvent(id: string, mode: PermissionMode, version: number) {
      bindings.applyPermissionModeState(id, { permissionMode: mode, modeVersion: version, changedAt: '2026-10-03T00:00:00Z', changedBy: 'user' }, 'event')
    },
  }
}

for (const kind of ['desktop', 'compact'] as const) {
  describe(`${kind} Overview permission selection`, () => {
    for (const sessionId of ['new-empty-session', 'active-chat-session']) {
      it(`clicks safe for ${sessionId}, selects it, and reconciles the persisted version`, async () => {
        const app = appHarness(); app.seed(sessionId)
        const ui = uiHarness(kind)
        const initial = app.hook(sessionId)
        ui.render(initial.options.permissionMode, initial.setPermissionMode).select('safe')
        expect(app.requests[0].sessionId).toBe(sessionId)
        expect(app.requests[0].command).toEqual({ type: 'setPermissionMode', mode: 'safe' })
        expect(ui.render(app.hook(sessionId).options.permissionMode, app.hook(sessionId).setPermissionMode).selected).toBe('safe')
        app.backend.set(sessionId, { permissionMode: 'safe', modeVersion: 5, changedAt: '2026-10-03T00:00:00Z', changedBy: 'user' })
        app.requests[0].response.resolve(); await flush()
        expect(app.readbacks).toEqual([sessionId])
        expect(app.hook(sessionId).options.permissionModeVersion).toBe(5)
        expect(app.errors).toEqual([])
      })
    }

    it('restores the actual mode when RPC fails before the optimistic UI commits', async () => {
      const app = appHarness(); app.seed('active')
      const ui = uiHarness(kind)
      ui.render('allow-all', app.hook('active').setPermissionMode).select('safe')
      app.requests[0].response.reject(new Error('RPC unavailable')); await flush()
      const actual = app.hook('active')
      expect(actual.options.permissionMode).toBe('allow-all')
      expect(ui.render(actual.options.permissionMode, actual.setPermissionMode).selected).toBe('allow-all')
      expect(app.errors).toEqual(['toast.failedToChangePermissionMode'])
    })

    it('rolls back after a failed command and unavailable readback', async () => {
      const app = appHarness(); app.seed('active'); app.setFailReadback()
      const ui = uiHarness(kind)
      ui.render('allow-all', app.hook('active').setPermissionMode).select('safe')
      app.requests[0].response.reject(new Error('Offline')); await flush()
      expect(app.hook('active').options.permissionMode).toBe('allow-all')
      expect(ui.render(app.hook('active').options.permissionMode, app.hook('active').setPermissionMode).selected).toBe('allow-all')
    })

    it('restores the last actual mode when both rapid clicks fail offline', async () => {
      const app = appHarness(); app.seed('active'); app.setFailReadback()
      const ui = uiHarness(kind)
      ui.render('allow-all', app.hook('active').setPermissionMode).select('safe')
      ui.render('safe', app.hook('active').setPermissionMode).select('ask')
      app.requests[0].response.reject(new Error('Offline'))
      app.requests[1].response.reject(new Error('Offline')); await flush()
      const actual = app.hook('active')
      expect(actual.options.permissionMode).toBe('allow-all')
      expect(actual.options.permissionModeVersion).toBe(4)
      expect(ui.render(actual.options.permissionMode, actual.setPermissionMode).selected).toBe('allow-all')
      expect(app.errors).toEqual(['toast.failedToChangePermissionMode'])
    })

    it('uses the confirmed event as the fallback while a newer click fails', async () => {
      const app = appHarness(); app.seed('active'); app.setFailReadback()
      const ui = uiHarness(kind)
      ui.render('allow-all', app.hook('active').setPermissionMode).select('safe')
      app.applyEvent('active', 'safe', 5)
      ui.render('safe', app.hook('active').setPermissionMode).select('ask')
      app.requests[0].response.resolve()
      app.requests[1].response.reject(new Error('Offline')); await flush()
      expect(app.hook('active').options.permissionMode).toBe('safe')
      expect(app.hook('active').options.permissionModeVersion).toBe(5)
      expect(ui.render(app.hook('active').options.permissionMode, app.hook('active').setPermissionMode).selected).toBe('safe')
    })

    it('ignores failure of an older click and stale versioned mode events', async () => {
      const app = appHarness(); app.seed('active')
      const ui = uiHarness(kind)
      ui.render('allow-all', app.hook('active').setPermissionMode).select('safe')
      ui.render('safe', app.hook('active').setPermissionMode).select('ask')
      app.backend.set('active', { permissionMode: 'ask', modeVersion: 6, changedAt: '2026-10-03T00:00:00Z', changedBy: 'user' })
      app.requests[1].response.resolve(); await flush()
      app.requests[0].response.reject(new Error('Late failure')); await flush()
      app.applyEvent('active', 'allow-all', 5)
      const actual = app.hook('active')
      expect(actual.options.permissionMode).toBe('ask')
      expect(actual.options.permissionModeVersion).toBe(6)
      expect(ui.render(actual.options.permissionMode, actual.setPermissionMode).selected).toBe('ask')
      expect(app.errors).toEqual([])
    })

    it('keeps a newer selection when an older readback arrives late', async () => {
      const app = appHarness(); app.seed('active')
      let release!: (state: unknown) => void
      app.holdReadback(new Promise(resolve => { release = resolve }))
      const ui = uiHarness(kind)
      ui.render('allow-all', app.hook('active').setPermissionMode).select('safe')
      app.requests[0].response.resolve(); await flush()
      ui.render('safe', app.hook('active').setPermissionMode).select('ask')
      app.holdReadback(null)
      release({ permissionMode: 'safe', modeVersion: 5, changedAt: '2026-10-03T00:00:00Z', changedBy: 'user' }); await flush()
      expect(app.hook('active').options.permissionMode).toBe('ask')
      app.backend.set('active', { permissionMode: 'ask', modeVersion: 6, changedAt: '2026-10-03T00:00:00Z', changedBy: 'user' })
      app.requests[1].response.resolve(); await flush()
      expect(app.hook('active').options.permissionModeVersion).toBe(6)
    })

    it('does not restore host session options after switching to native authority', async () => {
      const app = appHarness(); app.seed('active')
      const ui = uiHarness(kind)
      ui.render('allow-all', app.hook('active').setPermissionMode).select('ask')
      app.switchToNative()
      app.requests[0].response.reject(new Error('Late failure')); await flush()
      expect(app.readbacks).toEqual([])
      expect(app.hook('active').options).toBe(defaultSessionOptions)
      expect(app.errors).toEqual([])
    })
  })
}
