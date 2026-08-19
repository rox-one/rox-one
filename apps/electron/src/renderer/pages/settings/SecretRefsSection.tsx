/**
 * Runtime settings: add/remove secretRef entries.
 * GET/SET talk refs only — resolved values never reach this renderer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@craft-agent/ui'
import { SettingsSection, SettingsCard } from '@/components/settings'
import type { SecretRefEntry, SecretRefsSettingsPayload } from '../../../shared/types'
import { InfisicalUnavailableRow, secretRefRowShowsUnavailable } from './secret-refs-ui'

const SECRET_PROVIDER_IDS = ['environment', 'local-encrypted', 'infisical'] as const
type SecretProviderId = (typeof SECRET_PROVIDER_IDS)[number]
type InfisicalAvailability = SecretRefsSettingsPayload['infisical']

type SecretRefDraft = {
  name: string
  envVar: string
  provider: SecretProviderId | ''
  ref: string
}

function toDraft(entry: SecretRefEntry): SecretRefDraft {
  return {
    name: entry.name,
    envVar: entry.envVar,
    provider: entry.provider ?? '',
    ref: entry.ref ?? '',
  }
}

function toEntry(draft: SecretRefDraft): SecretRefEntry | null {
  const name = draft.name.trim()
  const envVar = draft.envVar.trim()
  if (!name && !envVar) return null
  const entry: SecretRefEntry = { name, envVar }
  if (draft.provider) entry.provider = draft.provider
  const ref = draft.ref.trim()
  if (ref) entry.ref = ref
  return entry
}

function codedErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return undefined
}

function deniedEnvVarFromMessage(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error)
  const match = message.match(/secret ref envVar not allowed:\s*(\S+)/)
  return match?.[1]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SecretRefsSection({ onError }: { onError?: (message: string | null) => void }) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<SecretRefDraft[] | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [infisical, setInfisical] = useState<InfisicalAvailability | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    window.electronAPI
      .getSecretRefs()
      .then((payload) => {
        const next = payload.refs.map(toDraft)
        setDrafts(next)
        setSavedSnapshot(JSON.stringify(next))
        setInfisical(payload.infisical)
      })
      .catch((error) => {
        console.error('Failed to load secret refs:', error)
        onError?.(errorMessage(error))
        setDrafts([])
        setSavedSnapshot(JSON.stringify([]))
      })
  }, [onError])

  const dirty = useMemo(() => {
    if (drafts === null || savedSnapshot === null) return false
    return JSON.stringify(drafts) !== savedSnapshot
  }, [drafts, savedSnapshot])

  const updateDraft = useCallback((index: number, patch: Partial<SecretRefDraft>) => {
    setDrafts((rows) => rows?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? rows)
  }, [])

  const removeDraft = useCallback((index: number) => {
    setDrafts((rows) => rows?.filter((_, i) => i !== index) ?? rows)
  }, [])

  const addDraft = useCallback(() => {
    setDrafts((rows) => [...(rows ?? []), { name: '', envVar: '', provider: '', ref: '' }])
  }, [])

  const save = useCallback(async () => {
    if (!drafts || !dirty) return
    setSaving(true)
    onError?.(null)
    setSavedFlash(false)
    try {
      const refs: SecretRefEntry[] = []
      const normalized: SecretRefDraft[] = []
      for (const draft of drafts) {
        const entry = toEntry(draft)
        if (!entry) continue
        refs.push(entry)
        normalized.push(toDraft(entry))
      }
      await window.electronAPI.setSecretRefs(refs)
      setDrafts(normalized)
      setSavedSnapshot(JSON.stringify(normalized))
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2000)
    } catch (error) {
      console.error('Failed to save secret refs:', error)
      const code = codedErrorCode(error)
      if (code === 'SECRET_ENVVAR_DENIED') {
        onError?.(
          t('settings.runtime.secretDenied', {
            envVar: deniedEnvVarFromMessage(error) ?? '',
            code,
          }),
        )
      } else {
        onError?.(errorMessage(error))
      }
    } finally {
      setSaving(false)
    }
  }, [drafts, dirty, onError, t])

  const infisicalAvailable = infisical?.available !== false

  return (
    <SettingsSection
      title={t('settings.runtime.secretTitle')}
      description={t('settings.runtime.secretDesc')}
    >
      <SettingsCard divided={false}>
        {infisical && (
          <InfisicalUnavailableRow available={infisical.available} errorCode={infisical.errorCode} />
        )}
        <div className="p-3 space-y-2">
          {drafts === null ? (
            <div className="flex justify-center py-4">
              <Spinner className="w-4 h-4" />
            </div>
          ) : (
            <>
              {drafts.map((draft, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Input
                      value={draft.name}
                      onChange={(e) => updateDraft(index, { name: e.target.value })}
                      placeholder={t('settings.runtime.secretNamePlaceholder')}
                      spellCheck={false}
                      className="font-mono text-xs flex-1"
                    />
                    <Input
                      value={draft.envVar}
                      onChange={(e) => updateDraft(index, { envVar: e.target.value })}
                      placeholder={t('settings.runtime.secretEnvVarPlaceholder')}
                      spellCheck={false}
                      className="font-mono text-xs flex-1"
                    />
                    <select
                      value={draft.provider}
                      onChange={(e) => updateDraft(index, { provider: e.target.value as SecretProviderId | '' })}
                      aria-label={t('settings.runtime.secretProvider')}
                      className="h-8 rounded-md border border-foreground/15 bg-background px-2 font-mono text-xs"
                    >
                      <option value="">{t('settings.runtime.secretProviderAny')}</option>
                      {SECRET_PROVIDER_IDS.map((id) => (
                        <option key={id} value={id}>
                          {id === 'environment'
                            ? t('settings.runtime.secretProviderEnvironment')
                            : id === 'local-encrypted'
                              ? t('settings.runtime.secretProviderLocal')
                              : t('settings.runtime.secretProviderInfisical')}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={draft.ref}
                      onChange={(e) => updateDraft(index, { ref: e.target.value })}
                      placeholder={t('settings.runtime.secretRefPlaceholder')}
                      spellCheck={false}
                      className="font-mono text-xs flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDraft(index)}
                      aria-label={t('settings.runtime.secretRemove')}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                  {secretRefRowShowsUnavailable(draft, infisicalAvailable) && (
                    <InfisicalUnavailableRow available={false} errorCode="INFISICAL_UNAVAILABLE" />
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 gap-2">
                <Button variant="ghost" size="sm" onClick={addDraft}>
                  <Plus className="w-3 h-3 mr-1" />
                  {t('settings.runtime.secretAdd')}
                </Button>
                <div className="flex items-center gap-2">
                  {savedFlash ? (
                    <span className="text-xs text-muted-foreground">{t('settings.runtime.secretSaved')}</span>
                  ) : null}
                  <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
                    {saving ? <Spinner className="w-3 h-3" /> : t('settings.runtime.secretSave')}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-1">{t('settings.runtime.secretNextSession')}</p>
            </>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
