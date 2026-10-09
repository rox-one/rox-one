/**
 * ROX Keeper wave-1 surface: pure model mapping (item ⇄ valueJson, spaces,
 * search, validation) plus a mock-API render of the pane asserting spaces and
 * honest empty states.
 */
import { useDomForFile, resetDom } from '../../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as model from '../keeper-model'
import type { KeeperItemsPane as KeeperItemsPaneComponent, KeeperVaultRpc } from '../KeeperItemsPane'

useDomForFile()

mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

let KeeperItemsPane: typeof KeeperItemsPaneComponent
let resolveKeeperVaultRpc: (api: unknown) => KeeperVaultRpc | null

// Static import cannot work for the pane: its component graph must load after
// the react-i18next mock above is registered. keeper-model is pure (no i18n),
// so it is imported statically.
beforeAll(async () => {
  ;({ KeeperItemsPane, resolveKeeperVaultRpc } = await import('../KeeperItemsPane'))
})

afterEach(() => {
  resetDom()
})

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(node)
  })
  return { container, root }
}

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => {
    await promise
  })
}

async function unmount(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
  })
}

describe('keeper model', () => {
  it('parses and serializes the item value round-trip', () => {
    const value = model.parseItemValue(
      JSON.stringify({
        type: 'login',
        title: '  Почта  ',
        username: 'user@example.com',
        password: ' pa ss ',
        url: 'https://mail.example.com',
        notes: 'заметка',
        totp: 'JBSWY3DPEHPK3PXP',
        tags: ['Работа', 'работа', ''],
        shared: true,
      }),
    )
    expect(value.type).toBe('login')
    expect(value.username).toBe('user@example.com')
    expect(value.tags).toEqual(['Работа'])
    expect(value.shared).toBe(true)

    const json = model.serializeItemValue(value)
    const roundTrip = model.parseItemValue(json)
    expect(roundTrip).toEqual(value)
    // Empty optionals and shared:false stay out of the payload.
    expect(model.serializeItemValue({ type: 'note', title: 'N' })).toBe('{"type":"note","title":"N"}')
  })

  it('falls back to an empty note for malformed or non-object JSON', () => {
    expect(model.parseItemValue('not json').title).toBe('')
    expect(model.parseItemValue('[1,2]').type).toBe('note')
    expect(model.parseItemValue('').title).toBe('')
    expect(model.parseItemValue(undefined).type).toBe('note')
  })

  it('validates required title, URL scheme and TOTP base32', () => {
    expect(model.validateValue({ type: 'login', title: '  ' })).toEqual([
      { field: 'title', key: 'extraScreens.keeper.error.titleRequired' },
    ])
    expect(model.validateValue({ type: 'login', title: 'A', url: 'mail.example.com' })).toEqual([
      { field: 'url', key: 'extraScreens.keeper.error.invalidUrl' },
    ])
    expect(model.validateValue({ type: 'login', title: 'A', url: 'https://a.example' })).toEqual([])
    expect(model.validateValue({ type: 'login', title: 'A', totp: 'hello!' })).toEqual([
      { field: 'totp', key: 'extraScreens.keeper.error.invalidTotp' },
    ])
    expect(model.validateValue({ type: 'login', title: 'A', totp: 'jbsw y3dp ehpk3pxp' })).toEqual([])
  })

  it('derives unique, ASCII-safe vault keys from the title', () => {
    expect(model.deriveItemKey('Моя почта!')).toBe('moya-pochta')
    expect(model.deriveItemKey('Моя почта', ['moya-pochta'])).toBe('moya-pochta-2')
    expect(model.deriveItemKey('Моя почта', ['moya-pochta', 'moya-pochta-2'])).toBe('moya-pochta-3')
    expect(model.deriveItemKey('!!!')).toBe('item')
    expect(model.KEEPER_KEY_RE.test(model.deriveItemKey('Почта России / Работа', []))).toBe(true)
  })

  it('maps raw (non-JSON) secrets to a read-only item and accepts parsed objects', () => {
    const raw = model.itemFromRaw({ key: 'legacy', valueJson: null, raw: true, updatedAt: '2026-01-01T00:00:00Z' }, '/personal')
    expect(raw.raw).toBe(true)
    expect(raw.value.title).toBe('')
    expect(model.draftFromItem(raw)).toMatchObject({ key: 'legacy', raw: true })

    const parsed = model.itemFromRaw({ key: 'k', valueJson: { type: 'card', title: 'Карта' } }, '/personal')
    expect(parsed.raw).toBe(false)
    expect(parsed.value.type).toBe('card')
  })

  it('enforces the vault key charset and the 16 KB value cap before saving', () => {
    const tooBig = model.emptyDraft('/personal')
    tooBig.title = 'Заметка'
    tooBig.notes = 'x'.repeat(17_000)
    expect(model.validateForSave(tooBig, []).map((issue) => issue.key)).toContain(
      'extraScreens.keeper.error.valueTooLarge',
    )
    const ok = model.emptyDraft('/personal')
    ok.title = 'Почта'
    expect(model.validateForSave(ok, [])).toEqual([])
  })

  it('derives spaces and folders from listPaths, folding orphans into «Личное»', () => {
    const tree = model.buildSpaceTree(['/personal', '/personal/Работа', '/organization/Team', '/Work', '/personal/Работа'])
    expect(tree.map((space) => space.id)).toEqual(['personal', 'organization'])
    const personal = tree[0]!
    expect(personal.folders.map((folder) => folder.name)).toEqual(['Work', 'Работа'])
    const organization = tree[1]!
    expect(organization.folders.map((folder) => folder.name)).toEqual(['Team'])
  })

  it('normalizes paths and filters/sorts items by search tokens', () => {
    expect(model.normalizeSecretPath('personal/work/')).toBe('/personal/work')
    expect(model.normalizeSecretPath('')).toBe('/')
    expect(model.normalizeSecretPath('/')).toBe('/')

    const items = [
      model.itemFromRaw({ key: 'b', valueJson: JSON.stringify({ type: 'note', title: 'Бета', tags: ['сайт'] }) }, '/p'),
      model.itemFromRaw(
        { key: 'a', valueJson: JSON.stringify({ type: 'login', title: 'Альфа', username: 'user@example.com' }) },
        '/p',
      ),
    ]
    expect(model.sortItems(items).map((item) => item.key)).toEqual(['a', 'b'])
    expect(model.filterItems(items, 'user@example').map((item) => item.key)).toEqual(['a'])
    expect(model.filterItems(items, 'сайт').map((item) => item.key)).toEqual(['b'])
    expect(model.filterItems(items, '').length).toBe(2)
  })
})

