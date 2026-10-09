/**
 * Vault item detail pane. Secrets are shown only while a reveal grant is live
 * (the parent clears it after 30 s); copying re-fetches the value one-shot.
 */
import { useTranslation } from 'react-i18next'
import type { KeeperItemView } from '../../../../shared/types'
import { Card, Chip, ScreenButton, SectionLabel } from '../ui'
import { isExpired } from './vault-model'
import { TotpCountdown } from './TotpCountdown'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-2 py-1.5">
      <span className="pt-0.5 text-small text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-[13px]">{children}</span>
    </div>
  )
}

export function VaultItemDetail({
  item,
  revealedField,
  revealedValue,
  busy,
  onToggleReveal,
  onCopySecret,
  onCopyText,
  onEdit,
  onDelete,
  onToggleFavorite,
  onRefreshTotp,
}: {
  item: KeeperItemView
  revealedField: 'password' | 'totpSecret' | null
  revealedValue: string | null
  busy: boolean
  onToggleReveal: (field: 'password' | 'totpSecret') => void
  onCopySecret: (field: 'password' | 'totpSecret') => void
  onCopyText: (value: string) => void
  onEdit: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onRefreshTotp: () => void
}) {
  const { t } = useTranslation()
  const expired = isExpired(item.expiresAt, Date.now())

  return (
    <div className="min-w-0 max-w-[720px]">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 break-words text-[17px] font-bold">{item.title}</h2>
        <ScreenButton variant="ghost" onClick={onToggleFavorite} title={t('extraScreens.secrets.vault.favorite')}>
          {item.favorite ? '★' : '☆'}
        </ScreenButton>
        <ScreenButton onClick={onEdit}>{t('extraScreens.secrets.vault.edit')}</ScreenButton>
        <ScreenButton variant="danger" onClick={onDelete}>{t('extraScreens.secrets.vault.delete')}</ScreenButton>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Chip tone="neutral">{t(`extraScreens.secrets.vault.kind.${item.kind}`)}</Chip>
        {item.folders.map((folder) => (
          <Chip key={folder} tone="neutral">{folder}</Chip>
        ))}
        {expired && <Chip tone="err">{t('extraScreens.secrets.vault.expiredBadge')}</Chip>}
      </div>

      <Card>
        {item.username && (
          <Row label={t('extraScreens.secrets.vault.field.username')}>
            <span className="inline-flex items-center gap-2">
              <span className="font-mono">{item.username}</span>
              <ScreenButton variant="ghost" onClick={() => onCopyText(item.username!)}>{t('extraScreens.secrets.vault.copy')}</ScreenButton>
            </span>
          </Row>
        )}

        {item.hasPassword && (
          <Row label={t('extraScreens.secrets.vault.field.password')}>
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="font-mono">
                {revealedField === 'password' && revealedValue !== null ? revealedValue : '••••••••••'}
              </span>
              <ScreenButton
                variant="ghost"
                disabled={busy}
                onClick={() => onToggleReveal('password')}
              >
                {revealedField === 'password' ? t('extraScreens.secrets.vault.hide') : t('extraScreens.secrets.vault.reveal')}
              </ScreenButton>
              <ScreenButton variant="ghost" disabled={busy} onClick={() => onCopySecret('password')}>
                {t('extraScreens.secrets.vault.copy')}
              </ScreenButton>
            </span>
          </Row>
        )}

        {item.totp && (
          <Row label={t('extraScreens.secrets.vault.field.totp')}>
            <span className="flex flex-col gap-1">
              <TotpCountdown code={item.totp} onExpire={onRefreshTotp} />
              <span className="flex items-center gap-2">
                <ScreenButton variant="ghost" onClick={() => onCopyText(item.totp!.code)}>{t('extraScreens.secrets.vault.copyCode')}</ScreenButton>
                {item.hasTotpSecret && (
                  <ScreenButton variant="ghost" disabled={busy} onClick={() => onCopySecret('totpSecret')}>
                    {t('extraScreens.secrets.vault.copySecret')}
                  </ScreenButton>
                )}
              </span>
            </span>
          </Row>
        )}

        {item.url && (
          <Row label={t('extraScreens.secrets.vault.field.url')}>
            <span className="inline-flex items-center gap-2">
              <span className="min-w-0 break-all font-mono">{item.url}</span>
              <ScreenButton variant="ghost" onClick={() => onCopyText(item.url!)}>{t('extraScreens.secrets.vault.copy')}</ScreenButton>
            </span>
          </Row>
        )}

        {item.notes && (
          <Row label={t('extraScreens.secrets.vault.field.notes')}>
            <span className="whitespace-pre-wrap">{item.notes}</span>
          </Row>
        )}

        {item.tags.length > 0 && (
          <Row label={t('extraScreens.secrets.vault.field.tags')}>
            <span className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => <Chip key={tag} tone="neutral">{tag}</Chip>)}
            </span>
          </Row>
        )}

        {item.expiresAt !== undefined && (
          <Row label={t('extraScreens.secrets.vault.field.expiresAt')}>
            <span className={expired ? 'text-destructive' : undefined}>
              {new Date(item.expiresAt).toLocaleDateString()}
              {expired ? ` · ${t('extraScreens.secrets.vault.expiredBadge')}` : ''}
            </span>
          </Row>
        )}
      </Card>

      <SectionLabel>{t('extraScreens.secrets.vault.metaLabel')}</SectionLabel>
      <div className="text-small text-muted-foreground">
        {t('extraScreens.secrets.vault.metaUpdated', { date: new Date(item.updatedAt).toLocaleString() })}
      </div>
    </div>
  )
}