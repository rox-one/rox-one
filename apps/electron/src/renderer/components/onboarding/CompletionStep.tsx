import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Spinner } from "@craft-agent/ui"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { StepFormLayout } from "./primitives"
import { isAccountRegistered, type FirstResultCheckpoint } from "@craft-agent/core/rox2"
import {
  createOfflineFirstResult,
  createStorageAdapter,
  FIRST_RESULT_STORAGE_KEY,
  readCheckpointFromStorage,
  retryFirstResultServices,
  skipFirstResultOnStore,
  type FirstResultPorts,
  type StorageLike,
} from "./first-result-ui"

export { FIRST_RESULT_STORAGE_KEY }

interface CompletionStepProps {
  status: 'saving' | 'complete'
  spaceName?: string
  onFinish: () => void
  storage?: StorageLike
  accountAuthenticated?: boolean
  ports?: FirstResultPorts
}

export function defaultFirstResultPorts(): FirstResultPorts {
  return {
    persistNote: async (note) => {
      const api = typeof window === "undefined" ? undefined : window.electronAPI
      const workspaces = await api?.getWorkspaces?.()
      const workspaceId = workspaces?.[0]?.id
      if (!workspaceId || !api?.createNote) return
      await api.createNote(workspaceId, note.title)
    },
    importNotes: async () => {
      const api = typeof window === "undefined" ? undefined : window.electronAPI
      if (!api?.knowledge?.migrateNotes) return
      // First-result never opens a folder picker. Missing import is skip, not a block.
    },
  }
}

/**
 * CompletionStep — success screen plus the first useful Note→Outcome→Task chain.
 * Local display name is never treated as account registration.
 * Import failure is shown with retry and does not hide Get Started.
 */
export function CompletionStep({
  status,
  spaceName,
  onFinish,
  storage,
  accountAuthenticated = false,
  ports,
}: CompletionStepProps) {
  const { t } = useTranslation()
  const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage)
  const [checkpoint, setCheckpoint] = useState<FirstResultCheckpoint>(() => readCheckpointFromStorage(store))
  const [busy, setBusy] = useState(false)

  const persist = (next: FirstResultCheckpoint) => {
    setCheckpoint(next)
  }

  const runCreate = async () => {
    if (!store || busy) return
    setBusy(true)
    try {
      persist(await createOfflineFirstResult(createStorageAdapter(store), store, {
        copy: {
          noteTitle: t("onboarding.completion.firstResultCreate"),
          noteBody: t("onboarding.completion.firstResultHint"),
          outcomeTitle: t("onboarding.completion.firstResultReady"),
          taskTitle: t("onboarding.completion.firstResultCreate"),
        },
        localProfileName: checkpoint.localProfileName,
        accountAuthenticated,
        ports: ports ?? defaultFirstResultPorts(),
      }))
    } finally {
      setBusy(false)
    }
  }

  const runRetry = async () => {
    if (!store || busy) return
    setBusy(true)
    try {
      persist(await retryFirstResultServices(createStorageAdapter(store), store, ports ?? defaultFirstResultPorts()))
    } finally {
      setBusy(false)
    }
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
                onClick={() => void runCreate()}
                className="w-full bg-background shadow-minimal text-foreground hover:bg-foreground/5 rounded-lg"
                size="lg"
                disabled={busy}
              >
                {t("onboarding.completion.firstResultCreate")}
              </Button>
            )}
            {!checkpoint.skipped && checkpoint.step !== 'complete' && (
              <Button
                variant="ghost"
                onClick={() => store && persist(skipFirstResultOnStore(createStorageAdapter(store)))}
                className="w-full"
                disabled={busy}
              >
                {t("onboarding.completion.firstResultSkip")}
              </Button>
            )}
            {checkpoint.error ? (
              <p role="status" className="text-xs text-destructive text-center">
                {t("knowledge.migrate.failed")}
              </p>
            ) : null}
            {checkpoint.error ? (
              <Button
                variant="ghost"
                onClick={() => void runRetry()}
                className="w-full"
                disabled={busy}
              >
                {t("common.retry")}
              </Button>
            ) : null}
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
