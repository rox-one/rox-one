import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  BROWSER_IMPORT_CATEGORIES,
  SYNC_PURPOSES,
  answerChoice,
  type AgentRule,
  type AgentRuleLabel,
  type BrowserImportCategory,
  type EnvironmentPrefs,
  type ModelPlacement,
  type QuestionId,
  type SttChoice,
  type SyncPurpose,
  type TtsChoice,
} from '@craft-agent/shared/environment'

const MODEL_KEYS: Record<ModelPlacement, { label: string; desc: string }> = {
  local: { label: 'onboarding.environment.modelLocal', desc: 'onboarding.environment.modelLocalDesc' },
  cloud: { label: 'onboarding.environment.modelCloud', desc: 'onboarding.environment.modelCloudDesc' },
  mixed: { label: 'onboarding.environment.modelMixed', desc: 'onboarding.environment.modelMixedDesc' },
}

const BROWSER_KEYS: Record<BrowserImportCategory, string> = {
  bookmarks: 'onboarding.environment.browserImportBookmarks',
  history: 'onboarding.environment.browserImportHistory',
  cookies: 'onboarding.environment.browserImportCookies',
  extensions: 'onboarding.environment.browserImportExtensions',
}

const SYNC_KEYS: Record<SyncPurpose, string> = {
  backup: 'onboarding.environment.syncBackup',
  devices: 'onboarding.environment.syncDevices',
  insights: 'onboarding.environment.syncInsights',
}

const RULE_KEYS: Record<AgentRuleLabel, string> = {
  must: 'onboarding.environment.agentRulesMust',
  forbid: 'onboarding.environment.agentRulesForbid',
  discretion: 'onboarding.environment.agentRulesDiscretion',
  custom: 'onboarding.environment.agentRulesCustom',
}

interface EnvironmentFieldsProps {
  prefs: EnvironmentPrefs
  onChange: (patch: Partial<EnvironmentPrefs>) => void
  pendingOnly?: boolean
  pendingQuestionIds?: QuestionId[]
}

function OptionButton({
  selected,
  label,
  description,
  onClick,
}: {
  selected: boolean
  label: string
  description?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
        selected ? 'border-accent bg-accent/10' : 'border-transparent bg-foreground-2 hover:bg-foreground/[0.02]',
      )}
    >
      <span className="font-medium">{label}</span>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
    </button>
  )
}

