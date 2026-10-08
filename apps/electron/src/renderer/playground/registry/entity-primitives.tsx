/**
 * W1-08 (#1505) — playground stories for the entity UI primitives
 * (UI-SPEC §4). QA fixtures only; no live data. The same story components
 * back the markup snapshots in components/entities/__tests__.
 */
import * as React from 'react'
import type { ComponentEntry } from './types'
import {
  ActivityTimeline,
  CommentsThread,
  ContextualDatePicker,
  GanttView,
  PersonField,
  PieProgress,
  PrivacyField,
  ProgressBar,
  ReactionsBar,
  STATUS_BADGE_KEYS,
  StatusBadge,
  SubscribersPicker,
  TreeTable,
  applyReactionToggle,
  type CommentItem,
  type ContextualDate,
  type GanttItem,
  type GanttZoom,
  type PersonOption,
  type PrivacyLevel,
  type ReactionSummary,
  type TreeRow,
} from '@rox/ui/primitives'
import { EntityChip } from '@/components/entities/EntityChip'
import { EntityHoverCard } from '@/components/entities/EntityHoverCard'
import { EntityCard } from '@/components/entities/EntityCard'
import { EntityPickerPanel } from '@/components/entities/EntityPicker'
import { BacklinksList } from '@/components/entities/BacklinksPanel'
import { rememberRecentEntity } from '@/components/entities/entity-data-source'
import type { EntityPreviewView } from '@/components/entities/use-entity-preview'
import {
  FIXTURE_BACKLINKS,
  FIXTURE_RESTRICTED,
  FIXTURE_SECRET_REF,
  FIXTURE_TASK_PREVIEW,
  FIXTURE_TASK_REF,
  FIXTURE_TOMBSTONE,
  FIXTURE_UNAVAILABLE,
} from '@/components/entities/fixtures'

export const FIXTURE_TODAY = '2026-10-08'
const FIXTURE_NOW = Date.parse('2026-10-08T12:00:00.000Z')

export const FIXTURE_PEOPLE: PersonOption[] = [
  { id: 'p1', name: 'Анна Смирнова', title: 'Product' },
  { id: 'p2', name: 'Mark Lindgreen', title: 'Owner' },
  { id: 'p3', name: 'Игорь Петров', title: 'Engineering' },
  { id: 'p4', name: 'invite@rox.one', placeholder: true },
]

type PreviewState = 'ok' | 'restricted' | 'tombstone' | 'unavailable' | 'loading'

function previewFor(state: PreviewState): { entityRef: typeof FIXTURE_TASK_REF; preview: EntityPreviewView | null } {
  switch (state) {
    case 'restricted': return { entityRef: FIXTURE_SECRET_REF, preview: FIXTURE_RESTRICTED }
    case 'tombstone': return { entityRef: FIXTURE_TOMBSTONE.ref!, preview: FIXTURE_TOMBSTONE }
    case 'unavailable': return { entityRef: FIXTURE_UNAVAILABLE.ref!, preview: FIXTURE_UNAVAILABLE }
    case 'loading': return { entityRef: FIXTURE_TASK_REF, preview: null }
    default: return { entityRef: FIXTURE_TASK_REF, preview: FIXTURE_TASK_PREVIEW }
  }
}

const STATE_CONTROL = {
  name: 'state',
  description: 'Preview state',
  control: {
    type: 'select' as const,
    options: (['ok', 'restricted', 'tombstone', 'unavailable', 'loading'] as const).map((value) => ({ label: value, value })),
  },
  defaultValue: 'ok',
}

export function EntityChipStory({ state = 'ok' }: { state?: PreviewState }) {
  const { entityRef, preview } = previewFor(state)
  return (
    <p className="text-[14px] text-foreground">
      Смотри <EntityChip entityRef={entityRef} label="Release 2.4" preview={preview} previewsEnabled={false} onOpen={() => {}} /> перед стендапом.
    </p>
  )
}

export function EntityHoverCardStory({ state = 'ok' }: { state?: PreviewState }) {
  const { entityRef, preview } = previewFor(state)
  return <EntityHoverCard entityRef={entityRef} preview={preview} loading={state === 'loading'} onOpen={() => {}} onCopyLink={() => {}} />
}

export function EntityCardStory({ state = 'ok' }: { state?: PreviewState }) {
  const { entityRef, preview } = previewFor(state)
  return <EntityCard variant="embed" entityRef={entityRef} preview={preview} loading={state === 'loading'} onOpen={() => {}} onCopyLink={() => {}} />
}

export function EntityPickerStory({ initialQuery = 'task:42' }: { initialQuery?: string }) {
  React.useState(() => {
    rememberRecentEntity('playground', { ref: { kind: 'note', id: 'release-notes' }, title: 'Release notes 2.4' })
    return null
  })
  return (
    <div className="w-[560px] rounded-[8px] border border-border bg-background">
      <EntityPickerPanel workspaceId="playground" initialQuery={initialQuery} onSelect={() => {}} />
    </div>
  )
}

