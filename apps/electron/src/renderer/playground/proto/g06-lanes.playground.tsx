/**
 * G6 «Пути и линзы» — story: `proto-g06-lanes`.
 *
 * The session list as dense status lanes: grouping, one pinned lane, lane
 * rules that encode status, unread counters, hover quick-actions, j/k
 * traversal, truncation rules and an empty lane.
 */

import * as React from 'react'
import { ListFilter, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { SessionLanes, PROTO_LANES, useProtoQuery } from './g06-parts'
import { cn } from '@/lib/utils'

interface LanesStoryProps {
  selectedId: string
  showGroups: boolean
  startCollapsed: boolean
  comfortable: boolean
}

function LanesStory({ selectedId, showGroups, startCollapsed, comfortable }: LanesStoryProps) {
  const query = useProtoQuery()
  const fromQuery = query.get('selected')
  const [selected, setSelected] = React.useState(fromQuery ?? selectedId)
  const [focused, setFocused] = React.useState<string | undefined>(undefined)
  const [collapsedLanes, setCollapsedLanes] = React.useState<string[]>(startCollapsed ? ['read', 'archive'] : [])
  const [queryText, setQueryText] = React.useState('')

  React.useEffect(() => { if (fromQuery) setSelected(fromQuery) }, [fromQuery])

  return (
    <div className="flex h-[560px] w-[392px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-canvas">
      <div className="flex h-[var(--chrome-panel-header-height)] shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-elevated px-2">
        <span className="text-body font-semibold text-text-primary">Сессии</span>
        <span className="rounded-[var(--radius-control)] bg-surface-hover px-1 text-caption font-medium numeric text-text-secondary">12</span>
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-pressed={showGroups}
            aria-label="Группировать по состоянию"
            className={cn(
              'grid h-7 w-7 place-items-center rounded-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              showGroups ? 'bg-[var(--state-selected-strong)] text-text-primary' : 'text-muted-foreground hover:bg-surface-hover',
            )}
          >
            <ListFilter className="icon-caption" />
          </button>
          <button
            type="button"
            aria-label="Плотность списка"
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <SlidersHorizontal className="icon-caption" />
          </button>
          <button
            type="button"
            aria-label="Новая сессия"
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-accent/12 text-accent-text hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Plus className="icon-caption" />
          </button>
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-border-subtle px-2 py-1.5">
        <Search className="icon-caption text-muted-foreground" />
        <input
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          placeholder="Поиск по сессиям и тексту"
          aria-label="Поиск по сессиям"
          className="min-h-[var(--control-hit-min)] min-w-0 flex-1 bg-transparent text-small text-text-primary placeholder:text-text-disabled focus:outline-none"
        />
        <span className="shrink-0 rounded-[var(--radius-xs)] border border-border-subtle px-1 text-caption numeric text-text-secondary">⌘K</span>
      </div>

      <SessionLanes
        lanes={PROTO_LANES}
        selectedId={selected}
        focusedId={focused}
        onSelect={setSelected}
        onFocus={setFocused}
        showGroupToggle={showGroups}
        collapsedLanes={collapsedLanes}
        onToggleLane={(id) => setCollapsedLanes((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))}
        density={comfortable ? 'comfortable' : 'compact'}
      />

      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-2 py-1 text-caption text-text-secondary">
        <span className="numeric">j / k — перейти</span>
        <span className="numeric">⏎ — открыть</span>
        <span className="ml-auto numeric">⌘⏎ — в панель</span>
      </div>
    </div>
  )
}

export default definePlaygroundStory({
  id: 'proto-g06-lanes',
  name: 'G6 Пути — список сессий',
  category: 'Session List',
  level: 'Patterns',
  description:
    'G6 «Пути»: список сессий как плотные полосы состояния — группировка (закреплённые / требуют ответа / в работе / прочитано / пустой архив), маркеры состояния слева, счётчики непрочитанного, быстрые действия по наведению и обход с клавиатуры.',
  component: LanesStory,
  layout: 'centered',
  previewOverflow: 'hidden',
  props: [
    { name: 'selectedId', description: 'Выбранная сессия', control: { type: 'string' }, defaultValue: 's-01' },
    { name: 'showGroups', description: 'Группировка по состоянию', control: { type: 'boolean' }, defaultValue: true },
    { name: 'startCollapsed', description: 'Свернуть «Прочитано» и «Архив» на старте', control: { type: 'boolean' }, defaultValue: false },
    { name: 'comfortable', description: 'Комфортная плотность', control: { type: 'boolean' }, defaultValue: false },
  ],
  variants: [
    { name: 'Полосы (по умолчанию)', props: {} },
    { name: 'Без группировки', props: { showGroups: false } },
    { name: 'Свернутые полосы', props: { startCollapsed: true } },
    { name: 'Комфортная плотность', props: { comfortable: true } },
  ],
})