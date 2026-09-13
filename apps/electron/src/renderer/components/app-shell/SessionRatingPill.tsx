import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SESSION_RATING_PILLS } from '@craft-agent/shared/gamification'

interface SessionRatingPillProps {
  sessionId: string
}

export function SessionRatingPill({ sessionId }: SessionRatingPillProps) {
  const { t } = useTranslation()
  const [score, setScore] = useState<number | null>(null)

  const reload = useCallback(async () => {
    if (!window.electronAPI.getGamificationProfile) return
    const profile = await window.electronAPI.getGamificationProfile()
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

  return (
    <div
      className="flex flex-wrap items-center gap-1 px-1 pb-1"
      data-testid="session-rating-pill"
      aria-label={t('quests.rateSession')}
    >
      <span className="text-[10px] text-muted-foreground">{t('quests.rateSession')}</span>
      {SESSION_RATING_PILLS.map((value) => {
        const filled = score != null && score >= value
        return (
          <button
            key={value}
            type="button"
            title={t('quests.rateOf', { score: value })}
            className={
              filled
                ? 'h-5 min-w-5 rounded-full bg-foreground/80 px-1.5 text-[10px] font-medium text-background'
                : 'h-5 min-w-5 rounded-full bg-foreground/10 px-1.5 text-[10px] text-muted-foreground hover:bg-foreground/20'
            }
            onClick={() => {
              setScore(value)
              void window.electronAPI.rateGamificationSession({
                sessionId,
                score: value,
                provenance: 'session-composer',
              })
            }}
          >
            {value}
          </button>
        )
      })}
    </div>
  )
}
