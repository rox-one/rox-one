import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Palette, RotateCcw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  DEFAULT_WIDGET_APPEARANCE,
  WIDGET_DESIGN_PRESETS,
  WIDGET_PALETTE_HUES,
  WIDGET_PALETTES,
  matchingWidgetPreset,
  widgetAppearanceStyle,
  type WidgetAppearance,
} from './widget-appearance'

/** Portalled controls stay usable in a small card and near either window edge. */
export function WidgetAppearanceControls({ title, appearance, onChange }: {
  title: string
  appearance?: WidgetAppearance
  onChange: (appearance?: WidgetAppearance) => void
}) {
  const { t } = useTranslation()
  const headingId = React.useId()
  const value = appearance ?? DEFAULT_WIDGET_APPEARANCE
  const selectedPreset = appearance ? matchingWidgetPreset(appearance) : undefined
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-home-design-trigger=""
          aria-label={t('workbench.home.design.open', { name: title })}
          title={t('workbench.home.design.title')}
          className="flex h-6 w-6 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Palette className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        aria-labelledby={headingId}
        data-home-design-controls=""
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-24px))] overflow-y-auto bg-background p-3 [--muted-foreground:var(--text-secondary)]"
        onPointerDown={(event) => event.stopPropagation()}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <div className="space-y-3">
          <div>
            <h3 id={headingId} className="text-[13px] font-bold text-foreground">{t('workbench.home.design.title')}</h3>
            <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{t('workbench.home.design.hint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t('workbench.home.design.presets')}>
            {WIDGET_DESIGN_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-home-design-preset={preset.id}
                aria-pressed={selectedPreset === preset.id}
                onClick={() => onChange({ ...preset.appearance })}
                className={cn('min-w-0 rounded-lg p-1 text-left ring-1 ring-foreground/10 hover:ring-foreground/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', selectedPreset === preset.id && 'ring-2 ring-accent')}
              >
                <span className="rox-home-widget block h-9 rounded-md p-2" style={widgetAppearanceStyle(preset.appearance)} aria-hidden="true">
                  <span className="block h-1 w-2/3 rounded-full bg-foreground/70" />
                  <span className="mt-1.5 block h-1 w-4/5 rounded-full bg-foreground/20" />
                </span>
                <span className="mt-1 flex items-center justify-between gap-1 px-0.5 text-[11px] text-foreground">
                  <span className="break-words">{t(`workbench.home.design.${preset.id}`)}</span>
                  {selectedPreset === preset.id ? <Check className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" /> : null}
                </span>
              </button>
            ))}
          </div>
          <div role="group" aria-label={t('workbench.home.design.palette')}>
            <p className="mb-1.5 text-[12px] font-bold text-foreground">{t('workbench.home.design.palette')}</p>
            <div className="grid grid-cols-5 gap-1">
              {WIDGET_PALETTES.map((palette) => (
                <button
                  key={palette}
                  type="button"
                  data-home-design-palette={palette}
                  aria-pressed={value.palette === palette}
                  onClick={() => onChange({ ...value, palette })}
                  className="flex min-w-0 flex-col items-center gap-1 rounded-md py-1 text-[10px] text-foreground hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:bg-foreground/10"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-foreground/20" style={{ background: `oklch(70% ${palette === 'neutral' ? 0.008 : 0.14} ${WIDGET_PALETTE_HUES[palette]})` }} aria-hidden="true">
                    {value.palette === palette ? <Check className="h-3 w-3 text-black" strokeWidth={3} /> : null}
                  </span>
                  <span className="w-full truncate text-center">{t(`workbench.home.design.${palette}`)}</span>
                </button>
              ))}
            </div>
          </div>
          {(['saturation', 'contrast'] as const).map((property) => (
            <label key={property} className="block text-[12px] text-foreground">
              <span className="flex justify-between gap-2">
                <span>{t(`workbench.home.design.${property}`)}</span>
                <span className="tabular-nums">{value[property]}%</span>
              </span>
              <input
                type="range"
                data-home-design-slider={property}
                aria-label={t(`workbench.home.design.${property}`)}
                min={0}
                max={100}
                step={1}
                value={value[property]}
                onChange={(event) => onChange({ ...value, [property]: Number(event.target.value) })}
                className="mt-1.5 block h-4 w-full cursor-pointer accent-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>
          ))}
          <div className="rox-home-widget rounded-lg px-3 py-2" style={widgetAppearanceStyle(appearance)} data-home-design-preview="">
            <p className="truncate text-[12px] font-bold text-foreground">{title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('workbench.home.design.preview')}</p>
          </div>
          <button
            type="button"
            data-home-design-reset=""
            onClick={() => onChange(undefined)}
            disabled={!appearance}
            className="flex items-center gap-1.5 rounded-md px-1 py-1 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            {t('workbench.home.design.reset')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
