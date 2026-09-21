import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
        const selected = score === value
        return (
          <button
            key={value}
            type="button"
            title={t('quests.rateOf', { score: value })}
            aria-pressed={selected}
            className={
              selected
                ? 'h-5 min-w-5 rounded-full bg-foreground px-1.5 text-[10px] font-medium text-background'
                : 'h-5 min-w-5 rounded-full border border-border/50 bg-background px-1.5 text-[10px] text-foreground/80'
            }
            onClick={async () => {
              const previous = score
              setScore(value)
              const rate = window.electronAPI.rateGamificationSession
              if (!rate) return
              try {
                await rate({
                  sessionId,
                  score: value,
                  provenance: 'session-composer',
                })
                toast.success(t('quests.rateOf', { score: value }))
              } catch {
                toast.error(t('common.failed'))
                setScore(previous)
              }
            }}
          >
            {value}
          </button>
        )
      })}
    </div>
  )
}
