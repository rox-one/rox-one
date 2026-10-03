import { describe, expect, test } from 'bun:test'
import type { IpcMainEvent } from 'electron'
import { readBoundWindowWorkspace } from '../bootstrap-window-workspace'
import type { WindowManager } from '../window-manager'

function fixture() {
  let workspaceId: string | null = 'workspace-A'
  let deadWindow = false
  let deadContents = false
  let lookupCalls = 0
  const frame = { url: 'app://synthetic-bootstrap' }
  const sender = { id: 41, mainFrame: frame, isDestroyed: () => deadContents }
  const owner = { webContents: sender, isDestroyed: () => deadWindow }
  const event = { sender, senderFrame: frame } as unknown as IpcMainEvent
  const manager = { getWindowByWebContentsId: (id: number) => id === sender.id ? owner : null,
    getWorkspaceForWindow: () => { lookupCalls++; return workspaceId } } as unknown as Pick<WindowManager, 'getWindowByWebContentsId' | 'getWorkspaceForWindow'>
  return { event, manager, sender, owner,
    switchWorkspace: (value: string | null) => { workspaceId = value },
    destroyWindow: () => { deadWindow = true }, destroyContents: () => { deadContents = true },
    lookups: () => lookupCalls }
}

describe('window-local bootstrap workspace authority', () => {
  test('reads the live binding on every invocation, including A→B→A and an unbound picker', () => {
    const f = fixture()
    expect(readBoundWindowWorkspace(f.event, f.manager)).toBe('workspace-A')
    f.switchWorkspace('workspace-B'); expect(readBoundWindowWorkspace(f.event, f.manager)).toBe('workspace-B')
    f.switchWorkspace('workspace-A'); expect(readBoundWindowWorkspace(f.event, f.manager)).toBe('workspace-A')
    f.switchWorkspace(null); expect(readBoundWindowWorkspace(f.event, f.manager)).toBe('')
    expect(f.lookups()).toBe(4)
  })
  test('does not look up metadata for an unknown native window', () => {
    const f = fixture()
    const foreign = { ...f.event, sender: { ...f.sender, id: 99 } } as unknown as IpcMainEvent
    expect(readBoundWindowWorkspace(foreign, f.manager)).toBe('')
    expect(f.lookups()).toBe(0)
  })
  test('a replacement WebContents with the same ID cannot read the prior owner binding', () => {
    const f = fixture()
    const replaced = { ...f.event, sender: { ...f.sender } } as unknown as IpcMainEvent
    expect(readBoundWindowWorkspace(replaced, f.manager)).toBe('')
    expect(f.lookups()).toBe(0)
  })
  test('iframes and missing sender frames cannot obtain the main-frame binding', () => {
    const f = fixture()
    expect(readBoundWindowWorkspace({ ...f.event, senderFrame: { url: 'https://foreign.example.test' } } as unknown as IpcMainEvent, f.manager)).toBe('')
    expect(readBoundWindowWorkspace({ ...f.event, senderFrame: null } as unknown as IpcMainEvent, f.manager)).toBe('')
    expect(f.lookups()).toBe(0)
  })
  test('destroyed windows and contents do not retain bootstrap authority', () => {
    const windowFixture = fixture(); windowFixture.destroyWindow()
    const contentsFixture = fixture(); contentsFixture.destroyContents()
    expect(readBoundWindowWorkspace(windowFixture.event, windowFixture.manager)).toBe('')
    expect(readBoundWindowWorkspace(contentsFixture.event, contentsFixture.manager)).toBe('')
    expect(windowFixture.lookups() + contentsFixture.lookups()).toBe(0)
  })
  test('client-supplied workspace IDs cannot select another window binding', () => {
    const f = fixture()
    expect(readBoundWindowWorkspace({ ...f.event, workspaceId: 'workspace-B' } as IpcMainEvent, f.manager)).toBe('workspace-A')
    expect(readBoundWindowWorkspace(f.event, undefined)).toBe('')
    expect(readBoundWindowWorkspace(f.event, null)).toBe('')
  })
})
