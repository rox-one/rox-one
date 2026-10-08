import { getModelDisplayMetadata, getModelDisplayName, getModelShortName, getModelProvider } from '@config/models'
import { collectionHarnessProvider } from '@rox/shared/sessions/collection'
import { getProviderIcon } from '@/lib/provider-icons'
import { cn } from '@/lib/utils'

/** The display-safe part of an LLM connection used by a Kanban model badge. */
export interface ModelChipConnection {
  name: string
  providerType: string
  baseUrl?: string
  piAuthProvider?: string
}

interface ModelChipProps {
  /** Explicit model id, e.g. 'claude-opus-4-7'. Undefined means inherit. */
  model?: string | null
  /** LLM connection slug/name — used when the model id alone is ambiguous (kimi + oh-my-pi). */
  llmConnection?: string | null
  /**
   * The session's actual resolved connection. It takes precedence for the
   * provider mark, so a model routed through Pi/OpenAI is not drawn as Claude.
   */
  connection?: ModelChipConnection
  /** Show the short name ("Haiku") instead of the full display name ("Haiku 4.5"). */
  short?: boolean
  className?: string
}

/**
 * Read-only chip: real harness/provider icon + model name.
 * Public ROX endpoints are always branded Rox; otherwise the session's resolved
 * connection is the source of truth, then the harness the model id implies
 * (kimi + oh-my-pi → Rox), then known catalog metadata. Unknown models stay
 * unmarked rather than borrowing Anthropic's logo.
 */
export function ModelChip({ model, llmConnection, connection, short = false, className }: ModelChipProps) {
  const metadata = getModelDisplayMetadata(model)
  const harness = collectionHarnessProvider({ model, llmConnection })
  const provider = metadata?.provider === 'rox'
    ? 'rox'
    : connection?.providerType ?? harness ?? (model ? getModelProvider(model) : undefined)
  const iconUrl = provider
    ? (getProviderIcon(provider, connection?.baseUrl, connection?.piAuthProvider) ?? getProviderIcon('pi', null, provider))
    : null
  const label = model
    ? (metadata ? (short ? metadata.shortName : metadata.name) : (short ? getModelShortName(model) : getModelDisplayName(model)))
    : connection?.name || 'Rox agent'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        'bg-foreground/[0.04] text-foreground/70 ring-1 ring-foreground/[0.06]',
        className
      )}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="h-3 w-3 shrink-0 rounded-[2px]" aria-hidden />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" aria-hidden />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}
