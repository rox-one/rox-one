import * as React from 'react'
import { Bell, FileText, Inbox, LayoutGrid, Rows3, Search, Sparkles, Table2, Terminal, Type } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'

/**
 * Glass surface-vocabulary gallery (legacy Arc Glass Design fixtures).
 *
 * Mock screen for slot vocabulary (panel, toolbar, card, …) in the playground
 * preview. Arc Glass content surfaces CSS was removed; Arc Glass theme remains
 * selectable as wallpaper-only. Optional chrome accents live in arc-glass-skin.css
 * under SE (`data-glass-accents`). This file only tags roots for local preview —
 * no IPC/store/network. Third card uses `data-glass-state="hover"` for screenshots.
 */

interface NavRow {
  id: string
  label: string
  icon: LucideIcon
  badge?: string
}

const NAV_ROWS: NavRow[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'sessions', label: 'Sessions', icon: Rows3 },
  { id: 'inbox', label: 'Inbox', icon: Inbox, badge: '3' },
  { id: 'notes', label: 'Notes', icon: FileText },
]

const TABLE_ROWS = [
  { id: 'run-1042', name: 'Nightly index', state: 'Succeeded', duration: '1m 12s' },
  { id: 'run-1043', name: 'Embedding backfill', state: 'Running', duration: '4m 08s' },
  { id: 'run-1044', name: 'Workspace snapshot', state: 'Queued', duration: '—' },
] as const

function GlassButton({
  className,
  leading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { leading?: React.ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border border-border-subtle px-2 py-1 text-small text-foreground transition-colors hover:bg-surface-hover',
        className,
      )}
      {...props}
    >
      {leading}
      {children}
    </button>
  )
}

