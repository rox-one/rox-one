import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { ArrowRight, Key, Monitor, Sparkles, Zap } from "lucide-react"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"

import claudeIcon from "@/assets/provider-icons/claude.svg"
import openaiIcon from "@/assets/provider-icons/openai.svg"
import copilotIcon from "@/assets/provider-icons/copilot.svg"

/**
 * The high-level provider choice the user makes on first launch.
 * This maps to one or more ApiSetupMethods downstream.
 */
export type ProviderChoice = 'rox' | 'claude' | 'chatgpt' | 'grok' | 'copilot' | 'api_key' | 'local'

interface ProviderOption {
  id: ProviderChoice
  name: string
  description: string
  icon: React.ReactNode
}

const PROVIDER_ICONS: Record<ProviderChoice, React.ReactNode> = {
  rox: <CraftAgentsSymbol className="size-5" />,
  claude: <img src={claudeIcon} alt="" className="size-5 rounded-[3px]" />,
  chatgpt: <img src={openaiIcon} alt="" className="size-5 rounded-[3px]" />,
  grok: <Zap className="size-5" />,
  copilot: <img src={copilotIcon} alt="" className="size-5 rounded-[3px]" />,
  api_key: <Key className="size-5" />,
  local: <Monitor className="size-5" />,
}

interface ProviderSelectStepProps {
  /** Called when the user selects a provider */
  onSelect: (choice: ProviderChoice) => void
  /** Called when the user chooses to skip setup */
  onSkip?: () => void
}

/**
 * ProviderSelectStep — model provider step after local identity setup.
 *
 * Rox is the recommended default. It maps to the existing internal runtime,
 * but that implementation detail is not exposed as a separate provider.
 */
export function ProviderSelectStep({ onSelect, onSkip }: ProviderSelectStepProps) {
  const { t } = useTranslation()

  const subscriptionOptions: ProviderOption[] = [
    {
      id: 'claude',
      name: t("onboarding.providerSelect.claudeProMax"),
      description: t("onboarding.providerSelect.claudeProMaxDesc"),
      icon: PROVIDER_ICONS.claude,
    },
    {
      id: 'chatgpt',
      name: t("onboarding.providerSelect.codexChatGPT"),
      description: t("onboarding.providerSelect.codexChatGPTDesc"),
      icon: PROVIDER_ICONS.chatgpt,
    },
    {
      id: 'grok',
      name: t("onboarding.providerSelect.grok"),
      description: t("onboarding.providerSelect.grokDesc"),
      icon: PROVIDER_ICONS.grok,
    },
    {
      id: 'copilot',
      name: t("onboarding.providerSelect.githubCopilot"),
      description: t("onboarding.providerSelect.githubCopilotDesc"),
      icon: PROVIDER_ICONS.copilot,
    },
  ]

  const advancedOptions: ProviderOption[] = [
    {
      id: 'api_key',
      name: t("onboarding.providerSelect.otherProvider"),
      description: t("onboarding.providerSelect.otherProviderDesc"),
      icon: PROVIDER_ICONS.api_key,
    },
    {
      id: 'local',
      name: t("onboarding.providerSelect.localModel"),
      description: t("onboarding.providerSelect.localModelDesc"),
      icon: PROVIDER_ICONS.local,
    },
  ]

  return (
    <StepFormLayout
      className="max-w-[31rem]"
      iconElement={
        <div className="relative flex size-16 items-center justify-center rounded-[22px] border border-accent/35 bg-accent/10 shadow-[0_0_40px_rgba(139,92,246,0.26)]">
          <CraftAgentsSymbol className="size-10 text-accent" />
          <Sparkles className="absolute -right-1 -top-1 size-4 text-accent" />
        </div>
      }
      title={t("onboarding.providerSelect.title")}
      description={t("onboarding.providerSelect.description")}
    >
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => onSelect('rox')}
          aria-label={t("onboarding.providerSelect.continueWithRox")}
          className={cn(
            "group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border p-4 text-left transition-all",
            "border-accent/45 bg-gradient-to-br from-accent/20 via-background/95 to-foreground-2",
            "shadow-[0_18px_52px_rgba(0,0,0,0.26),0_0_38px_rgba(139,92,246,0.18)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "hover:-translate-y-0.5 hover:border-accent/70 hover:shadow-[0_22px_62px_rgba(0,0,0,0.32),0_0_46px_rgba(139,92,246,0.26)]"
          )}
        >
          <span className="pointer-events-none absolute inset-x-10 -top-20 h-28 rounded-full bg-accent/20 blur-3xl transition-opacity group-hover:opacity-90" />
          <div className="relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-background shadow-[0_0_24px_rgba(139,92,246,0.36)]">
            {PROVIDER_ICONS.rox}
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-foreground">
                {t("onboarding.providerSelect.rox")}
              </span>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                {t("onboarding.providerSelect.recommended")}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("onboarding.providerSelect.roxDesc")}
            </p>
          </div>
          <ArrowRight className="relative size-5 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
        </button>

        <div className="space-y-2">
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("onboarding.providerSelect.existingSubscriptions")}
          </p>
          <div className="space-y-1.5">
            {subscriptionOptions.map((option) => (
              <ProviderRowButton
                key={option.id}
                option={option}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <p className="px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t("onboarding.providerSelect.secondaryActions")}
          </p>
          <div className="space-y-1.5">
            {advancedOptions.map((option) => (
              <ProviderRowButton
                key={option.id}
                option={option}
                onSelect={onSelect}
                compact={false}
              />
            ))}
          </div>
        </div>

        {onSkip && (
          <div className="text-center">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {t("onboarding.providerSelect.setupLater")}
            </button>
          </div>
        )}
      </div>
    </StepFormLayout>
  )
}

function ProviderRowButton({
  option,
  onSelect,
  compact = true,
}: {
  option: ProviderOption
  onSelect: (choice: ProviderChoice) => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.id)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border border-foreground/10 bg-background/50 text-left shadow-minimal transition-all",
        compact ? "px-3 py-2.5" : "px-3.5 py-3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "hover:border-foreground/15 hover:bg-foreground/[0.035]"
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {option.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {option.name}
        </span>
        <span className={cn("block text-xs text-muted-foreground", compact ? "truncate" : "leading-snug")}>
          {option.description}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/70" />
    </button>
  )
}
