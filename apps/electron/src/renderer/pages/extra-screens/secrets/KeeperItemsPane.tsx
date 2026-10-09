/**
 * ROX Keeper — the vault surface shown once a vault account is connected.
 * Three flat columns: spaces/folders (from `listPaths`), the item list with
 * search, and the item editor. All vault I/O goes through the typed bridge
 * (`fabricInfisicalList*` / `UpsertItem` / `DeleteItem`).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toErrorMessage } from '@/lib/errors'
import { Chip, Counter, EmptyState, ListRow, ScreenButton, ScreenColumn, ScreenDetail, ScreenHeader, ScreenRoot, SectionLabel, TextField } from '../ui'
import { KeeperItemEditor } from './KeeperItemEditor'
import {
  KEEPER_SPACES,
  buildSpaceTree,
  deriveItemKey,
  draftFromItem,
  emptyDraft,
  filterItems,
  itemFromRaw,
  shareStateKey,
  sortItems,
  validateForSave,
  valueFromDraft,
  type KeeperDraft,
  type KeeperItem,
  type KeeperItemValue,
  type KeeperRawItem,
  type KeeperSpaceId,
} from './keeper-model'

export interface KeeperScope {
  projectId: string
  environment: string
  /** Vault secret path of the connection, used as the base for shared items. */
  secretPath: string
}

/**
 * Client shape of the keeper RPCs. The backend registers these on the channel
 * map as `fabric:infisicalListPaths|ListItems|UpsertItem|DeleteItem`.
 */
export interface KeeperVaultRpc {
  fabricInfisicalListPaths(input: { projectId: string; environment: string }): Promise<{ paths?: string[] }>
  fabricInfisicalListItems(input: { projectId: string; environment: string; secretPath: string }): Promise<{ items?: KeeperRawItem[] }>
  fabricInfisicalUpsertItem(input: {
    projectId: string
    environment: string
    secretPath: string
    key: string
    /** Plain object; the backend JSON-stringifies it before writing the secret. */
    valueJson: KeeperItemValue
  }): Promise<unknown>
  fabricInfisicalDeleteItem(input: {
    projectId: string
    environment: string
    secretPath: string
    key: string
  }): Promise<unknown>
}

const KEEPER_RPC_METHODS = [
  'fabricInfisicalListPaths',
  'fabricInfisicalListItems',
  'fabricInfisicalUpsertItem',
  'fabricInfisicalDeleteItem',
] as const

/** Resolve the keeper bridge off `window.electronAPI`; null = actions unavailable. */
export function resolveKeeperVaultRpc(api: unknown): KeeperVaultRpc | null {
  if (typeof api !== 'object' || api === null) return null
  const bag = api as Record<string, unknown>
  if (!KEEPER_RPC_METHODS.every((name) => typeof bag[name] === 'function')) return null
  return bag as unknown as KeeperVaultRpc
}

export interface KeeperItemsPaneProps {
  scope: KeeperScope
  rpc: KeeperVaultRpc
  /** Extra controls rendered in the spaces header (e.g. the surface's section switch). */
  actions?: ReactNode
}

type LoadStatus = 'loading' | 'ready' | 'error'