function GlassSurfacesGallery() {
  const [selectedRow, setSelectedRow] = React.useState<string | null>('run-1043')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [toastOpen, setToastOpen] = React.useState(false)

  // The app installs the glass skin from renderer/main.tsx; the playground entry
  // does not, so this gallery — the material's own fixture — installs it lazily.
  // installGlassSkin() is idempotent and fires its own un-awaited CSS imports.
  React.useEffect(() => {
    void import('@rox/ui/glass/install')
      .then((mod) => mod.installGlassSkin())
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    if (!toastOpen) return
    const timer = window.setTimeout(() => setToastOpen(false), 4500)
    return () => window.clearTimeout(timer)
  }, [toastOpen])

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-gradient-to-br from-accent/10 via-background to-background text-foreground">
      {/* panel — rail inside content */}
      <aside data-glass-slot="panel" className="flex w-56 shrink-0 flex-col gap-1 p-3">
        <p className="px-2 pb-1 text-caption uppercase text-muted-foreground">Surface vocabulary</p>
        {NAV_ROWS.map((row) => {
          const Icon = row.icon
          const active = row.id === 'sessions'
          return (
            <div
              key={row.id}
              data-glass-slot="row"
              data-state={active ? 'selected' : undefined}
              className="flex items-center gap-2 rounded-sm px-2 py-1 text-body"
            >
              <Icon className="icon-toolbar text-muted-foreground" />
              <span className="flex-1 truncate">{row.label}</span>
              {row.badge ? <span className="rounded-full bg-surface-selected px-1 text-caption">{row.badge}</span> : null}
            </div>
          )
        })}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar — sticky header */}
        <header data-glass-slot="toolbar" className="flex items-center gap-2 px-3 py-2">
          <Terminal className="icon-toolbar text-muted-foreground" />
          <span className="text-title-sm font-semibold">Glass Surfaces</span>
          <span className="flex-1" />
          <GlassButton leading={<Search className="icon-toolbar" />}>Search</GlassButton>
          <GlassButton leading={<Bell className="icon-toolbar" />} onClick={() => setToastOpen(true)}>
            Toast
          </GlassButton>
          <GlassButton leading={<Sparkles className="icon-toolbar" />} onClick={() => setDialogOpen(true)}>
            Dialog
          </GlassButton>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          {/* cards — tint + sheen + hairline, hover boosts the sheen (CSS only) */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { title: 'Card', detail: 'elev-1 tint, top sheen, hairline inset. No blur.' },
              { title: 'Card · stacked', detail: 'Same recipe, mid stack; hairlines separate the three.' },
              { title: 'Card · hover paint', detail: 'Static mirror of the CSS :hover state.' },
            ].map((card, index) => (
              <article
                key={card.title}
                data-glass-slot="card"
                data-glass-state={index === 2 ? 'hover' : undefined}
                className="flex flex-col gap-1 rounded-md p-3"
              >
                <h3 className="text-title-sm font-semibold">{card.title}</h3>
                <p className="text-small text-muted-foreground">{card.detail}</p>
              </article>
            ))}
          </div>

          {/* table — container tint + hairline, rows separated by the grid divider */}
          <section data-glass-slot="table" className="flex flex-col rounded-md p-3">
            <div className="flex items-center gap-2 pb-2">
              <Table2 className="icon-toolbar text-muted-foreground" />
              <h3 className="text-title-sm font-semibold">Recent runs</h3>
            </div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-caption uppercase text-muted-foreground">
                  <th className="py-1 font-medium">Run</th>
                  <th className="py-1 font-medium">State</th>
                  <th className="py-1 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row) => (
                  <tr
                    key={row.id}
                    data-glass-slot="row"
                    aria-selected={selectedRow === row.id}
                    onClick={() => setSelectedRow(row.id)}
                    className="cursor-pointer text-body"
                  >
                    <td className="py-1">{row.name}</td>
                    <td className="py-1 text-muted-foreground">{row.state}</td>
                    <td className="py-1 font-mono text-small tabular-nums">{row.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid grid-cols-2 gap-3">
            {/* empty — soft slab */}
            <section data-glass-slot="empty" className="flex flex-col items-center justify-center gap-2 rounded-lg p-8 text-center">
              <Sparkles className="icon-empty text-muted-foreground" />
              <h3 className="text-title-sm font-semibold">Nothing queued</h3>
              <p className="text-small text-muted-foreground">Empty states are the lightest tint of the family, plus a hairline.</p>
            </section>

            {/* editor — dense, readable fill, no blur */}
            <section data-glass-slot="editor" className="flex flex-col gap-2 rounded-md p-3">
              <div className="flex items-center gap-2">
                <Type className="icon-toolbar text-muted-foreground" />
                <h3 className="text-title-sm font-semibold">Editor</h3>
              </div>
              <p className="text-body text-muted-foreground">
                Reading surfaces keep a dense fill (80% or more) so text stays legible over the wallpaper. No blur, only a tint and a
                top sheen.
              </p>
            </section>
          </div>
        </div>
      </div>

      {/* dialog — blur + elev-3 shadow + hairline; plain local state */}
      {dialogOpen ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60 p-6">
          <div role="dialog" aria-label="Glass dialog" data-glass-slot="dialog" className="w-80 rounded-lg p-4">
            <h3 className="text-title-sm font-semibold">Glass dialog</h3>
            <p className="pt-1 text-small text-muted-foreground">
              Floating surfaces blur, lift on the elev-3 shadow and draw a hairline edge.
            </p>
            <div className="flex justify-end gap-2 pt-4">
              <GlassButton onClick={() => setDialogOpen(false)}>Close</GlassButton>
            </div>
          </div>
        </div>
      ) : null}

      {/* toast — same floating material, pop entrance from the skin's keyframes */}
      {toastOpen ? (
        <div data-glass-slot="toast" className="absolute bottom-3 right-3 w-72 rounded-lg p-3">
          <h3 className="text-title-sm font-semibold">Toast</h3>
          <p className="pt-1 text-small text-muted-foreground">Floating glass, entrance via the shared motion tokens.</p>
        </div>
      ) : null}
    </div>
  )
}

export const glassComponents: ComponentEntry[] = [
  {
    id: 'glass-surfaces-gallery',
    name: 'Glass Surfaces Gallery',
    category: 'Unified Shell',
    level: 'Patterns',
    description: 'Arc Glass screen vocabulary: panel, toolbar, card, table, row, empty, editor, dialog and toast surfaces',
    component: GlassSurfacesGallery,
    props: [],
    variants: [],
    mockData: () => ({}),
    layout: 'full',
  },
]