export function EnvironmentFields({
  prefs,
  onChange,
  pendingOnly = false,
  pendingQuestionIds = [],
}: EnvironmentFieldsProps) {
  const { t } = useTranslation()
  const pending = new Set(pendingQuestionIds)
  const show = (id: QuestionId) => !pendingOnly || pending.has(id)

  const toggleList = <T extends string>(
    current: T[] | null,
    item: T,
    patch: (next: T[]) => void,
  ) => {
    const next = new Set(current ?? [])
    if (next.has(item)) next.delete(item)
    else next.add(item)
    patch([...next] as T[])
  }

  return (
    <div className="space-y-5">
      {show('modelPlacement') && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.environment.modelPlacement')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.environment.modelPlacementDesc')}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('onboarding.environment.termLocal')}</span>
            {' — '}
            {t('onboarding.environment.termLocalExplain')}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('onboarding.environment.termCloud')}</span>
            {' — '}
            {t('onboarding.environment.termCloudExplain')}
          </p>
          {(['local', 'cloud', 'mixed'] as ModelPlacement[]).map((value) => (
            <OptionButton
              key={value}
              selected={prefs.modelPlacement.value === value}
              label={t(MODEL_KEYS[value].label)}
              description={t(MODEL_KEYS[value].desc)}
              onClick={() => onChange({ modelPlacement: answerChoice(value) })}
            />
          ))}
        </section>
      )}

      {show('sttTts') && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.environment.sttTts')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.environment.sttTtsDesc')}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('onboarding.environment.termStt')}</span>
            {' — '}
            {t('onboarding.environment.termSttExplain')}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('onboarding.environment.termTts')}</span>
            {' — '}
            {t('onboarding.environment.termTtsExplain')}
          </p>
          {(['local', 'cloud'] as SttChoice[]).map((value) => (
            <OptionButton
              key={`stt-${value}`}
              selected={prefs.sttEngine.value === value}
              label={t(value === 'local' ? 'onboarding.environment.sttLocal' : 'onboarding.environment.sttCloud')}
              onClick={() => onChange({ sttEngine: answerChoice(value) })}
            />
          ))}
          {(['edge', 'local'] as TtsChoice[]).map((value) => (
            <OptionButton
              key={`tts-${value}`}
              selected={prefs.ttsEngine.value === value}
              label={t(value === 'edge' ? 'onboarding.environment.ttsEdge' : 'onboarding.environment.ttsLocal')}
              onClick={() => onChange({ ttsEngine: answerChoice(value) })}
            />
          ))}
        </section>
      )}

      {show('wakeWord') && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.environment.wakeWord')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.environment.wakeWordDesc')}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('onboarding.environment.termWake')}</span>
            {' — '}
            {t('onboarding.environment.termWakeExplain')}
          </p>
          <OptionButton
            selected={prefs.wakeWord.value === true}
            label={t('onboarding.environment.wakeWordOn')}
            onClick={() => onChange({ wakeWord: answerChoice(true) })}
          />
          <OptionButton
            selected={prefs.wakeWord.value === false}
            label={t('onboarding.environment.wakeWordOff')}
            onClick={() => onChange({ wakeWord: answerChoice(false) })}
          />
        </section>
      )}

      {show('browserImport') && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.environment.browserImport')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.environment.browserImportDesc')}</p>
          {BROWSER_IMPORT_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(prefs.browserImport.value ?? []).includes(category)}
                onChange={() => toggleList<BrowserImportCategory>(
                  prefs.browserImport.value,
                  category,
                  (next) => onChange({ browserImport: answerChoice(next) }),
                )}
              />
              {t(BROWSER_KEYS[category])}
            </label>
          ))}
        </section>
      )}

      {show('syncPurposes') && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.environment.syncPurposes')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.environment.syncPurposesDesc')}</p>
          {SYNC_PURPOSES.map((purpose) => (
            <label key={purpose} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(prefs.syncPurposes.value ?? []).includes(purpose)}
                onChange={() => toggleList<SyncPurpose>(
                  prefs.syncPurposes.value,
                  purpose,
                  (next) => onChange({ syncPurposes: answerChoice(next) }),
                )}
              />
              {t(SYNC_KEYS[purpose])}
            </label>
          ))}
        </section>
      )}

      {show('notifications') && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.environment.notifications')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.environment.notificationsDesc')}</p>
          <OptionButton
            selected={prefs.notifications.value === true}
            label={t('onboarding.environment.notificationsOn')}
            onClick={() => onChange({ notifications: answerChoice(true) })}
          />
          <OptionButton
            selected={prefs.notifications.value === false}
            label={t('onboarding.environment.notificationsOff')}
            onClick={() => onChange({ notifications: answerChoice(false) })}
          />
        </section>
      )}

      {show('agentRules') && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.environment.agentRules')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.environment.agentRulesDesc')}</p>
          {prefs.agentRules.map((rule) => (
            <div key={rule.id} className="space-y-1 rounded-lg bg-foreground-2 p-2">
              <Label className="text-xs">{t(RULE_KEYS[rule.label])}</Label>
              <Input
                value={rule.text}
                onChange={(event) => {
                  const next = prefs.agentRules.map((item) => (
                    item.id === rule.id ? { ...item, text: event.target.value } : item
                  ))
                  onChange({ agentRules: next })
                }}
              />
              <div className="flex flex-wrap gap-1">
                {(Object.keys(RULE_KEYS) as AgentRuleLabel[]).map((label) => (
                  <OptionButton
                    key={label}
                    selected={rule.label === label}
                    label={t(RULE_KEYS[label])}
                    onClick={() => {
                      const next = prefs.agentRules.map((item) => (
                        item.id === rule.id ? { ...item, label } : item
                      ))
                      onChange({ agentRules: next })
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const rule: AgentRule = {
                id: `rule-${Date.now()}`,
                text: '',
                label: 'custom',
              }
              onChange({ agentRules: [...prefs.agentRules, rule] })
            }}
          >
            {t('onboarding.environment.agentRulesAdd')}
          </Button>
        </section>
      )}
    </div>
  )
}
