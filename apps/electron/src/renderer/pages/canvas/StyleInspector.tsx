/**
 * Right-side style inspector for the current «Доска» selection.
 * Edits map onto canvas-core nested style (fill / stroke / font) + opacity + props.radius.
 */
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { CanvasObject } from '@rox/canvas-core'
import {
  COLOR_TEXT_PLACEHOLDER, colorForPicker, commonStyle, normalizeColorInput, visibleFields,
  type CommonField, type FieldValue, type StyleField,
} from './style-model'

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

const FIELD_LABEL: Record<StyleField, string> = {
  fill: 'canvas.inspector.fill',
  stroke: 'canvas.inspector.stroke',
  strokeWidth: 'canvas.inspector.strokeWidth',
  opacity: 'canvas.inspector.opacity',
  cornerRadius: 'canvas.inspector.cornerRadius',
  fontSize: 'canvas.inspector.fontSize',
  fontWeight: 'canvas.inspector.fontWeight',
}

export type StyleInspectorProps = {
  objects: readonly CanvasObject[]
  onChange: (field: StyleField, value: FieldValue) => void
}

export function StyleInspector({ objects, onChange }: StyleInspectorProps) {
  const { t } = useTranslation()
  const fields = useMemo(() => visibleFields(objects), [objects])
  const common = useMemo(() => commonStyle(objects), [objects])
  const editable = useMemo(() => objects.some(o => !o.locked), [objects])
  if (objects.length === 0 || fields.length === 0) return null

  return (
    <aside
      data-testid="canvas-style-inspector"
      data-glass-slot="panel"
      aria-label={t('canvas.inspector.title')}
      aria-disabled={editable ? undefined : true}
      className={`absolute right-3 top-14 z-sticky w-56 rounded-lg border border-border bg-background p-3 shadow-sm ${editable ? '' : 'opacity-60'}`}
    >
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        {t('canvas.inspector.title')}
        {objects.length > 1 && (
          <span className="ml-1 font-normal normal-case" data-testid="canvas-style-inspector-count">
            ({t('canvas.inspector.selected', { count: objects.length })})
          </span>
        )}
      </div>
      <fieldset disabled={!editable} className="flex flex-col gap-2 border-0 p-0 m-0 min-w-0">
        {fields.map(field => (
          <FieldRow
            key={field}
            field={field}
            label={t(FIELD_LABEL[field])}
            mixedLabel={t('canvas.inspector.mixed')}
            common={common[field]}
            onChange={onChange}
          />
        ))}
      </fieldset>
    </aside>
  )
}

function FieldRow({
  field, label, mixedLabel, common, onChange,
}: {
  field: StyleField
  label: string
  mixedLabel: string
  common: CommonField
  onChange: (field: StyleField, value: FieldValue) => void
}) {
  const mixed = common.state === 'mixed'
  const value = common.state === 'value' ? common.value : undefined

  if (field === 'fill' || field === 'stroke') {
    return (
      <ColorField
        field={field}
        label={label}
        mixed={mixed}
        mixedLabel={mixedLabel}
        value={typeof value === 'string' ? value : undefined}
        onChange={onChange}
      />
    )
  }
  if (field === 'fontWeight') {
    return (
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        <span>{label}</span>
        {/* eslint-disable-next-line rox/prefer-primitives -- compact 9-option numeric weight list; Select primitive is heavy for a monospace enum */}
        <select
          data-testid={`canvas-style-${field}`}
          data-mixed={mixed || undefined}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          value={mixed || value === undefined ? '' : String(value)}
          onChange={e => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(field, n)
          }}
        >
          {mixed && <option value="">{mixedLabel}</option>}
          {!mixed && value === undefined && <option value="">{/* blank */}</option>}
          {FONT_WEIGHTS.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </label>
    )
  }
  const step = field === 'opacity' ? 0.05 : field === 'fontSize' || field === 'strokeWidth' || field === 'cornerRadius' ? 1 : 1
  const min = field === 'opacity' ? 0 : 0
  const max = field === 'opacity' ? 1 : field === 'fontSize' ? 400 : field === 'strokeWidth' ? 64 : field === 'cornerRadius' ? 200 : undefined
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      <span>{label}</span>
      <input
        type="number"
        data-testid={`canvas-style-${field}`}
        data-mixed={mixed || undefined}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        placeholder={mixed ? mixedLabel : undefined}
        value={mixed || value === undefined ? '' : value}
        min={min}
        max={max}
        step={step}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          if (e.target.value === '') return
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(field, n)
        }}
      />
    </label>
  )
}

function ColorField({
  field, label, mixed, mixedLabel, value, onChange,
}: {
  field: 'fill' | 'stroke'
  label: string
  mixed: boolean
  mixedLabel: string
  value: string | undefined
  onChange: (field: StyleField, value: FieldValue) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  // Drop in-progress typing when the selection (and thus `value`/`mixed`) changes.
  useEffect(() => { setDraft(null) }, [value, mixed])
  const display = draft ?? (mixed ? '' : (value ?? ''))
  const pickerValue = !mixed ? colorForPicker(value) : colorForPicker(undefined)

  const commit = (raw: string) => {
    const n = normalizeColorInput(raw)
    setDraft(null)
    if (n) onChange(field, n)
  }

  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          data-testid={`canvas-style-${field}-picker`}
          aria-label={label}
          className="h-8 w-8 cursor-pointer rounded border border-border bg-background p-0.5"
          value={pickerValue}
          onChange={e => {
            const n = normalizeColorInput(e.target.value)
            if (!n) return
            setDraft(n)
            onChange(field, n)
          }}
        />
        <input
          type="text"
          data-testid={`canvas-style-${field}`}
          data-mixed={mixed || undefined}
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground"
          placeholder={mixed ? mixedLabel : COLOR_TEXT_PLACEHOLDER}
          value={display}
          onChange={e => setDraft(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
        />
      </div>
    </label>
  )
}

export default StyleInspector
