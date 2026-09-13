import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { QuestId, QuestRecord } from '@craft-agent/shared/gamification'

const QUEST_TITLE: Record<QuestId, string> = {
  first_note: 'quests.firstNote',
  first_link: 'quests.firstLink',
  first_task: 'quests.firstTask',
  first_workflow: 'quests.firstWorkflow',
  first_browser: 'quests.firstBrowser',
  privacy_review: 'quests.privacyReview',
}

const QUEST_SERVICE: Record<QuestId, string> = {
  first_note: 'quests.service.notes',
  first_link: 'quests.service.notes',
  first_task: 'quests.service.tasks',
  first_workflow: 'quests.service.workflows',
  first_browser: 'quests.service.browser',
  privacy_review: 'quests.service.privacy',
}

interface QuestProgressCardProps {
  sessionId?: string | null
  cloudFeaturesEnabled?: boolean
}

export function QuestProgressCard({
  cloudFeaturesEnabled = true,
}: QuestProgressCardProps) {
  const { t } = useTranslation()
  const [quests, setQuests] = useState<QuestRecord[]>([])
  const [index, setIndex] = useState(0)

  const reload = useCallback(async () => {
    if (!window.electronAPI.getGamificationProfile) return
    const profile = await window.electronAPI.getGamificationProfile()
    setQuests(profile.quests ?? [])
    setIndex(0)
  }, [])

  useEffect(() => {
    void reload()
    const off = window.electronAPI.onGamificationChanged?.(() => {
      void reload()
    })
    return () => off?.()
  }, [reload])

  const act = useCallback(async (action: 'complete' | 'dismiss' | 'snooze', questId: QuestId) => {
    await window.electronAPI.applyGamificationQuest({
      action,
      questId,
      cloudFeaturesEnabled,
    })
    await reload()
  }, [cloudFeaturesEnabled, reload])

  if (quests.length === 0) return null

  const safeIndex = Math.min(index, quests.length - 1)
  const quest = quests[safeIndex]
  if (!quest) return null

  return (
    <div className="space-y-2 px-2 py-2" data-testid="quest-progress-card">
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={safeIndex <= 0}
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
        >
          {t('quests.previous')}
        </button>
        <span className="text-[10px] text-muted-foreground">
          {safeIndex + 1} / {quests.length}
        </span>
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          disabled={safeIndex >= quests.length - 1}
          onClick={() => setIndex((current) => Math.min(quests.length - 1, current + 1))}
        >
          {t('quests.next')}
        </button>
      </div>
      <div className="rounded-md bg-foreground/5 px-2 py-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t(QUEST_SERVICE[quest.id])}
        </p>
        <p className="text-xs font-medium">{t(QUEST_TITLE[quest.id])}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => void act('complete', quest.id)}
          >
            {t('quests.done')}
          </button>
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => void act('snooze', quest.id)}
          >
            {t('quests.snooze')}
          </button>
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => void act('dismiss', quest.id)}
          >
            {t('quests.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
