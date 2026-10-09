/**
 * Left column of the Keeper vault: folder scope chips, search, and the item
 * list (title + username only — secrets are never in this payload).
 */
import { useTranslation } from 'react-i18next'
import type { KeeperItemView, KeeperUnlockStatus, KeeperVaultSnapshot } from '../../../../shared/types'
import { Chip, EmptyState, ListRow, SectionLabel, TextField } from '../ui'
import { filterVaultItems, type VaultFilter } from './vault-model'

export function VaultPanel({
  snapshot,
  unlock,
  filter,
  selectedId,
  onFilterChange,
  onSelect,
  onImportBrowser,
  importing,
}: {
  snapshot: KeeperVaultSnapshot | null
  unlock: KeeperUnlockStatus | null
  filter: VaultFilter
  selectedId: string | null
  onFilterChange: (next: VaultFilter) => void
  onSelect: (item: KeeperItemView) => void
  onImportBrowser: () => void
  importing: boolean
}) {
  const { t } = useTranslation()

  if (!snapshot) {
    return <div className="px-4 text-muted-foreground">{t('common.loading')}</div>
  }
  if (unlock && !unlock.available) {
    return (
      <div className="px-4 text-small text-warning" role="status">
        {t('extraScreens.secrets.vault.locked')}
      </div>
    )
  }

  const visible = filterVaultItems(snapshot.items, filter)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-3">
      <div className="flex flex-wrap gap-1.5">
        <Chip active={filter.folder === null && !filter.favoritesOnly} onClick={() => onFilterChange({ ...filter, folder: null, favoritesOnly: false })}>
          {t('extraScreens.secrets.vault.folderAll')}
        </Chip>
        <Chip active={filter.favoritesOnly} onClick={() => onFilterChange({ ...filter, favoritesOnly: !filter.favoritesOnly })}>
          {t('extraScreens.secrets.vault.folderFavorites')}
        </Chip>
        {snapshot.folders.map((folder) => (
          <Chip
            key={folder.id}
            active={filter.folder === folder.name && !filter.favoritesOnly}
            onClick={() => onFilterChange({ ...filter, folder: folder.name, favoritesOnly: false })}
          >
            {folder.name}
          </Chip>
        ))}
      </div>

      <TextField
        value={filter.search}
        onChange={(search) => onFilterChange({ ...filter, search })}
        placeholder={t('extraScreens.secrets.vault.searchPlaceholder')}
      />

      <SectionLabel>{t('extraScreens.secrets.vault.itemsTitle', { n: visible.length })}</SectionLabel>

      {snapshot.items.length === 0 ? (
        <EmptyState
          title={t('extraScreens.secrets.vault.emptyTitle')}
          body={t('extraScreens.secrets.vault.emptyBody')}
        />
      ) : visible.length === 0 ? (
        <div className="text-small text-muted-foreground">{t('extraScreens.secrets.vault.noMatches')}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((item) => (
            <ListRow key={item.id} active={item.id === selectedId} onClick={() => onSelect(item)}>
              <span className="mt-0.5 w-4 shrink-0 text-center text-[13px]" aria-hidden>
                {item.favorite ? '★' : ''}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{item.title}</span>
                {item.username && <span className="block truncate text-[12px] text-muted-foreground">{item.username}</span>}
              </span>
              {item.totp && <span className="mt-0.5 shrink-0 font-mono text-[12px] text-accent">{item.totp.code}</span>}
            </ListRow>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onImportBrowser}
        disabled={importing}
        className="shrink-0 self-start text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
      >
        {importing ? t('extraScreens.secrets.vault.importing') : t('extraScreens.secrets.vault.importBrowser')}
      </button>
    </div>
  )
}