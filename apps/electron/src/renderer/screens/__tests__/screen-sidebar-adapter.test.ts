import { describe, expect, it, mock } from 'bun:test'
import { toScreenSidebarGroups } from '../screen-sidebar-adapter'

const t = (k: string) => `t(${k})`

describe('toScreenSidebarGroups', () => {
  it('translates titles/keys, maps icons, prefers counts over badges, wires onSelect and active', () => {
    const onTarget = mock(() => {})
    const Icon = (() => null) as never
    const groups = toScreenSidebarGroups(
      [{ id: 'g', titleKey: 'k.g', limit: 3, collapsible: true, items: [
        { id: 'a', labelKey: 'k.a', icon: 'x', badge: 'running', target: { kind: 'session', sessionId: 'a' } },
        { id: 'b', label: 'B', count: 4, badge: 'unread', target: { kind: 'label', label: 'b' } },
      ] }],
      { t, icons: { x: Icon }, onTarget, activeKey: 'session:a' },
    )
    expect(groups[0]).toMatchObject({ id: 'g', title: 't(k.g)', initialVisible: 3, collapsible: true })
    const [a, b] = groups[0]!.items
    expect(a).toMatchObject({ label: 't(k.a)', icon: Icon, badge: 't(screens.badge.running)', active: true })
    expect(b).toMatchObject({ label: 'B', badge: 4, active: false })
    b!.onSelect()
    expect(onTarget).toHaveBeenCalledWith({ kind: 'label', label: 'b' })
  })

  it('fixed groups without a limit show every item', () => {
    const groups = toScreenSidebarGroups([{ id: 'v', titleKey: 'v', collapsible: false, items: Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, label: `${i}`, target: { kind: 'view', viewId: `${i}` } as const })) }], { t, icons: {}, onTarget: () => {} })
    expect(groups[0]!.initialVisible).toBe(7)
  })
})