export function KeeperItemsPane({ scope, rpc, actions }: KeeperItemsPaneProps) {
  const { t } = useTranslation()

  const [paths, setPaths] = useState<string[]>([])
  const [treeStatus, setTreeStatus] = useState<LoadStatus>('loading')
  const [path, setPath] = useState<string>(KEEPER_SPACES[0].root)

  const [items, setItems] = useState<KeeperItem[]>([])
  const [itemsStatus, setItemsStatus] = useState<LoadStatus>('loading')

  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<KeeperDraft | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let alive = true
    setTreeStatus('loading')
    rpc
      .fabricInfisicalListPaths({ projectId: scope.projectId, environment: scope.environment })
      .then((result) => {
        if (!alive) return
        setPaths(Array.isArray(result?.paths) ? result.paths.filter((entry): entry is string => typeof entry === 'string') : [])
        setTreeStatus('ready')
      })
      .catch((error) => {
        if (!alive) return
        console.error('Failed to load vault paths:', error)
        setPaths([])
        setTreeStatus('error')
      })
    return () => {
      alive = false
    }
  }, [rpc, scope.projectId, scope.environment, reloadToken])

  useEffect(() => {
    let alive = true
    setItemsStatus('loading')
    rpc
      .fabricInfisicalListItems({ projectId: scope.projectId, environment: scope.environment, secretPath: path })
      .then((result) => {
        if (!alive) return
        const raw = Array.isArray(result?.items) ? result.items : []
        setItems(sortItems(raw.map((entry) => itemFromRaw(entry, path))))
        setItemsStatus('ready')
      })
      .catch((error) => {
        if (!alive) return
        console.error('Failed to load vault items:', error)
        setItems([])
        setItemsStatus('error')
      })
    return () => {
      alive = false
    }
  }, [rpc, scope.projectId, scope.environment, path, reloadToken])

  const tree = useMemo(() => buildSpaceTree(paths), [paths])
  const visibleItems = useMemo(() => filterItems(items, query), [items, query])
  const draftIssues = useMemo(
    () => (draft && attempted && !draft.raw ? validateForSave(draft, items.map((item) => item.key)) : []),
    [draft, attempted, items],
  )

  const selectSpace = useCallback((id: KeeperSpaceId) => {
    setPath(KEEPER_SPACES.find((space) => space.id === id)?.root ?? '/')
    setQuery('')
    setDraft(null)
    setAttempted(false)
    setActionError(null)
  }, [])

  const selectFolder = useCallback((folderPath: string) => {
    setPath(folderPath)
    setDraft(null)
    setAttempted(false)
    setActionError(null)
  }, [])

  const startNewItem = useCallback(() => {
    setDraft(emptyDraft(path))
    setAttempted(false)
    setActionError(null)
  }, [path])

  const selectItem = useCallback((item: KeeperItem) => {
    setDraft(draftFromItem(item))
    setAttempted(false)
    setActionError(null)
  }, [])

  const patchDraft = useCallback((patch: Partial<KeeperDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }, [])

  const save = useCallback(async () => {
    if (!draft || draft.raw) return
    setAttempted(true)
    const existingKeys = items.map((item) => item.key)
    if (validateForSave(draft, existingKeys).length > 0) return
    const value = valueFromDraft(draft)
    const key = draft.key ?? deriveItemKey(draft.title, existingKeys)
    setSaving(true)
    setActionError(null)
    try {
      await rpc.fabricInfisicalUpsertItem({
        projectId: scope.projectId,
        environment: scope.environment,
        secretPath: draft.path,
        key,
        valueJson: value,
      })
      setDraft({ ...draft, key })
      setReloadToken((token) => token + 1)
    } catch (error) {
      setActionError(`${t('extraScreens.keeper.error.save')} ${toErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }, [draft, items, rpc, scope.projectId, scope.environment, t])

  const remove = useCallback(async () => {
    if (!draft?.key) return
    const key = draft.key
    setDeleting(true)
    setActionError(null)
    try {
      await rpc.fabricInfisicalDeleteItem({
        projectId: scope.projectId,
        environment: scope.environment,
        secretPath: draft.path,
        key,
      })
      setDraft(null)
      setAttempted(false)
      setReloadToken((token) => token + 1)
    } catch (error) {
      setActionError(`${t('extraScreens.keeper.error.delete')} ${toErrorMessage(error)}`)
    } finally {
      setDeleting(false)
    }
  }, [draft, rpc, scope.projectId, scope.environment, t])

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  return (
    <ScreenRoot>
      <ScreenColumn width="clamp(200px, 22%, 260px)">
        <ScreenHeader
          title={t('extraScreens.keeper.spacesTitle')}
          actions={
            <>
              <ScreenButton variant="ghost" onClick={refresh}>
                {t('extraScreens.secrets.refresh')}
              </ScreenButton>
              {actions}
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {treeStatus === 'loading' && <div className="text-muted-foreground">{t('common.loading')}</div>}
          {treeStatus === 'error' && (
            <div className="text-destructive" role="alert">
              {t('extraScreens.keeper.error.loadPaths')}
            </div>
          )}
          {treeStatus === 'ready' &&
            tree.map((space) => (
              <div key={space.id} className="pt-1">
                <ListRow active={path === space.root} onClick={() => selectSpace(space.id)}>
                  <span className="min-w-0 flex-1 truncate font-semibold">{t(space.labelKey)}</span>
                </ListRow>
                {space.folders.map((folder) => (
                  <ListRow key={folder.path} active={path === folder.path} onClick={() => selectFolder(folder.path)}>
                    <span className="min-w-0 flex-1 truncate pl-3 text-muted-foreground">{folder.name}</span>
                  </ListRow>
                ))}
                {space.folders.length === 0 && (
                  <div className="px-2.5 pb-1 pl-5 text-small text-muted-foreground">
                    {t('extraScreens.keeper.empty.noFolders')}
                  </div>
                )}
              </div>
            ))}
        </div>
      </ScreenColumn>

      <ScreenColumn width="clamp(240px, 30%, 340px)">
        <ScreenHeader
          title={t('extraScreens.keeper.itemsTitle')}
          subtitle={itemsStatus === 'ready' ? <Counter>{visibleItems.length}</Counter> : undefined}
          actions={<ScreenButton onClick={startNewItem}>{t('extraScreens.keeper.newItem')}</ScreenButton>}
        />
        <div className="px-4 pb-2">
          <TextField value={query} onChange={setQuery} placeholder={t('extraScreens.keeper.searchPlaceholder')} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {itemsStatus === 'loading' && <div className="px-4 text-muted-foreground">{t('common.loading')}</div>}
          {itemsStatus === 'error' && (
            <div className="px-4 text-destructive" role="alert">
              {t('extraScreens.keeper.error.loadItems')}
            </div>
          )}
          {itemsStatus === 'ready' && items.length === 0 && (
            <div className="px-4">
              <SectionLabel>{t('extraScreens.keeper.empty.noItems')}</SectionLabel>
              <div className="text-small text-muted-foreground">{t('extraScreens.keeper.empty.noItemsHint')}</div>
            </div>
          )}
          {itemsStatus === 'ready' && items.length > 0 && visibleItems.length === 0 && (
            <div className="px-4 text-muted-foreground">{t('extraScreens.keeper.empty.noSearchResults')}</div>
          )}
          {visibleItems.map((item) => (
            <ListRow key={item.key} active={draft?.key === item.key} onClick={() => selectItem(item)}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.value.title || item.key}</span>
                {item.value.username && (
                  <span className="block truncate text-small text-muted-foreground">{item.value.username}</span>
                )}
              </span>
              <Chip tone={item.raw ? 'warn' : item.value.shared ? 'ok' : 'neutral'}>
                {t(item.raw ? 'extraScreens.keeper.rawBadge' : shareStateKey(item.value.shared))}
              </Chip>
            </ListRow>
          ))}
        </div>
      </ScreenColumn>

      <ScreenDetail className="overflow-x-hidden">
        {draft ? (
          <KeeperItemEditor
            draft={draft}
            issues={draftIssues}
            saving={saving}
            deleting={deleting}
            isNew={draft.key === null}
            error={actionError}
            onChange={patchDraft}
            onSave={() => void save()}
            onDelete={() => void remove()}
          />
        ) : (
          <EmptyState
            title={t('extraScreens.keeper.empty.noSelection')}
            body={t('extraScreens.keeper.empty.noSelectionHint')}
            action={<ScreenButton onClick={startNewItem}>{t('extraScreens.keeper.newItem')}</ScreenButton>}
          />
        )}
      </ScreenDetail>
    </ScreenRoot>
  )
}