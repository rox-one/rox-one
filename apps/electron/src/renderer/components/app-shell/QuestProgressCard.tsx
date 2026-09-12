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

interface QuestProgressCardProps {
  sessionId?: string | null
  cloudFeaturesEnabled?: boolean
}

export function QuestProgressCard({
  sessionId,
  cloudFeaturesEnabled = true,
}: QuestProgressCardProps) {
  const { t } = useTranslation()
  const [quests, setQuests] = useState<QuestRecord[]>([])
  const [score, setScore] = useState<1 | 2 | 3 | 4 | 5 | null>(null)

  const reload = useCallback(async () => {
    if (!window.electronAPI.getGamificationProfile) return
    const profile = await window.electronAPI.getGamificationProfile()
    setQuests(profile.quests ?? [])
    const existing = profile.ratings?.find((item) => item.sessionId === sessionId)
    setScore(existing?.score ?? null)
  }, [sessionId])

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

  if (quests.length === 0 && !sessionId) return null

  return (
    <div className="space-y-2 px-2 py-2" data-testid="quest-progress-card">
      {quests.map((quest) => (
        <div key={quest.id} className="rounded-md bg-foreground/5 px-2 py-1.5">
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
      ))}
      {sessionId ? (
        <div className="px-1">
          <p className="text-[10px] text-muted-foreground">{t('quests.rateSession')}</p>
          <div className="flex gap-1" aria-label={t('quests.rateSession')}>
            {([1, 2, 3, 4, 5] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={value === score ? 'text-xs font-semibold' : 'text-xs text-muted-foreground'}
                onClick={() => {
                  setScore(value)
                  void window.electronAPI.rateGamificationSession({
                    sessionId,
                    score: value,
                    provenance: 'session-sidebar',
                  })
                }}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