describe('resolveKeeperVaultRpc', () => {
  it('resolves only when all four keeper methods are present', () => {
    const api = {
      fabricInfisicalListPaths: async () => ({ paths: [] }),
      fabricInfisicalListItems: async () => ({ items: [] }),
      fabricInfisicalUpsertItem: async () => ({}),
      fabricInfisicalDeleteItem: async () => ({}),
    }
    expect(resolveKeeperVaultRpc(api)).toBe(api)
    expect(resolveKeeperVaultRpc({ ...api, fabricInfisicalDeleteItem: undefined })).toBeNull()
    expect(resolveKeeperVaultRpc(undefined)).toBeNull()
  })
})

function fakeRpc(overrides: Partial<KeeperVaultRpc> = {}): KeeperVaultRpc {
  return {
    fabricInfisicalListPaths: mock(async () => ({ paths: ['/personal/Работа', '/organization/Team'] })),
    fabricInfisicalListItems: mock(async () => ({ items: [] })),
    fabricInfisicalUpsertItem: mock(async () => ({})),
    fabricInfisicalDeleteItem: mock(async () => ({})),
    ...overrides,
  } as KeeperVaultRpc
}

describe('KeeperItemsPane', () => {
  it('renders the two spaces, their folders and honest empty states', async () => {
    const rpc = fakeRpc()
    const { container, root } = await render(
      <KeeperItemsPane scope={{ projectId: 'p1', environment: 'prod', secretPath: '/' }} rpc={rpc} />,
    )
    await flush()

    expect(rpc.fabricInfisicalListPaths).toHaveBeenCalledWith({ projectId: 'p1', environment: 'prod' })
    expect(rpc.fabricInfisicalListItems).toHaveBeenCalledWith({
      projectId: 'p1',
      environment: 'prod',
      secretPath: '/personal',
    })

    const text = container.textContent ?? ''
    expect(text).toContain('extraScreens.keeper.space.personal')
    expect(text).toContain('extraScreens.keeper.space.organization')
    expect(text).toContain('Работа')
    expect(text).toContain('Team')
    // No items in the personal space → honest empty state, no empty editor.
    expect(text).toContain('extraScreens.keeper.empty.noItems')
    expect(text).toContain('extraScreens.keeper.empty.noItemsHint')
    expect(text).toContain('extraScreens.keeper.empty.noSelection')
    expect(text).toContain('extraScreens.keeper.newItem')

    await unmount(root)
  })

  it('surfaces a load error instead of a fake empty vault', async () => {
    const rpc = fakeRpc({
      fabricInfisicalListPaths: mock(async () => {
        throw new Error('bridge-down')
      }),
    })
    const { container, root } = await render(
      <KeeperItemsPane scope={{ projectId: 'p1', environment: 'prod', secretPath: '/' }} rpc={rpc} />,
    )
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('extraScreens.keeper.error.loadPaths')
    expect(text).not.toContain('extraScreens.keeper.space.personal')
    await unmount(root)
  })

  it('renders a non-JSON secret as read-only with delete only', async () => {
    const rpc = fakeRpc({
      fabricInfisicalListItems: mock(async () => ({
        items: [{ key: 'legacy', valueJson: null, raw: true, updatedAt: '2026-01-01T00:00:00Z' }],
      })),
    })
    const { container, root } = await render(
      <KeeperItemsPane scope={{ projectId: 'p1', environment: 'prod', secretPath: '/' }} rpc={rpc} />,
    )
    await flush()

    const row = Array.from(container.querySelectorAll('button')).find((button) =>
      (button.textContent ?? '').includes('legacy'),
    )
    expect(row).toBeDefined()
    await act(async () => {
      row!.click()
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('extraScreens.keeper.rawItemHint')
    expect(text).toContain('extraScreens.keeper.rawBadge')
    // Editing is unavailable, deletion is not.
    expect(text).not.toContain('extraScreens.keeper.save')
    expect(text).toContain('extraScreens.keeper.delete')
    await unmount(root)
  })
})