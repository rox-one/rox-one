/**
 * Value-free Infisical unavailable row + helpers for the secretRef settings slice.
 * Keep this module free of `@/` UI imports so bun tests can render it.
 */
import { useTranslation } from 'react-i18next'

export function secretRefRowShowsUnavailable(
  ref: { provider?: string },
  infisicalAvailable: boolean,
): boolean {
  return ref.provider === 'infisical' && !infisicalAvailable
}

export function InfisicalUnavailableRow({
  available,
  errorCode,
}: {
  available: boolean
  errorCode?: string
}) {
  const { t } = useTranslation()
  if (available) return null
  return (
    <div
      data-error-code={errorCode ?? 'INFISICAL_UNAVAILABLE'}
      className="px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400"
    >
      {t('settings.runtime.secretInfisicalUnavailable')}
    </div>
  )
}
