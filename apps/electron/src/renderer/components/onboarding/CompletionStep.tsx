import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Spinner } from "@craft-agent/ui"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"
import {
  advanceFirstResult,
  emptyFirstResult,
  isAccountRegistered,
  parseFirstResultCheckpoint,
  seedOfflineFirstResult,
  skipFirstResult,
  type FirstResultCheckpoint,
} from "@craft-agent/core/rox2"

export const FIRST_RESULT_STORAGE_KEY = "rox.onboarding.first-result.v1"

interface CompletionStepProps {
  status: 'saving' | 'complete'
  spaceName?: string
  onFinish: () => void
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void }
}

function readCheckpoint(storage: CompletionStepProps["storage"]): FirstResultCheckpoint {
  try {
    const raw = storage?.getItem(FIRST_RESULT_STORAGE_KEY)
    return raw ? parseFirstResultCheckpoint(JSON.parse(raw)) : emptyFirstResult()
  } catch {
    return emptyFirstResult()
  }
}

/**
 * CompletionStep — success screen plus the first useful Note→Outcome→Task chain.
 * Local display name is never treated as account registration.
 */
export function CompletionStep({
  status,
  spaceName,
  onFinish,
  storage,
}: CompletionStepProps) {
  const { t } = useTranslation()
  const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage)
  const [checkpoint, setCheckpoint] = useState<FirstResultCheckpoint>(emptyFirstResult)

  useEffect(() => {
    setCheckpoint(readCheckpoint(store))
  }, [store])

  const persist = (next: FirstResultCheckpoint) => {
    setCheckpoint(next)
    store?.setItem(FIRST_RESULT_STORAGE_KEY, JSON.stringify(next))
  }

  const isSaving = status === 'saving'
  const firstResultReady = checkpoint.step === 'complete' && !checkpoint.skipped

  return (
    <StepFormLayout
      iconElement={isSaving ? (
        <div className="flex size-16 items-center justify-center">
          <Spinner className="text-2xl text-foreground" />
        </div>
      ) : (
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      )}
      title={isSaving ? t("onboarding.completion.settingUp") : t("onboarding.completion.allSet")}
      description={
        isSaving ? (
          t("onboarding.completion.savingConfig")
        ) : firstResultReady ? (
          t("onboarding.completion.firstResultReady")
        ) : (
          t("onboarding.completion.firstResultHint")
        )
      }
      actions={
        status === 'complete' ? (
          <div className="flex w-full max-w-[320px] flex-col gap-2">
            {!firstResultReady && !checkpoint.skipped && (
              <Button
                onClick={() => persist(advanceFirstResult(checkpoint, seedOfflineFirstResult()))}
                className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                size="lg"
              >
                {t("onboarding.completion.firstResultCreate")}
              </Button>
            )}
            {!checkpoint.skipped && checkpoint.step !== 'complete' && (
              <Button
                variant="ghost"
                onClick={() => persist(skipFirstResult(checkpoint))}
                className="w-full"
              >
                {t("onboarding.completion.firstResultSkip")}
              </Button>
            )}
            <p className="text-xs text-muted-foreground text-center">
              {isAccountRegistered(checkpoint)
                ? t("onboarding.completion.accountReady")
                : t("onboarding.completion.localProfileHint")}
              {spaceName ? ` · ${spaceName}` : ""}
            </p>
            <Button onClick={onFinish} className="w-full max-w-[320px] bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg" size="lg">
              {t("onboarding.welcome.getStarted")}
            </Button>
          </div>
        ) : undefined
      }
    />
  )
}