export function BacklinksStory({ empty = false }: { empty?: boolean }) {
  const previews: Record<string, EntityPreviewView> = { 'project:secret-7': FIXTURE_RESTRICTED }
  return (
    <div className="w-[360px]">
      <BacklinksList state={{ status: 'ready', links: empty ? [] : FIXTURE_BACKLINKS }} previews={previews} previewsEnabled={false} />
    </div>
  )
}

export function StatusBadgeStory() {
  return (
    <div className="flex flex-col gap-1">
      {STATUS_BADGE_KEYS.map((status) => <StatusBadge key={status} status={status} />)}
    </div>
  )
}

export function ProgressStory({ done = 3, total = 5 }: { done?: number; total?: number }) {
  return (
    <div className="flex w-[280px] items-center gap-3">
      <ProgressBar done={done} total={total} className="flex-1" />
      <PieProgress done={done} total={total} />
    </div>
  )
}

export function PersonFieldStory() {
  const [champion, setChampion] = React.useState<PersonOption | null>(FIXTURE_PEOPLE[0]!)
  const [reviewer, setReviewer] = React.useState<PersonOption | null>(null)
  return (
    <div className="flex w-[320px] flex-col gap-3">
      <PersonField role="champion" person={champion} candidates={FIXTURE_PEOPLE} onChange={setChampion} />
      <PersonField role="reviewer" person={reviewer} candidates={FIXTURE_PEOPLE} onChange={setReviewer} />
    </div>
  )
}

export function ContextualDateStory() {
  const [value, setValue] = React.useState<ContextualDate | null>({ precision: 'quarter', date: '2026-10-01' })
  return <ContextualDatePicker value={value} onChange={setValue} today={FIXTURE_TODAY} />
}

export function PrivacyFieldStory() {
  const [value, setValue] = React.useState<PrivacyLevel>('space-comment')
  return <PrivacyField value={value} onChange={setValue} spaceName="Rox Desktop" includeLinkOptions />
}

export function ReactionsStory() {
  const [reactions, setReactions] = React.useState<ReactionSummary[]>([
    { emoji: '👍', count: 3, mine: true },
    { emoji: '🎉', count: 1 },
  ])
  return <ReactionsBar reactions={reactions} onToggle={(emoji) => setReactions((prev) => applyReactionToggle(prev, emoji))} />
}

const FIXTURE_COMMENTS: CommentItem[] = [
  {
    id: 'c1',
    author: FIXTURE_PEOPLE[0]!,
    createdAt: '2026-10-08T09:15:00.000Z',
    body: 'Давайте сдвинем релиз на пятницу.',
    reactions: [{ emoji: '👍', count: 2, mine: true }],
    replies: [
      { id: 'c2', author: FIXTURE_PEOPLE[1]!, createdAt: '2026-10-08T09:40:00.000Z', body: 'Ok, works for me.', mine: true, editedAt: '2026-10-08T09:41:00.000Z' },
    ],
  },
  { id: 'c3', author: FIXTURE_PEOPLE[2]!, createdAt: '2026-10-07T17:00:00.000Z', body: '', deleted: true },
]

export function CommentsStory() {
  return <div className="w-[420px]"><CommentsThread comments={FIXTURE_COMMENTS} onCreate={() => {}} onEdit={() => {}} onDelete={() => {}} onToggleReaction={() => {}} timeZone="UTC" /></div>
}

export function ActivityStory() {
  return (
    <div className="w-[420px]">
      <ActivityTimeline
        now={FIXTURE_NOW}
        timeZone="UTC"
        events={[
          { id: 'a1', type: 'status', at: '2026-10-08T10:00:00.000Z', actor: FIXTURE_PEOPLE[0]!, summary: 'В работе → На проверке' },
          { id: 'a2', type: 'comment', at: '2026-10-07T15:00:00.000Z', actor: FIXTURE_PEOPLE[1]!, summary: 'Добавлен комментарий' },
          { id: 'a3', type: 'unknown', at: '2026-10-01T08:00:00.000Z', actor: FIXTURE_PEOPLE[2]! },
        ]}
      />
    </div>
  )
}

export function SubscribersStory() {
  const [ids, setIds] = React.useState<string[]>(['p1', 'p2'])
  const [everyone, setEveryone] = React.useState(false)
  return <SubscribersPicker people={FIXTURE_PEOPLE} subscriberIds={ids} onChange={setIds} notifyEveryone={everyone} onNotifyEveryoneChange={setEveryone} />
}

const FIXTURE_GANTT: GanttItem[] = [
  { id: 'g1', title: 'Дизайн', start: '2026-10-01', end: '2026-10-09', tone: 'success' },
  { id: 'g2', title: 'Implementation', start: '2026-10-06', end: '2026-10-24', tone: 'info' },
  { id: 'g3', title: 'QA', start: '2026-10-20', end: '2026-10-31', tone: 'warning' },
]

