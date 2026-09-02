import { getModelDisplayMetadata, getModelDisplayName, getModelShortName } from '@config/models'
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
 * Read-only chip: provider brand icon + model name. Reuses the centralized
 * model registry (`@config/models`) and provider icon map so it can't drift
 * from the real model metadata.
 */
export function ModelChip({ model, connection, short = false, className }: ModelChipProps) {
  const modelId = model?.trim()
  const metadata = getModelDisplayMetadata(modelId)
  // Public ROX endpoints are always branded Rox. For all other models, the
  // configured session connection is the source of truth for the provider
  // icon; fall back only to known catalog metadata.
  const provider = metadata?.provider === 'rox'
    ? 'rox'
    : connection?.providerType ?? metadata?.provider ?? 'rox'
  const iconUrl = getProviderIcon(provider, connection?.baseUrl, connection?.piAuthProvider)
  const label = modelId
    ? (metadata ? (short ? metadata.shortName : metadata.name) : (short ? getModelShortName(modelId) : getModelDisplayName(modelId)))
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
