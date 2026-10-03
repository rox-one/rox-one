import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import * as React from 'react'
import { buildInviteUrl } from '@craft-agent/shared/collaboration'
import * as sharing from '../../../lib/session-sharing'
import { routes } from '../../../lib/navigate'

const invitation = buildInviteUrl('ada', 'sess-1', 'ab'.repeat(16))

function nodes(node: React.ReactNode): React.ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!React.isValidElement(node)) return []
  return [node, ...nodes((node.props as any).children)]
}

async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve() }

/** Execute the real dialog's input, submit and workspace effect callbacks. */
function harness(options: { targetWorkspace?: string; responseWorkspace?: string; missing?: boolean; denied?: boolean; switchFailed?: boolean } = {}) {
  const slots: any[] = []
  let cursor = 0
  let activeWorkspaceId = 'workspace-a'
  let metadata = new Map<string, { workspaceId: string }>()
  const effects: Array<() => void> = []
  const frames = new Map<number, FrameRequestCallback>()
  const listeners = new Map<string, EventListener>()
  const events: string[] = []
  const success: string[] = []
  let frameId = 0
  const session = { id: 'sess-1', workspaceId: options.targetWorkspace ?? 'workspace-b', messages: [] }
  const fakeReact = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect(create: () => unknown, deps: unknown[]) {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => value === previous.deps[i])) return
      const next = { deps, cleanup: undefined as any }; slots[index] = next
      effects.push(() => { previous?.cleanup?.(); next.cleanup = create() })
    },
  }
  const bindings = {
    ...sharing, React: fakeReact, routes,
    useTranslation: () => ({ t: (key: string) => key }),
    useNavigation: () => ({ navigate: navigateToSession }),
    useAtomValue: () => metadata,
    useStore: () => ({ get: () => metadata }),
    useSetAtom: () => (fresh: typeof session) => {
      events.push(`load:${fresh.id}`)
      metadata = new Map(metadata).set(fresh.id, { workspaceId: fresh.workspaceId })
    },
    addSessionAtom: {}, replaceLoadedSessionAtom: {}, sessionMetaMapAtom: {},
    toast: { success: (message: string) => { success.push(message); events.push('success') } },
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    window: {
      addEventListener: (name: string, callback: EventListener) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
      electronAPI: {
        sessionCommand: async (id: string, command: any) => {
          events.push(`command:${id}:${command.type}`)
          return options.denied ? { ok: false, error: 'invalid' }
            : { ok: true, sessionId: id, workspaceId: options.responseWorkspace ?? options.targetWorkspace ?? 'workspace-b', role: 'editor', accountId: 'acc-1' }
        },
        getSessionMessages: async (id: string) => { events.push(`read:${id}`); return options.missing ? null : session },
      },
    },
    Dialog: 'dialog', DialogContent: 'dialog-content', DialogDescription: 'dialog-description', DialogFooter: 'dialog-footer', DialogHeader: 'dialog-header', DialogTitle: 'dialog-title',
    Input: 'input', Button: 'button', Check: 'check', Copy: 'copy', ExternalLink: 'external-link', Link2: 'link', Loader2: 'loader', UserPlus: 'user',
  }
  async function navigateToSession(route: string) {
    expect(activeWorkspaceId).toBe(session.workspaceId)
    expect(metadata.get(session.id)?.workspaceId).toBe(session.workspaceId)
    events.push(`navigate:${route}`)
  }
  const sourcePath = resolve(import.meta.dir, '../SessionSharingHost.tsx')
  const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SessionSharingHost')!
  const output = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  const component = new Function(...Object.keys(bindings), `${output}\nreturn SessionSharingHost;`)(...Object.values(bindings))
  let view: React.ReactElement<any>[] = []
  const render = () => {
    cursor = 0
    view = nodes(component({ activeWorkspaceId, onSwitchWorkspace: async (workspaceId: string) => {
      events.push(`switch:${workspaceId}`)
      if (options.switchFailed) throw new Error('Workspace unavailable')
      activeWorkspaceId = workspaceId
      metadata = new Map()
    } }))
    for (const effect of effects.splice(0)) effect()
  }
  render()
  listeners.get(sharing.JOIN_SESSION_EVENT)!(new Event(sharing.JOIN_SESSION_EVENT)); render()
  view.find(node => node.type === 'input')!.props.onChange({ target: { value: invitation } }); render()
  return {
    events, success, render,
    submit: () => view.find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} }) as Promise<void>,
    runFrames() { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0) } },
    error: () => view.find(node => node.props.role === 'alert')?.props.children,
  }
}

describe('Join session dialog behavior', () => {
  it('switches workspace and opens actual loaded session after workspace restoration before showing success', async () => {
    const h = harness()
    const completion = h.submit(); await flush(); h.render()
    expect(h.success).toEqual([])
    expect(h.events).toEqual(['command:sess-1:joinBroInvite', 'read:sess-1', 'switch:workspace-b', 'load:sess-1'])
    h.events.push('workspace-restoration')
    h.runFrames(); await completion
    expect(h.events.slice(-3)).toEqual(['workspace-restoration', 'navigate:allSessions/session/sess-1', 'success'])
    expect(h.success).toEqual(['sessionSharing.joined'])
  })

  it('opens a session in the current workspace without switching', async () => {
    const h = harness({ targetWorkspace: 'workspace-a' })
    const completion = h.submit(); await flush(); h.render(); h.runFrames(); await completion
    expect(h.events.some(event => event.startsWith('switch:'))).toBe(false)
    expect(h.events.at(-1)).toBe('success')
  })

  it('keeps a deleted-target denial visible without loading, navigation or success', async () => {
    const h = harness({ denied: true })
    await h.submit(); h.render()
    expect(h.events).toEqual(['command:sess-1:joinBroInvite'])
    expect(h.error()).toBe('sessionSharing.error.invalid')
    expect(h.success).toEqual([])
  })

  it('does not report success if the actual session disappears after acceptance', async () => {
    const h = harness({ missing: true })
    await h.submit(); h.render()
    expect(h.error()).toBe('sessionSharing.error.invalid')
    expect(h.events).toEqual(['command:sess-1:joinBroInvite', 'read:sess-1'])
    expect(h.success).toEqual([])
  })

  it('keeps a failed workspace switch recoverable instead of navigating the old workspace', async () => {
    const h = harness({ switchFailed: true })
    await h.submit(); h.render()
    expect(h.error()).toBe('sessionSharing.error.failed')
    expect(h.events.at(-1)).toBe('switch:workspace-b')
    expect(h.success).toEqual([])
  })

  it('rejects inconsistent target workspace data before a switch', async () => {
    const h = harness({ targetWorkspace: 'workspace-b', responseWorkspace: 'workspace-c' })
    await h.submit(); h.render()
    expect(h.error()).toBe('sessionSharing.error.invalid')
    expect(h.events.some(event => event.startsWith('switch:'))).toBe(false)
    expect(h.success).toEqual([])
  })
})
