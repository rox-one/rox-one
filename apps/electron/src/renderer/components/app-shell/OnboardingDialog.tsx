/**
 * Y4: first-run memory onboarding.
 *
 * Shown once ever: when the memory stores hold zero lessons (global +
 * workspace) and the server-side marker ({configDir}/memory/.onboarded) is
 * absent. Offers pre-translated seed lessons (global scope, prefilled
 * categories) so a fresh install starts with a working memory instead of an
 * empty panel. Any close path — Skip, backdrop, Esc — stamps the marker,
 * best-effort: a read-only config dir degrades to "dialog may reappear once"
 * rather than an error.
 *
 * The flow stays optional: the user can skip, edit default rules, change each
 * rule type, or add custom labels before anything is persisted.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  collectOnboardingLessonInputs,
  makeBlankOnboardingDraft,
  makeOnboardingSeedDrafts,
  onboardingAddLessonErrorDescription,
  ONBOARDING_RULE_TYPE_LABEL_KEYS,
  ONBOARDING_RULE_TYPES,
  type OnboardingRuleDraft,
  type OnboardingRuleType,
} from './onboarding-rule-model'

export interface OnboardingDialogProps {
  workspaceId?: string
  presentationAllowed?: boolean
}

export function OnboardingDialog({ workspaceId, presentationAllowed = true }: OnboardingDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [drafts, setDrafts] = React.useState<OnboardingRuleDraft[]>(() => [
    ...makeOnboardingSeedDrafts(t),
    makeBlankOnboardingDraft(),
  ])
  const nextCustomId = React.useRef(1)
  // Re-entrancy guard: the marker write is idempotent, but a second toast
  // burst or double-close should never fire twice.
  const finishingRef = React.useRef(false)
  const lessonInputs = React.useMemo(() => collectOnboardingLessonInputs(drafts), [drafts])

  React.useEffect(() => {
    if (!presentationAllowed) return
    let cancelled = false
    window.electronAPI
      .listInsights(workspaceId)
      .then((insights) => {
        if (!cancelled && !insights.onboarded && insights.totalLessons === 0) setOpen(true)
      })
      .catch(() => {
        // Insights read is best-effort: offline/remote failures skip onboarding.
      })
    return () => { cancelled = true }
  }, [workspaceId, presentationAllowed])

  const stampOnboarded = React.useCallback(() => {
    try {
      const result = window.electronAPI.markMemoryOnboarded?.()
      void result?.catch(() => {})
    } catch {
      // Offline close must not throw — the marker re-check next launch retries.
    }
  }, [])

  const finish = React.useCallback(() => {
    if (finishingRef.current) return
    finishingRef.current = true
    stampOnboarded()
    setOpen(false)
  }, [stampOnboarded])

  const handleAdd = async () => {
    if (lessonInputs.length === 0) return
    setBusy(true)
    try {
      for (const input of lessonInputs) {
        await window.electronAPI.addMemoryLesson(null, input)
      }
      toast.success(t('memory.lessonAdded'))
      setBusy(false)
      finish()
    } catch (err) {
      toast.error(t('memory.lessonAddFailed'), {
        description: onboardingAddLessonErrorDescription(err, t),
      })
      setBusy(false)
    }
  }

  const updateDraft = (id: string, patch: Partial<OnboardingRuleDraft>) => {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== id) return draft
        const next = { ...draft, ...patch }
        if (patch.text !== undefined && patch.text.trim().length > 0) next.selected = true
        return next
      }),
    )
  }

  const addCustomDraft = () => {
    const id = `custom-${nextCustomId.current++}`
    setDrafts((prev) => [...prev, makeBlankOnboardingDraft(id)])
  }

  return (
    <Dialog open={open && presentationAllowed} onOpenChange={(next) => { if (!next && presentationAllowed && !busy) finish() }}>
      <DialogContent className="sm:max-w-2xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('memory.onboardingTitle')}</DialogTitle>
          <DialogDescription>{t('memory.onboardingBody')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="rounded-[var(--radius-control)] border border-foreground/10 bg-foreground/[0.025] p-3 shadow-minimal"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-2"
                    checked={draft.selected}
                    disabled={busy}
                    onChange={(e) => updateDraft(draft.id, { selected: e.target.checked })}
                  />
                  <Textarea
                    value={draft.text}
                    disabled={busy}
                    placeholder={t('memory.rulePlaceholder')}
                    className="min-h-[4.5rem] resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0"
                    onChange={(e) => updateDraft(draft.id, { text: e.target.value })}
                  />
                </label>
                <div className="space-y-2">
                  <Select
                    value={draft.type}
                    disabled={busy}
                    onValueChange={(value) => updateDraft(draft.id, { type: value as OnboardingRuleType })}
                  >
                    <SelectTrigger className="h-8 bg-background/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ONBOARDING_RULE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(ONBOARDING_RULE_TYPE_LABEL_KEYS[type])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {draft.type === 'custom' && (
                    <Input
                      value={draft.customLabel}
                      disabled={busy}
                      placeholder={t('memory.onboardingCustomLabelPlaceholder')}
                      className="h-8 bg-background/40"
                      onChange={(e) => updateDraft(draft.id, { customLabel: e.target.value })}
                    />
                  )}
                </div>
              </div>
              {draft.type === 'forbidden' && (
                <div className="mt-2 flex justify-end">
                  <span className="shrink-0 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                    {t('memory.negativeBadge')}
                  </span>
                </div>
              )}
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={addCustomDraft}>
            {t('memory.onboardingAddAnother')}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={finish}>
            {t('memory.onboardingSkip')}
          </Button>
          <Button disabled={busy || lessonInputs.length === 0} onClick={() => void handleAdd()}>
            {t('memory.onboardingAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
