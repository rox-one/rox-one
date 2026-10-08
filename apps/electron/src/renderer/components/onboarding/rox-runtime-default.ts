/**
 * First-run default runtime.
 *
 * Onboarding is a single name screen; there is no provider picker anymore.
 * Every new user lands on the Rox runtime (providerType 'omp') with the Rox
 * model catalog — the same connection the old «Rox — локальный агентный
 * рантайм» choice created. Other providers (ChatGPT/Codex, Claude, Copilot,
 * custom endpoints, Ollama) stay available in Settings → ИИ.
 *
 * Best effort by design: any failure here is logged and swallowed so the
 * name screen always leads straight into the app.
 */
import type { LlmConnectionSetup } from '../../../shared/types'
import type { StartupRuntimeSummary } from '@rox/shared/protocol'
import { toErrorMessage } from '@/lib/errors'

export const ROX_RUNTIME_PROVIDER = 'omp' as const
export const ROX_RUNTIME_CONNECTION_NAME = 'Rox'
export const ROX_RUNTIME_BASE_SLUG = 'omp'

type ConnectionSummary = { slug: string; providerType?: string; isDefault?: boolean }

export type RoxRuntimeDefaultApi<C extends ConnectionSummary = ConnectionSummary> = {
  getOrgIdentity?(): Promise<{ authority: 'native' | 'local' }>
  getStartupRuntimeSummary?(): Promise<StartupRuntimeSummary | null>
  listLlmConnectionsWithStatus(options?: { refresh?: boolean }): Promise<ReadonlyArray<C>>
  setupLlmConnection(setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }>
  setDefaultLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
}

export type RoxRuntimeDefaultResult = (
  | { status: 'already-default'; slug: string }
  | { status: 'preserved-default'; slug: string }
  | { status: 'set-default'; slug: string }
  | { status: 'created'; slug: string }
  | { status: 'failed'; error: string }
) & { runtimeSummary?: StartupRuntimeSummary }

function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Ensure new profiles have a Rox runtime without replacing an existing
 * user's selected provider.
 */
export type RoxRuntimeDefaultOptions<C extends ConnectionSummary = ConnectionSummary> = {
  /** Caller identity the caller just read; skips a duplicate getOrgIdentity(). */
  identity?: { authority: 'native' | 'local' }
  /** Passed to listLlmConnectionsWithStatus (startup uses `{ refresh: false }`). */
  listOptions?: { refresh?: boolean }
  /**
   * Receives the connection list when it was read and left unchanged
   * (already-default / preserved-default), so the caller can reuse it.
   */
  onConnectionsRead?: (connections: ReadonlyArray<C>) => void
}

export async function ensureRoxRuntimeDefault<C extends ConnectionSummary = ConnectionSummary>(
  api: RoxRuntimeDefaultApi<C>,
  options: RoxRuntimeDefaultOptions<C> = {},
): Promise<RoxRuntimeDefaultResult> {
  try {
    const identity = options.identity ?? (api.getOrgIdentity ? await api.getOrgIdentity() : null)
    if ((options.identity || api.getOrgIdentity) && (!identity || identity.authority !== 'native' && identity.authority !== 'local')) {
      return { status: 'failed', error: 'runtime-identity-unavailable' }
    }
    if (identity?.authority === 'native') {
      const summary = await api.getStartupRuntimeSummary?.()
      if (!summary || summary.kind !== 'configuration-only' || summary.isDefault !== true
        || typeof summary.slug !== 'string' || !summary.slug.trim() || summary.slug !== summary.slug.trim()
        || !['anthropic', 'pi', 'pi_compat', 'anthropic_compat', 'omp'].includes(summary.providerType)) {
        return { status: 'failed', error: 'runtime-configuration-unavailable' }
      }
      // Native onboarding observes configuration without requesting host
      // accounts, refreshing credentials, or changing the host's default.
      return { status: summary.providerType === ROX_RUNTIME_PROVIDER ? 'already-default' : 'preserved-default', slug: summary.slug, runtimeSummary: summary }
    }
    const connections = options.listOptions
      ? await api.listLlmConnectionsWithStatus(options.listOptions)
      : await api.listLlmConnectionsWithStatus()
    const current = connections.find((c) => c.isDefault)
    if (current?.providerType === ROX_RUNTIME_PROVIDER) {
      options.onConnectionsRead?.(connections)
      return { status: 'already-default', slug: current.slug }
    }
    if (current) {
      options.onConnectionsRead?.(connections)
      return { status: 'preserved-default', slug: current.slug }
    }


    const existing = connections.find((c) => c.providerType === ROX_RUNTIME_PROVIDER)
    if (existing) {
      const res = await api.setDefaultLlmConnection(existing.slug)
      return res.success
        ? { status: 'set-default', slug: existing.slug }
        : { status: 'failed', error: res.error ?? 'set-default-failed' }
    }

    const slug = uniqueSlug(ROX_RUNTIME_BASE_SLUG, new Set(connections.map((c) => c.slug)))
    const created = await api.setupLlmConnection({
      slug,
      name: ROX_RUNTIME_CONNECTION_NAME,
      providerType: ROX_RUNTIME_PROVIDER,
    })
    if (!created.success) return { status: 'failed', error: created.error ?? 'create-failed' }
    const res = await api.setDefaultLlmConnection(slug)
    return res.success
      ? { status: 'created', slug }
      : { status: 'failed', error: res.error ?? 'set-default-failed' }
  } catch (error) {
    return { status: 'failed', error: toErrorMessage(error) }
  }
}