export function GanttStory({ zoom: initialZoom = 'week' }: { zoom?: GanttZoom }) {
  const [zoom, setZoom] = React.useState<GanttZoom>(initialZoom)
  const [items, setItems] = React.useState(FIXTURE_GANTT)
  return (
    <div className="w-[720px]">
      <GanttView
        items={items}
        zoom={zoom}
        onZoomChange={setZoom}
        today={FIXTURE_TODAY}
        onReschedule={(id, next) => setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)))}
      />
    </div>
  )
}

const FIXTURE_TREE: TreeRow[] = [
  {
    id: 'r1',
    title: 'Rox Desktop 2.4',
    cells: { status: <StatusBadge status="on_track" size="xs" /> },
    children: [
      { id: 'r2', title: 'Release checklist', cells: { status: <StatusBadge status="caution" size="xs" /> } },
      { id: 'r3', title: 'Changelog', cells: { status: <StatusBadge status="completed" size="xs" /> } },
    ],
  },
  { id: 'r4', title: 'Docs refresh', cells: { status: <StatusBadge status="paused" size="xs" /> } },
]

export function TreeTableStory() {
  return (
    <div className="w-[520px]">
      <TreeTable
        label="Tasks"
        rows={FIXTURE_TREE}
        columns={[{ id: 'status', header: 'Status', width: 160 }]}
        defaultExpandedIds={['r1']}
      />
    </div>
  )
}

const entry = (id: string, name: string, description: string, component: ComponentEntry['component'], props: ComponentEntry['props'] = [], variants?: ComponentEntry['variants']): ComponentEntry => ({
  id: `w1-08-${id}`,
  name,
  category: 'Entity Lists',
  level: 'Primitives',
  description,
  component,
  layout: 'centered',
  props,
  ...(variants ? { variants } : {}),
})

const STATE_VARIANTS = [
  { name: 'OK', props: { state: 'ok' } },
  { name: 'Restricted («Нет доступа»)', props: { state: 'restricted' } },
  { name: 'Deleted', props: { state: 'tombstone' } },
  { name: 'Unavailable', props: { state: 'unavailable' } },
  { name: 'Loading', props: { state: 'loading' } },
]

export const entityPrimitiveComponents: ComponentEntry[] = [
  entry('entity-chip', 'EntityChip', 'Inline entity reference: icon + title, restricted/deleted states, drag source, row menu.', EntityChipStory, [STATE_CONTROL], STATE_VARIANTS),
  entry('entity-hover-card', 'EntityHoverCard', '360 px preview after 300 ms hover (entities.previews.v1).', EntityHoverCardStory, [STATE_CONTROL], STATE_VARIANTS),
  entry('entity-card', 'EntityCard', 'Preview-driven card used for ![[kind:id]] embeds.', EntityCardStory, [STATE_CONTROL], STATE_VARIANTS),
  entry('entity-picker', 'EntityPicker', '«Связать элемент Rox…»: search, kind filters, recents, literal refs.', EntityPickerStory, [
    { name: 'initialQuery', description: 'Initial query', control: { type: 'string' }, defaultValue: 'task:42' },
  ]),
  entry('backlinks', 'BacklinksPanel', '«Упоминается в»: backlinks grouped by kind with relation labels.', BacklinksStory, [
    { name: 'empty', description: 'No backlinks', control: { type: 'boolean' }, defaultValue: false },
  ]),
  entry('status-badge', 'StatusBadge', 'Glyph + text status (never colour-only).', StatusBadgeStory),
  entry('progress', 'ProgressBar / PieProgress', 'Linear and pie progress.', ProgressStory, [
    { name: 'done', control: { type: 'number', min: 0, max: 10, step: 1 }, defaultValue: 3 },
    { name: 'total', control: { type: 'number', min: 0, max: 10, step: 1 }, defaultValue: 5 },
  ]),
  entry('person-field', 'PersonField', 'Champion / Reviewer picker with ⓘ help.', PersonFieldStory),
  entry('contextual-date', 'ContextualDatePicker', 'Day / Month / Quarter / Year date with precision.', ContextualDateStory),
  entry('privacy-field', 'PrivacyField', 'Space / company / link access levels.', PrivacyFieldStory),
  entry('reactions', 'ReactionsBar', 'Reaction chips with a quick palette.', ReactionsStory),
  entry('comments', 'CommentsThread', 'Threaded comments with edit/delete and reactions.', CommentsStory),
  entry('activity', 'ActivityTimeline', 'Day-grouped activity with per-type renderers.', ActivityStory),
  entry('subscribers', 'SubscribersPicker', 'Facepile + subscriber dialog.', SubscribersStory),
  entry('gantt', 'GanttView', 'Timeline shell with zoom, today marker and keyboard/drag reschedule.', GanttStory, [
    { name: 'zoom', control: { type: 'select', options: [{ label: 'week', value: 'week' }, { label: 'month', value: 'month' }, { label: 'quarter', value: 'quarter' }] }, defaultValue: 'week' },
  ]),
  entry('tree-table', 'TreeTable', 'Hierarchical treegrid with keyboard navigation.', TreeTableStory),
]
