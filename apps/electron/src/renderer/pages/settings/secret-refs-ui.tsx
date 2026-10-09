/**
 * Human-facing vault states for the secretRef settings slice.
 * Keep this module free of `@/` UI imports so bun tests can render it. Raw
 * provider error codes live in `data-*` attributes only — never as visible text.
 */
import { useTranslation } from 'react-i18next'

export type SecretProviderStatus = 'connected' | 'disconnected'

export function secretProviderStatus(vaultAvailable: boolean): SecretProviderStatus {
  return vaultAvailable ? 'connected' : 'disconnected'
}

export function secretProviderStatusKey(status: SecretProviderStatus): string {
  return status === 'connected'
    ? 'settings.runtime.secretProviderConnected'
    : 'settings.runtime.secretProviderNotConnected'
}

/** A ref pinned to the vault provider while the vault is unreachable. */
export function secretRefRowShowsUnavailable(
  ref: { provider?: string },
  vaultAvailable: boolean,
): boolean {
  return ref.provider === 'infisical' && !vaultAvailable
}

/** Localized, value-free vault status line (no INFISICAL_* machine strings). */
export function SecretProviderStatusRow({ available }: { available: boolean }) {
  const { t } = useTranslation()
  const status = secretProviderStatus(available)
  return (
    <div
      data-provider-status={status}
      className={status === 'connected' ? 'text-xs text-success' : 'text-xs text-status-warning'}
    >
      {t(secretProviderStatusKey(status))}
    </div>
  )
}