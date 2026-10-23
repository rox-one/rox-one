import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, SmilePlus, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  NOTES_COVER_PRESETS,
  NOTES_ICON_PRESETS,
  readNoteCover,
  readNoteIcon,
} from './note-library'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function NoteFavoriteButton({
  pinned,
  onToggle,
  className,
}: {
  pinned: boolean
  onToggle(): void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={cn('grid size-7 place-items-center rounded-md hover:bg-surface-hover', className)}
      aria-pressed={pinned}
      aria-label={t(pinned ? 'screens.notes.unpin' : 'screens.notes.pin')}
      data-testid="notes-favorite-toggle"
      onClick={onToggle}
    >
      <Star className={cn('icon-caption', pinned && 'fill-current text-status-warning')} aria-hidden />
    </button>
  )
}

export function NoteCoverIconChrome({
  properties,
  onChange,
  disabled,
}: {
  properties: Record<string, unknown>
  onChange(patch: { cover?: string | null; icon?: string | null }): void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const cover = readNoteCover(properties)
  const icon = readNoteIcon(properties)
  const [coverDraft, setCoverDraft] = React.useState('')
  const [iconDraft, setIconDraft] = React.useState('')
  const [coverError, setCoverError] = React.useState(false)
  const [iconError, setIconError] = React.useState(false)

  React.useEffect(() => {
    setCoverDraft(typeof properties.cover === 'string' ? properties.cover : '')
    setIconDraft(typeof properties.icon === 'string' ? properties.icon : '')
    setCoverError(false)
    setIconError(false)
  }, [properties.cover, properties.icon])

  const coverStyle: React.CSSProperties | undefined = (() => {
    if (!cover) return undefined
    const lower = cover.toLowerCase()
    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:image')) {
      return {
        backgroundImage: `url(${JSON.stringify(cover)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    if (cover.startsWith('#')) return { backgroundColor: cover }
    // Gradients and other CSS background-image values.
    return { backgroundImage: cover }
  })()

  return (
    <div className="mx-auto mb-4 w-full max-w-[70ch]" data-testid="notes-library-chrome">
      <div
        className={cn(
          'relative mb-3 overflow-hidden rounded-[var(--radius-control)] border border-border/40',
          cover ? 'h-28' : 'h-10 border-dashed',
        )}
        style={coverStyle}
        data-testid="notes-cover"
      >
        {!cover ? (
          <div className="flex h-full items-center justify-center text-caption text-muted-foreground">
            {t('notes.library.coverEmpty')}
          </div>
        ) : null}
        <div className="absolute inset-x-0 bottom-1 flex justify-end gap-1 px-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="secondary" className="h-7 gap-1 px-2 text-caption" disabled={disabled} data-testid="notes-cover-picker">
                <ImagePlus className="icon-caption" aria-hidden />
                {t('notes.library.cover')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-2">
              <p className="text-caption text-muted-foreground">{t('notes.library.coverHint')}</p>
              <div className="grid grid-cols-2 gap-2">
                {NOTES_COVER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="h-10 rounded-md border border-border/50"
                    style={{ backgroundImage: preset.value }}
                    aria-label={t(`notes.library.coverPreset.${preset.id}`)}
                    onClick={() => onChange({ cover: preset.value })}
                  />
                ))}
              </div>
              <Input
                value={coverDraft}
                onChange={(event) => {
                  setCoverDraft(event.target.value)
                  setCoverError(false)
                }}
                placeholder={t('notes.library.coverUrlPlaceholder')}
                data-testid="notes-cover-url"
                aria-invalid={coverError || undefined}
              />
              {(coverError || (coverDraft.trim() !== '' && !readNoteCover({ cover: coverDraft.trim() }))) ? (
                <p className="text-caption text-destructive" data-testid="notes-cover-invalid" role="alert">
                  {t('notes.library.coverInvalid')}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => { setCoverError(false); onChange({ cover: null }) }}>{t('notes.library.clear')}</Button>
                <Button
                  type="button"
                  size="sm"
                  data-testid="notes-cover-apply"
                  onClick={() => {
                    const trimmed = coverDraft.trim()
                    if (!trimmed) {
                      setCoverError(false)
                      onChange({ cover: null })
                      return
                    }
                    const safe = readNoteCover({ cover: trimmed })
                    if (!safe) {
                      setCoverError(true)
                      return
                    }
                    setCoverError(false)
                    onChange({ cover: safe })
                  }}
                >
                  {t('notes.library.apply')}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="grid size-12 place-items-center rounded-[var(--radius-control)] border border-border/50 bg-surface-hover/40 text-title hover:bg-surface-hover"
              aria-label={t('notes.library.icon')}
              data-testid="notes-icon-picker"
              disabled={disabled}
            >
              {icon ?? <SmilePlus className="icon-toolbar text-muted-foreground" aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-2">
            <div className="grid grid-cols-6 gap-1">
              {NOTES_ICON_PRESETS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="grid size-8 place-items-center rounded-md hover:bg-surface-hover"
                  onClick={() => onChange({ icon: emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <Input
              value={iconDraft}
              onChange={(event) => {
                setIconDraft(event.target.value)
                setIconError(false)
              }}
              maxLength={32}
              placeholder={t('notes.library.iconPlaceholder')}
              data-testid="notes-icon-input"
              aria-invalid={iconError || undefined}
            />
            {(iconError || (iconDraft.trim() !== '' && !readNoteIcon({ icon: iconDraft.trim() }))) ? (
              <p className="text-caption text-destructive" data-testid="notes-icon-invalid" role="alert">
                {t('notes.library.iconInvalid')}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => { setIconError(false); onChange({ icon: null }) }}>
                <X className="icon-caption" aria-hidden />
                {t('notes.library.clear')}
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="notes-icon-apply"
                onClick={() => {
                  const trimmed = iconDraft.trim()
                  if (!trimmed) {
                    setIconError(false)
                    onChange({ icon: null })
                    return
                  }
                  const safe = readNoteIcon({ icon: trimmed })
                  if (!safe) {
                    setIconError(true)
                    return
                  }
                  setIconError(false)
                  onChange({ icon: safe })
                }}
              >
                {t('notes.library.apply')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <p className="text-caption text-muted-foreground">{t('notes.library.iconHint')}</p>
      </div>
    </div>
  )
}
