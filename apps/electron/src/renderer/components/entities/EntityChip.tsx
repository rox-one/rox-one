/**
 * W1-08 (#1505) — inline entity chip.
 *
 * - Always renders the ref (label or `kind:id`) so content stays readable
 *   with every flag off.
 * - With `entities.previews.v1` on: resolves a preview, swaps in the live
 *   title and opens an EntityHoverCard after 300 ms of hover/focus.
 * - Restricted refs show a lock and «Нет доступа» without the title;
 *   tombstones show «Удалено» struck through.
 * - Drag source for `application/x-rox-entity-ref`; right-click opens the
 *   common row menu.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, TriangleAlert } from 'lucide-react'
import {
  formatEntityRef,
  isRestrictedPreview,
  parseEntityRef,
  type EntityRef,
} from '@rox/core/entities'
import { FOCUS_RING, HOVER_TINT, MOTION_FAST } from '@rox/ui/primitives'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { EntityHoverCard } from './EntityHoverCard'
import { EntityRowContextMenu } from './EntityRowContextMenu'
import { EntityKindIcon } from './kind-icons'
import { entityKindLabel } from './entity-format'
import { setEntityDragData } from './drag'
import { useEntityPreviewsEnabled } from './flags'
import { useEntityWorkspaceId } from './entity-context'
import { openEntity } from './open-entity'
import { previewRenderersFor } from './preview-registry'
import { useEntityPreview, type EntityPreviewView } from './use-entity-preview'

export const ENTITY_HOVER_DELAY_MS = 300
const HOVER_CLOSE_MS = 150

export interface EntityChipProps {
  entityRef: EntityRef | string
  /** Label stored with the reference (`[[kind:id|label]]`). */
  label?: string
  workspaceId?: string | null
  /** Controlled preview (stories, tests, lists that already resolved). */
  preview?: EntityPreviewView | null
  /** Overrides the `entities.previews.v1` gate (stories/tests). */
  previewsEnabled?: boolean
  onOpen?: (ref: EntityRef, event: React.MouseEvent) => void
  contextMenu?: boolean
  draggable?: boolean
  className?: string
}

function toRef(value: EntityRef | string): EntityRef | null {
  if (typeof value !== 'string') return value
  const result = parseEntityRef(value)
  return result.ok ? result.value : null
}

export function EntityChip(props: EntityChipProps) {
  const ref = toRef(props.entityRef)
  if (!ref) {
    const text = props.label || (typeof props.entityRef === 'string' ? props.entityRef : '')
    return <span data-entity-invalid="" className={cn('text-text-muted', props.className)}>{text}</span>
  }
  return <ValidEntityChip {...props} entityRef={ref} />
}

function ValidEntityChip({
  entityRef: ref,
  label,
  workspaceId: explicitWorkspaceId,
  preview: controlledPreview,
  previewsEnabled: enabledOverride,
  onOpen,
  contextMenu = true,
  draggable = true,
  className,
}: EntityChipProps & { entityRef: EntityRef }) {
  const { t } = useTranslation()
  const flagEnabled = useEntityPreviewsEnabled()
  const enabled = enabledOverride ?? flagEnabled
  const workspaceId = useEntityWorkspaceId(explicitWorkspaceId)
  const fetched = useEntityPreview(ref, workspaceId, enabled && controlledPreview === undefined)
  const preview: EntityPreviewView | null = controlledPreview !== undefined
    ? controlledPreview
    : fetched.status === 'ready' ? fetched.preview : null
  const loading = controlledPreview === undefined && fetched.status === 'loading'

  const [hoverOpen, setHoverOpen] = React.useState(false)
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    openTimer.current = null
    closeTimer.current = null
  }
  React.useEffect(() => clearTimers, [])
  const scheduleOpen = () => {
    if (!enabled) return
    clearTimers()
    openTimer.current = setTimeout(() => setHoverOpen(true), ENTITY_HOVER_DELAY_MS)
  }
  const scheduleClose = () => {
    clearTimers()
    closeTimer.current = setTimeout(() => setHoverOpen(false), HOVER_CLOSE_MS)
  }

  const formatted = formatEntityRef(ref)
  const kind = entityKindLabel(t, ref.kind, preview?.kindLabel)
  const restricted = preview && isRestrictedPreview(preview) ? preview : null
  const model = preview && !isRestrictedPreview(preview) ? preview : null
  const ChipLabel = model ? previewRenderersFor(ref.kind)?.ChipLabel : undefined

  let text: string
  let status: string = preview?.status ?? (loading ? 'loading' : 'idle')
  if (restricted?.status === 'no_access') text = t('entities.ui.chip.restricted')
  else if (restricted?.status === 'tombstone') text = t('entities.ui.chip.deleted')
  else if (restricted?.status === 'unavailable') text = label || t('entities.ui.chip.unavailable')
  else text = model?.title || label || formatted
  if (!preview && !loading) status = 'idle'
  const dragLabel = restricted ? kind : (model?.title || label || formatted)

  const open = (event: React.MouseEvent) => {
    if (onOpen) onOpen(ref, event)
    else openEntity(ref, { newPanel: event.metaKey || event.ctrlKey })
  }

  const chip = (
    <button
      type="button"
      data-entity-chip={formatted}
      data-entity-status={status}
      draggable={draggable || undefined}
      onDragStart={draggable ? (event) => { setEntityDragData(event.dataTransfer, ref, dragLabel) } : undefined}
      onClick={open}
      onPointerEnter={scheduleOpen}
      onPointerLeave={enabled ? scheduleClose : undefined}
      onFocus={scheduleOpen}
      onBlur={enabled ? scheduleClose : undefined}
      aria-label={restricted ? `${kind}: ${text}` : t('entities.ui.chip.open', { title: `${kind} ${text}` })}
      className={cn(
        'inline-flex h-5 max-w-[240px] items-center gap-1 rounded-full px-1.5 align-baseline text-[0.92em] leading-none',
        'bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-foreground',
        HOVER_TINT,
        MOTION_FAST,
        FOCUS_RING,
        restricted && 'text-text-muted',
        className,
      )}
    >
      {restricted?.status === 'no_access'
        ? <Lock aria-hidden="true" className="size-3 shrink-0" />
        : restricted?.status === 'unavailable'
          ? <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
          : <EntityKindIcon kind={ref.kind} icon={model?.icon} className="size-3 shrink-0" />}
      <span className={cn('truncate', restricted?.status === 'tombstone' && 'line-through')}>
        {ChipLabel && model ? <ChipLabel preview={model} /> : text}
      </span>
    </button>
  )

  const withMenu = contextMenu ? <EntityRowContextMenu entityRef={ref}>{chip}</EntityRowContextMenu> : chip
  if (!enabled) return withMenu

  return (
    <Popover open={hoverOpen} onOpenChange={setHoverOpen}>
      <PopoverAnchor asChild>
        <span className="inline-flex align-baseline">{withMenu}</span>
      </PopoverAnchor>
      {hoverOpen && (
        <PopoverContent
          side="bottom"
          align="start"
          className="w-auto border-0 bg-transparent p-0 shadow-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={() => clearTimers()}
          onPointerLeave={scheduleClose}
        >
          <EntityHoverCard entityRef={ref} preview={preview} loading={loading || !preview} onOpen={(r, e) => (onOpen ? onOpen(r, e) : openEntity(r, { newPanel: e.metaKey || e.ctrlKey }))} />
        </PopoverContent>
      )}
    </Popover>
  )
}
