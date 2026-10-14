import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GlanceWidgetProps } from '../registry'

export interface TodoItem { id: string; text: string; done: boolean }

export function readTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((i): i is TodoItem => !!i && typeof i === 'object' && typeof (i as TodoItem).id === 'string' && typeof (i as TodoItem).text === 'string')
    .map((i) => ({ id: i.id, text: i.text, done: i.done === true }))
}

export default function TodoWidget({ config, onConfig }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const items = readTodoItems(config.items)
  const [draft, setDraft] = useState('')
  const save = (next: TodoItem[]) => onConfig({ ...config, items: next })
  const add = () => {
    const text = draft.trim()
    if (!text) return
    save([...items, { id: `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text: text.slice(0, 500), done: false }])
    setDraft('')
  }
  return (
    <div className="flex min-h-0 flex-col gap-2" data-glance-todo="">
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('glance.todo.placeholder')}
          aria-label={t('glance.todo.placeholder')}
          className="min-w-0 flex-1 rounded-[var(--radius-control)] bg-surface-hover px-2 py-1 text-sm outline-none focus:bg-surface-pressed"
        />
        <button type="submit" className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-surface-pressed hover:text-foreground" aria-label={t('extraScreens.common.add')}>
          <Plus className="icon-toolbar" />
        </button>
      </form>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t('glance.todo.empty')}</p> : null}
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-surface-hover">
            <input type="checkbox" checked={item.done} onChange={() => save(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))} aria-label={item.text} />
            <span className={cn('min-w-0 flex-1 truncate text-sm', item.done && 'text-muted-foreground line-through')} title={item.text}>{item.text}</span>
            <button type="button" onClick={() => save(items.filter((i) => i.id !== item.id))} className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-foreground" aria-label={t('glance.todo.remove', { name: item.text })}>
              <X className="icon-caption" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
