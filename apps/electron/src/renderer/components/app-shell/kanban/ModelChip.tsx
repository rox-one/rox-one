import { getModelDisplayName, getModelShortName, getModelProvider } from '@config/models'
import { collectionHarnessProvider } from '@craft-agent/shared/sessions/collection'
import { getProviderIcon } from '@/lib/provider-icons'
import { cn } from '@/lib/utils'

interface ModelChipProps {
  /** Model id, e.g. 'claude-opus-4-7'. */
  model: string
  /** LLM connection slug/name — used when the model id alone is ambiguous (kimi + oh-my-pi). */
  llmConnection?: string | null
  /** Show the short name ("Haiku") instead of the full display name ("Haiku 4.5"). */
  short?: boolean
  className?: string
}

/**
 * Read-only chip: real harness/provider icon + model name.
 * Unknown models stay unmarked rather than borrowing Anthropic's logo.
 */
export function ModelChip({ model, llmConnection, short = false, className }: ModelChipProps) {
  const harness = collectionHarnessProvider({ model, llmConnection })
  const registry = getModelProvider(model)
  const provider = harness ?? registry
  const iconUrl = provider
    ? (getProviderIcon(provider) ?? getProviderIcon('pi', null, provider))
    : null
  const label = short ? getModelShortName(model) : getModelDisplayName(model)

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
