/**
 * Theme layers studio (Settings → Внешний вид).
 *
 * Live mini-shell preview, per-layer colors with derived shades, gradient
 * editor for the frame and wallpaper, accent, one glass slider, the content
 * join mode, WCAG checks with «Исправить», `.rox-theme.json` export/import and
 * «Сохранить как пресет». Every edit is persisted to theme.json through
 * `setAppLayers` (debounced) and applied app-wide by ThemeContext.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import {
  buildRoxThemeFile,
  checkLayerContrast,
  CONTENT_RADIUS_DEFAULT,
  deriveShades,
  fixLayerContrast,
  frameAlphaForGlass,
  gradientToCSS,
  resolveContrastInputs,
  RoxThemeFileSchema,
  themeSlug,
  wallpaperToCSS,
  type ContentJoinMode,
  type ContrastPairId,
  type GradientStop,
  type ThemeFile,
  type ThemeGradient,
  type ThemeLayers,
  type ThemeOverrides,
  type WallpaperLayer,
} from '@rox/shared/config'
import { SettingsSection, SettingsCard, SettingsRow, SettingsSegmentedControl } from '@/components/settings'
import { ColorPicker } from '@/components/ui/color-picker'
import { Button } from '@/components/ui/button'
import { useTheme, useAppTheme } from '@/context/ThemeContext'

const APPLY_DEBOUNCE_MS = 180
const MAX_STOPS = 5

/** Starting point for a theme without layers: read them off the palette. */
export function seedLayersFromPalette(theme: ThemeOverrides, isDark: boolean): ThemeLayers {
  const colors = isDark && theme.dark ? { ...theme, ...theme.dark } : theme
  const hex = (value: string | undefined, fallback: string) => (value && /^#[\da-f]{6}$/i.test(value) ? value : fallback)
  const content = hex(colors.background, isDark ? '#17181b' : '#f7f7f5')
  return {
    frame: { bg: hex(colors.navigator, isDark ? '#111215' : '#ececea') },
    content: { bg: content, fg: hex(colors.foreground, isDark ? '#ededeb' : '#262624'), join: 'line' },
    elevation: { 1: hex(colors.paper, content), 2: hex(colors.popover, content) },
    accent: hex(colors.accent, '#38bdf8'),
  }
}

function hexOr(value: string | undefined, fallback: string): string {
  return value && /^#[\da-f]{6}$/i.test(value) ? value : fallback
}

// ---------------------------------------------------------------------------
// Live mini-shell preview
// ---------------------------------------------------------------------------

export function ThemeMiniShellPreview({ layers, testId = 'theme-layers-preview' }: { layers: ThemeLayers; testId?: string }) {
  const frameBg = layers.frame?.bg ?? '#101418'
  const shades = deriveShades(frameBg)
  const frameFg = layers.frame?.fg ?? shades?.fg ?? '#eef1f4'
  const frameMuted = layers.frame?.muted ?? shades?.muted ?? '#848c98'
  const frameBorder = layers.frame?.border ?? shades?.border ?? 'rgba(255,255,255,.08)'
  const contentBg = layers.content?.bg ?? '#15171b'
  const contentFg = layers.content?.fg ?? '#eef1f4'
  const card = layers.elevation?.[1] ?? contentBg
  const accent = layers.accent ?? '#38bdf8'
  const join: ContentJoinMode = layers.content?.join ?? 'line'
  const radius = join === 'float' ? (layers.content?.radius ?? CONTENT_RADIUS_DEFAULT) : 0
  const glass = layers.wallpaper ? (layers.glass ?? 0) : 0
  const alpha = Math.round(frameAlphaForGlass(glass) * 100)
  const frameFill = `color-mix(in oklch, ${frameBg} ${alpha}%, transparent)`
  const frameImage = layers.frame?.gradient ? `, ${gradientToCSS(layers.frame.gradient)}` : ''
  const style = {
    '--pv-wall': layers.wallpaper ? wallpaperToCSS(layers.wallpaper) : frameBg,
    '--pv-frame': `linear-gradient(${frameFill}, ${frameFill})${frameImage}`,
    '--pv-frame-fg': frameFg,
    '--pv-frame-muted': frameMuted,
    '--pv-frame-border': frameBorder,
    '--pv-blur': `${Math.round(glass * 40)}px`,
    '--pv-content': contentBg,
    '--pv-content-fg': contentFg,
    '--pv-card': card,
    '--pv-accent': accent,
    '--pv-radius': `${radius}px`,
    '--pv-divider': layers.gridDivider ?? 'rgba(255,255,255,.09)',
  } as CSSProperties
  return (
    <div className="theme-preview" data-join={join} style={style} data-testid={testId} aria-hidden="true">
      <div className="theme-preview-frame theme-preview-titlebar">
        <span className="theme-preview-lights"><i /><i /><i /></span>
        <span className="theme-preview-pills"><b className="on" /><b /><b /></span>
      </div>
      <div className="theme-preview-body">
        <div className="theme-preview-frame theme-preview-rail">
          <b className="on" /><b /><b /><b />
        </div>
        <div className="theme-preview-frame theme-preview-sidebar">
          <span className="on" /><span /><span /><span />
        </div>
        <div className="theme-preview-content">
          <div className="theme-preview-grid">
            <div className="theme-preview-pane"><i className="w1" /><i className="w2" /><i className="w3" /></div>
            <div className="theme-preview-pane"><i className="w2" /><i className="w1" /><em /></div>
          </div>
        </div>
      </div>
      <div className="theme-preview-frame theme-preview-status"><span /><span className="dot" /></div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gradient editor (solid / linear / radial, angle, center, 2..5 stops)
// ---------------------------------------------------------------------------

type FillKind = 'none' | 'solid' | 'linear' | 'radial'

interface GradientEditorProps {
  label: string
  /** `solid` is offered only for the wallpaper. */
  allowSolid: boolean
  value: WallpaperLayer | ThemeGradient | undefined
  fallbackColor: string
  onChange: (value: WallpaperLayer | undefined) => void
  testId: string
}

function GradientEditor({ label, allowSolid, value, fallbackColor, onChange, testId }: GradientEditorProps) {
  const { t } = useTranslation()
  const kind: FillKind = !value ? 'none' : value.type
  const stops: GradientStop[] = value && value.type !== 'solid' ? value.stops : [[fallbackColor, 0], ['#0c0e12', 1]]
  const setKind = (next: FillKind) => {
    if (next === 'none') return onChange(undefined)
    if (next === 'solid') return onChange({ type: 'solid', color: value?.type === 'solid' ? value.color : stops[0]![0] })
    const base = value && value.type !== 'solid' ? value : undefined
    onChange({ type: next, angle: base?.angle ?? 135, at: base?.at ?? [0, 0], stops })
  }
  const gradient = value && value.type !== 'solid' ? value : null
  const patch = (next: Partial<ThemeGradient>) => gradient && onChange({ ...gradient, ...next })
  const setStop = (index: number, stop: GradientStop) => patch({ stops: stops.map((s, i) => (i === index ? stop : s)) })
  const options = [
    { value: 'none' as const, label: t('settings.appearance.layers.fillNone') },
    ...(allowSolid ? [{ value: 'solid' as const, label: t('settings.appearance.layers.fillSolid') }] : []),
    { value: 'linear' as const, label: t('settings.appearance.layers.fillLinear') },
    { value: 'radial' as const, label: t('settings.appearance.layers.fillRadial') },
  ]
  return (
    <div className="theme-gradient-editor" data-testid={testId}>
      <SettingsRow label={label}>
        <SettingsSegmentedControl size="sm" value={kind} onValueChange={setKind} options={options} aria-label={label} />
      </SettingsRow>
      {value?.type === 'solid' && (
        <SettingsRow label={t('settings.appearance.layers.color')}>
          <ColorPicker value={value.color} onChange={(color) => onChange({ type: 'solid', color })} ariaLabel={label} align="end" />
        </SettingsRow>
      )}
      {gradient && (
        <>
          <div className="theme-gradient-bar" style={{ background: gradientToCSS({ ...gradient, type: 'linear', angle: 90 }) }} />
          {gradient.type === 'linear' ? (
            <RangeRow label={t('settings.appearance.layers.angle')} min={0} max={360} step={5}
              value={gradient.angle ?? 135} display={`${gradient.angle ?? 135}°`} onChange={(angle) => patch({ angle })} />
          ) : (
            <>
              <RangeRow label={t('settings.appearance.layers.centerX')} min={0} max={100} step={5}
                value={gradient.at?.[0] ?? 0} display={`${gradient.at?.[0] ?? 0}%`} onChange={(x) => patch({ at: [x, gradient.at?.[1] ?? 0] })} />
              <RangeRow label={t('settings.appearance.layers.centerY')} min={0} max={100} step={5}
                value={gradient.at?.[1] ?? 0} display={`${gradient.at?.[1] ?? 0}%`} onChange={(y) => patch({ at: [gradient.at?.[0] ?? 0, y] })} />
            </>
          )}
          {stops.map(([color, position], index) => (
            <SettingsRow key={index} label={t('settings.appearance.layers.stop', { n: index + 1 })}>
              <div className="theme-stop-row">
                <ColorPicker value={hexOr(color, fallbackColor)} onChange={(hex) => setStop(index, [hex, position])}
                  ariaLabel={t('settings.appearance.layers.stop', { n: index + 1 })} align="end" />
                <input type="range" min={0} max={100} step={1} value={Math.round(position * 100)}
                  aria-label={t('settings.appearance.layers.stopPosition', { n: index + 1 })}
                  className="material-slider-input" onChange={(event) => setStop(index, [color, Number(event.target.value) / 100])} />
                <span className="material-slider-value numeric">{Math.round(position * 100)}%</span>
                <button type="button" className="theme-icon-button" disabled={stops.length <= 2}
                  aria-label={t('settings.appearance.layers.removeStop')}
                  onClick={() => patch({ stops: stops.filter((_, i) => i !== index) })}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </SettingsRow>
          ))}
          {stops.length < MAX_STOPS && (
            <div className="theme-row-actions">
              <Button variant="ghost" size="sm" onClick={() => patch({ stops: [...stops, [stops[stops.length - 1]![0], 1]] })}>
                <Plus className="size-3.5" /> {t('settings.appearance.layers.addStop')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RangeRow({ label, min, max, step, value, display, onChange, testId }: {
  label: string; min: number; max: number; step: number; value: number; display: string
  onChange: (value: number) => void; testId?: string
}) {
  return (
    <SettingsRow label={label}>
      <div className="material-slider">
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} data-testid={testId}
          className="material-slider-input" onChange={(event) => onChange(Number(event.target.value))} />
        <span className="material-slider-value numeric">{display}</span>
      </div>
    </SettingsRow>
  )
}

function Swatches({ colors }: { colors: string[] }) {
  return (
    <span className="theme-derived" aria-hidden="true">
      {colors.map((color, index) => <i key={index} style={{ background: color }} />)}
    </span>
  )
}

function LayerColorRow({ label, description, value, onChange, derived, testId }: {
  label: string; description?: string; value: string; onChange: (hex: string) => void; derived?: string[]; testId: string
}) {
  return (
    <SettingsRow label={label} description={description} data-testid={testId}>
      <div className="theme-color-cell">
        {derived && <Swatches colors={derived} />}
        <ColorPicker value={value} onChange={onChange} ariaLabel={label} align="end" />
      </div>
    </SettingsRow>
  )
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function ThemeLayersSection({ onPresetsChanged }: { onPresetsChanged?: () => void }) {
  const { t } = useTranslation()
  const { resolvedTheme, isDark, effectiveColorTheme, setColorTheme } = useTheme()
  const overrideLayers = useAppTheme()?.layers ?? null
  const committed = useMemo(
    () => resolvedTheme.layers ?? seedLayersFromPalette(resolvedTheme, isDark),
    [resolvedTheme, isDark],
  )
  const setAppLayers = window.electronAPI?.setAppLayers
  const saveUserPreset = window.electronAPI?.saveUserThemePreset
  const available = typeof setAppLayers === 'function'

  const [draft, setDraft] = useState<ThemeLayers>(committed)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [presetName, setPresetName] = useState('')
  const timerRef = useRef<number | null>(null)
  const pendingRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Adopt external changes (preset switch, other window) when no local edit is in flight.
  useEffect(() => {
    if (!pendingRef.current) setDraft(committed)
  }, [committed])
  useEffect(() => () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }, [])

  const persist = useCallback((next: ThemeLayers | null) => {
    if (typeof setAppLayers !== 'function') return
    pendingRef.current = true
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void setAppLayers(next).then(
        () => { pendingRef.current = false },
        (error: unknown) => {
          pendingRef.current = false
          setStatus({ kind: 'error', text: t('settings.appearance.layers.saveError') })
          if (error) console.warn('Failed to save theme layers:', error)
        },
      )
    }, APPLY_DEBOUNCE_MS)
  }, [setAppLayers, t])

  const update = useCallback((patch: (layers: ThemeLayers) => ThemeLayers) => {
    setStatus(null)
    setDraft((current) => {
      const next = patch(current)
      persist(next)
      return next
    })
  }, [persist])

  const frameBg = hexOr(draft.frame?.bg, '#101418')
  const contentBg = hexOr(draft.content?.bg, '#15171b')
  const frameShades = deriveShades(frameBg)
  const contentShades = deriveShades(contentBg)
  const join: ContentJoinMode = draft.content?.join ?? 'line'
  const glassPercent = Math.round((draft.glass ?? 0) * 100)

  const contrastInputs = useMemo(() => resolveContrastInputs(draft, {
    background: resolvedTheme.background, foreground: resolvedTheme.foreground,
    navigator: resolvedTheme.navigator, accent: resolvedTheme.accent,
  }), [draft, resolvedTheme])
  const contrast = useMemo(() => checkLayerContrast(contrastInputs), [contrastInputs])
  const fix = (id: ContrastPairId) => update((layers) => fixLayerContrast(layers, contrastInputs, id))

  const handleExport = () => {
    const name = presetName.trim() || t('settings.appearance.layers.exportName')
    const file = buildRoxThemeFile(name, draft, effectiveColorTheme)
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${themeSlug(name)}.rox-theme.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const handleImport = (file: File) => {
    void file.text().then((text) => {
      let json: unknown
      try { json = JSON.parse(text) } catch { json = null }
      const parsed = RoxThemeFileSchema.safeParse(json)
      if (!parsed.success) {
        setStatus({ kind: 'error', text: t('settings.appearance.layers.importError') })
        return
      }
      const layers = parsed.data.layers as ThemeLayers
      setDraft(layers)
      persist(layers)
      setPresetName(parsed.data.name)
      setStatus({ kind: 'ok', text: t('settings.appearance.layers.importSuccess', { name: parsed.data.name }) })
    }).catch(() => setStatus({ kind: 'error', text: t('settings.appearance.layers.importError') }))
  }

  const handleSavePreset = () => {
    const name = presetName.trim()
    if (!name || typeof saveUserPreset !== 'function') return
    const colors = isDark && resolvedTheme.dark ? { ...resolvedTheme, ...resolvedTheme.dark } : resolvedTheme
    const preset: ThemeFile = {
      name,
      description: t('settings.appearance.layers.userPresetDescription'),
      author: 'user',
      supportedModes: [isDark ? 'dark' : 'light'],
      background: draft.content?.bg ?? colors.background,
      foreground: draft.content?.fg ?? colors.foreground,
      accent: draft.accent ?? colors.accent,
      navigator: draft.frame?.bg ?? colors.navigator,
      paper: draft.elevation?.[1] ?? colors.paper,
      popover: draft.elevation?.[2] ?? colors.popover,
      popoverSolid: draft.elevation?.[3] ?? draft.elevation?.[2] ?? colors.popoverSolid,
      layers: draft,
    }
    void saveUserPreset(themeSlug(name), preset).then(
      (id) => {
        // The preset now carries the layers: drop the override so switching
        // presets later is not shadowed by it, then select the new preset.
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        pendingRef.current = false
        void setAppLayers?.(null)
        setColorTheme(id)
        onPresetsChanged?.()
        setStatus({ kind: 'ok', text: t('settings.appearance.layers.presetSaved', { name }) })
      },
      () => setStatus({ kind: 'error', text: t('settings.appearance.layers.presetSaveError') }),
    )
  }

  const handleReset = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    pendingRef.current = false
    setStatus(null)
    void setAppLayers?.(null)
  }

  const pairLabel: Record<ContrastPairId, string> = {
    frameText: t('settings.appearance.layers.contrastFrameText'),
    frameMuted: t('settings.appearance.layers.contrastFrameMuted'),
    contentText: t('settings.appearance.layers.contrastContentText'),
    accentText: t('settings.appearance.layers.contrastAccent'),
  }

  const group = (title: string, children: ReactNode, testId: string) => (
    <div className="material-group" data-testid={testId}>
      <h4 className="material-group-title">{title}</h4>
      <SettingsCard>{children}</SettingsCard>
    </div>
  )

  return (
    <SettingsSection
      title={t('settings.appearance.layers.title')}
      description={t('settings.appearance.layers.description')}
      data-testid="theme-layers-section"
      action={overrideLayers ? (
        <Button variant="ghost" size="sm" onClick={handleReset} disabled={!available}>{t('settings.appearance.layers.reset')}</Button>
      ) : undefined}
    >
      <div className="theme-layers">
        <div className="theme-preview-sticky"><ThemeMiniShellPreview layers={draft} /></div>
        {!available && <p className="material-note">{t('settings.appearance.layers.unavailable')}</p>}

        {group(t('settings.appearance.layers.frame'), (
          <>
            <LayerColorRow testId="theme-layer-frame" label={t('settings.appearance.layers.frameColor')}
              description={t('settings.appearance.layers.frameColorDesc')} value={frameBg}
              derived={frameShades ? [draft.frame?.fg ?? frameShades.fg, draft.frame?.muted ?? frameShades.muted, frameShades.border] : undefined}
              onChange={(bg) => update((l) => {
                const shades = deriveShades(bg)
                return { ...l, frame: { ...l.frame, bg, fg: shades?.fg, muted: shades?.muted, border: shades?.border } }
              })} />
            <LayerColorRow testId="theme-layer-frame-fg" label={t('settings.appearance.layers.frameText')}
              value={hexOr(draft.frame?.fg, frameShades?.fg ?? '#eef1f4')}
              onChange={(fg) => update((l) => ({ ...l, frame: { ...l.frame, fg } }))} />
            <GradientEditor testId="theme-frame-gradient" label={t('settings.appearance.layers.frameGradient')} allowSolid={false}
              value={draft.frame?.gradient} fallbackColor={frameBg}
              onChange={(value) => update((l) => ({ ...l, frame: { ...l.frame, gradient: value && value.type !== 'solid' ? value : undefined } }))} />
          </>
        ), 'theme-group-frame')}

        {group(t('settings.appearance.layers.wallpaper'), (
          <>
            <GradientEditor testId="theme-wallpaper" label={t('settings.appearance.layers.wallpaperFill')} allowSolid
              value={draft.wallpaper} fallbackColor="#1d3b4a"
              onChange={(wallpaper) => update((l) => ({ ...l, wallpaper }))} />
            <RangeRow testId="theme-glass" label={t('settings.appearance.layers.glass')} min={0} max={100} step={5}
              value={glassPercent} display={`${glassPercent}%`}
              onChange={(value) => update((l) => ({ ...l, glass: value / 100 }))} />
            {!draft.wallpaper && <p className="material-note">{t('settings.appearance.layers.glassNeedsWallpaper')}</p>}
          </>
        ), 'theme-group-wallpaper')}

        {group(t('settings.appearance.layers.content'), (
          <>
            <LayerColorRow testId="theme-layer-content" label={t('settings.appearance.layers.contentColor')} value={contentBg}
              derived={contentShades ? [draft.content?.fg ?? contentShades.fg, contentShades.muted, contentShades.border] : undefined}
              onChange={(bg) => update((l) => {
                const shades = deriveShades(bg)
                return { ...l, content: { ...l.content, bg, fg: shades?.fg, border: shades?.border } }
              })} />
            <LayerColorRow testId="theme-layer-content-fg" label={t('settings.appearance.layers.contentText')}
              value={hexOr(draft.content?.fg, contentShades?.fg ?? '#eef1f4')}
              onChange={(fg) => update((l) => ({ ...l, content: { ...l.content, fg } }))} />
            <LayerColorRow testId="theme-layer-cards" label={t('settings.appearance.layers.cards')}
              value={hexOr(draft.elevation?.[1], contentShades?.hover ?? contentBg)}
              onChange={(card) => update((l) => ({ ...l, elevation: { ...l.elevation, 1: card } }))} />
            <LayerColorRow testId="theme-layer-popover" label={t('settings.appearance.layers.popovers')}
              value={hexOr(draft.elevation?.[2], contentShades?.hover ?? contentBg)}
              onChange={(pop) => update((l) => ({ ...l, elevation: { ...l.elevation, 2: pop, 3: pop } }))} />
            <SettingsRow label={t('settings.appearance.layers.join')} description={t('settings.appearance.layers.joinDesc')}>
              <SettingsSegmentedControl size="sm" value={join} aria-label={t('settings.appearance.layers.join')}
                onValueChange={(value) => update((l) => ({ ...l, content: { ...l.content, join: value } }))}
                options={[
                  { value: 'line', label: t('settings.appearance.layers.joinLine') },
                  { value: 'shadow', label: t('settings.appearance.layers.joinShadow') },
                  { value: 'float', label: t('settings.appearance.layers.joinFloat') },
                ]} />
            </SettingsRow>
            {join === 'float' && (
              <RangeRow label={t('settings.appearance.layers.radius')} min={0} max={24} step={1}
                value={draft.content?.radius ?? CONTENT_RADIUS_DEFAULT} display={`${draft.content?.radius ?? CONTENT_RADIUS_DEFAULT}px`}
                onChange={(radius) => update((l) => ({ ...l, content: { ...l.content, radius } }))} />
            )}
          </>
        ), 'theme-group-content')}

        {group(t('settings.appearance.layers.accent'), (
          <LayerColorRow testId="theme-layer-accent" label={t('settings.appearance.layers.accentColor')}
            value={hexOr(draft.accent, '#38bdf8')}
            onChange={(accent) => update((l) => ({ ...l, accent }))} />
        ), 'theme-group-accent')}

        {group(t('settings.appearance.layers.contrast'), (
          <ul className="theme-contrast" data-testid="theme-contrast">
            {contrast.map((pair) => (
              <li key={pair.id} data-pass={pair.pass} data-testid={`theme-contrast-${pair.id}`}>
                {pair.pass ? <Check className="size-3.5 theme-contrast-ok" /> : <AlertTriangle className="size-3.5 theme-contrast-bad" />}
                <span className="theme-contrast-label">{pairLabel[pair.id]}</span>
                <span className="numeric theme-contrast-ratio">{pair.ratio.toFixed(2)}:1</span>
                <span className="theme-contrast-required">{t('settings.appearance.layers.contrastRequired', { ratio: pair.required })}</span>
                {!pair.pass && (
                  <Button variant="outline" size="sm" onClick={() => fix(pair.id)} disabled={!available}
                    data-testid={`theme-contrast-fix-${pair.id}`}>
                    {t('settings.appearance.layers.fix')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ), 'theme-group-contrast')}

        {group(t('settings.appearance.layers.share'), (
          <>
            <SettingsRow label={t('settings.appearance.layers.presetName')}>
              <input className="theme-name-input" value={presetName} maxLength={60}
                placeholder={t('settings.appearance.layers.presetNamePlaceholder')}
                aria-label={t('settings.appearance.layers.presetName')}
                onChange={(event) => setPresetName(event.target.value)} />
            </SettingsRow>
            <div className="theme-row-actions material-transfer">
              <Button variant="outline" size="sm" disabled={!presetName.trim() || typeof saveUserPreset !== 'function'}
                onClick={handleSavePreset} data-testid="theme-save-preset">{t('settings.appearance.layers.savePreset')}</Button>
              <Button variant="outline" size="sm" onClick={handleExport} data-testid="theme-export">{t('settings.appearance.layers.export')}</Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={!available}
                data-testid="theme-import">{t('settings.appearance.layers.import')}</Button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="material-file-input" tabIndex={-1}
                aria-hidden="true" onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) handleImport(file)
                  event.target.value = ''
                }} />
            </div>
          </>
        ), 'theme-group-share')}

        {status && (
          <p role="status" className={status.kind === 'error' ? 'material-note material-note-error' : 'material-note'}>{status.text}</p>
        )}
      </div>
    </SettingsSection>
  )
}
