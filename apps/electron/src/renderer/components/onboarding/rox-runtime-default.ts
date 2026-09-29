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

export const ROX_RUNTIME_PROVIDER = 'omp' as const
export const ROX_RUNTIME_CONNECTION_NAME = 'Rox'
export const ROX_RUNTIME_BASE_SLUG = 'omp'

type ConnectionSummary = { slug: string; providerType?: string; isDefault?: boolean }

export type RoxRuntimeDefaultApi = {
  listLlmConnectionsWithStatus(): Promise<ReadonlyArray<ConnectionSummary>>
  setupLlmConnection(setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }>
  setDefaultLlmConnection(slug: string): Promise<{ success: boolean; error?: string }>
}

export type RoxRuntimeDefaultResult =
  | { status: 'already-default'; slug: string }
  | { status: 'set-default'; slug: string }
  | { status: 'created'; slug: string }
  | { status: 'failed'; error: string }

function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Make sure the global default LLM connection is a Rox runtime connection.
 * Reuses the seeded Rox connection when present; otherwise creates one.
 */
export async function ensureRoxRuntimeDefault(api: RoxRuntimeDefaultApi): Promise<RoxRuntimeDefaultResult> {
  try {
    const connections = await api.listLlmConnectionsWithStatus()
    const current = connections.find((c) => c.isDefault)
    if (current?.providerType === ROX_RUNTIME_PROVIDER) {
      return { status: 'already-default', slug: current.slug }
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
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}
