import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { JSX } from 'solid-js'

import { EmptyState, Icon, Select, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { FileEntry } from '@/lib/api'
import { formatBytes, formatDate } from '@/lib/format'

import { errorText } from './components/console-ui'

import './files.css'

/** The sandbox user's home; `/root` is not readable there, so never start in it. */
export const SANDBOX_HOME = '/home/daytona'

export interface FilesProps {
  sandboxId: string
  /** Reading and writing go through the machine's toolbox: it must be running. */
  enabled: boolean
  reason?: string
  /** The file the preview panel is showing, so the row can stay highlighted. */
  selectedPath?: string | null
  onSelect: (entry: FileEntry | null) => void
}

interface Crumb {
  label: string
  path: string
}

type SortKey = 'name' | 'size' | 'modified'

const SORT_OPTIONS = [
  { value: 'name', label: 'По имени' },
  { value: 'size', label: 'По размеру' },
  { value: 'modified', label: 'По изменению' },
] as const

/** Name sort keeps folders in their own group; the other sorts interleave them. */
function compareEntries(mode: SortKey) {
  return (left: FileEntry, right: FileEntry): number => {
    if (mode === 'name') {
      return (
        Number(right.isDir) - Number(left.isDir) ||
        left.name.localeCompare(right.name, 'ru')
      )
    }
    if (mode === 'size') {
      return right.size - left.size || left.name.localeCompare(right.name, 'ru')
    }
    const leftAt = left.modifiedAt ?? 0
    const rightAt = right.modifiedAt ?? 0
    return rightAt - leftAt || left.name.localeCompare(right.name, 'ru')
  }
}

/** `~` for the home, then the path below it; any other absolute path is shown plainly. */
function crumbs(path: string): Crumb[] {
  if (!path.startsWith(SANDBOX_HOME)) {
    return [{ label: '/', path: '/' }, ...path.split('/').filter((part) => part.length > 0).map((part, index, parts) => ({
      label: part,
      path: `/${parts.slice(0, index + 1).join('/')}`,
    }))]
  }
  const rest = path.slice(SANDBOX_HOME.length).split('/').filter((part) => part.length > 0)
  const out: Crumb[] = [{ label: '~', path: SANDBOX_HOME }]
  let current = SANDBOX_HOME
  for (const part of rest) {
    current = `${current}/${part}`
    out.push({ label: part, path: current })
  }
  return out
}

function parentOf(path: string): string {
  if (path === SANDBOX_HOME) return SANDBOX_HOME
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  if (cut <= 0) return '/'
  const parent = path.slice(0, cut)
  return parent.length === 0 ? '/' : parent
}

/**
 * A directory browser over the machine's own file listing. A folder opens on
 * click; a file is handed to the preview panel, so the browser never loads a
 * file it was not asked to show.
 */
export default function Files(props: FilesProps): JSX.Element {
  const [path, setPath] = createSignal(SANDBOX_HOME)
  const [entries, setEntries] = createSignal<FileEntry[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [query, setQuery] = createSignal('')
  const [sort, setSort] = createSignal<SortKey>('name')

  let requestToken = 0

  const visible = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase('ru')
    const rows =
      needle.length === 0
        ? [...entries()]
        : entries().filter((entry) => entry.name.toLocaleLowerCase('ru').includes(needle))
    return rows.sort(compareEntries(sort()))
  })

  const hasQuery = createMemo(() => query().trim().length > 0)

  const emptyTitle = createMemo(() => {
    if (error() !== null) return 'Каталог не открылся'
    if (hasQuery()) return 'Ничего не найдено'
    return 'Пусто'
  })

  const emptyDescription = createMemo(() => {
    const failure = error()
    if (failure !== null) return failure
    return hasQuery()
      ? `По запросу «${query().trim()}» ничего не найдено.`
      : 'В этом каталоге нет файлов и папок.'
  })

  /** Folders keep their own label so a mixed size or time sort still marks them. */
  const metaFor = (entry: FileEntry): string => {
    if (entry.isDir) return 'папка'
    return sort() === 'modified' ? formatDate(entry.modifiedAt) : formatBytes(entry.size)
  }

  const load = async (target = path()): Promise<void> => {
    if (!props.enabled) return
    const token = ++requestToken
    setLoading(true)
    setError(null)
    try {
      const listing = await api.listFiles(props.sandboxId, target)
      if (token !== requestToken) return
      setEntries(listing)
    } catch (failure) {
      if (token !== requestToken) return
      setEntries([])
      setError(`Каталог не открылся: ${errorText(failure)}`)
    } finally {
      if (token === requestToken) setLoading(false)
    }
  }

  const go = (target: string): void => {
    setPath(target)
    setQuery('')
    props.onSelect(null)
    void load(target)
  }

  // A memo with primitive equality keeps the effect from re-running when a
  // parent poll hands over a new machine object with the same id and state.
  const resetKey = createMemo(() => `${props.sandboxId}:${props.enabled}`)
  createEffect(
    on(
      resetKey,
      () => {
        setPath(SANDBOX_HOME)
        setEntries([])
        setError(null)
        setQuery('')
        props.onSelect(null)
        void load(SANDBOX_HOME)
      },
    ),
  )


  return (
    <section class="files" aria-label="Файлы машины">
      <header class="files-head">
        <span class="files-title">
          <Icon name="folder" size={14} /> Файлы
        </span>
        <div class="files-tools">
          <button
            type="button"
            class="files-tool"
            disabled={!props.enabled || loading() || path() === SANDBOX_HOME}
            onClick={() => go(parentOf(path()))}
            title="На уровень выше"
          >
            Вверх
          </button>
          <button
            type="button"
            class="files-tool"
            disabled={!props.enabled || loading()}
            onClick={() => void load()}
          >
            Обновить
          </button>
        </div>
      </header>

      <nav class="files-crumbs" aria-label="Текущий каталог">
        <For each={crumbs(path())}>
          {(crumb, index) => (
            <>
              <Show when={index() > 0}>
                <span class="files-crumb-sep" aria-hidden="true">
                  /
                </span>
              </Show>
              <button
                type="button"
                class="files-crumb"
                disabled={!props.enabled || loading()}
                onClick={() => go(crumb.path)}
              >
                {crumb.label}
              </button>
            </>
          )}
        </For>
      </nav>

      <Show when={!props.enabled}>
        <div class="files-blocked" role="status">
          {props.reason ?? 'Файлы доступны только на запущенной машине.'}
        </div>
      </Show>

      <Show when={props.enabled}>
        <div class="files-filter">
          <input
            type="search"
            class="input files-search"
            value={query()}
            placeholder="Поиск по имени"
            aria-label="Поиск файла по имени"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <Select
            class="files-sort"
            options={SORT_OPTIONS}
            value={sort()}
            aria-label="Сортировка файлов"
            onChange={(event) => setSort(event.currentTarget.value as SortKey)}
          />
        </div>

        <div class="files-list" role="listbox" aria-label={`Содержимое ${path()}`}>
          <Show
            when={!loading()}
            fallback={
              <div class="files-skeleton" aria-live="polite">
                <Skeleton lines={5} />
              </div>
            }
          >
            <Show
              when={visible().length > 0}
              fallback={
                <EmptyState
                  icon="folder"
                  title={emptyTitle()}
                  description={emptyDescription()}
                />
              }
            >
              <For each={visible()}>
                {(entry) => (
                  <button
                    type="button"
                    class="files-row"
                    classList={{ 'is-selected': props.selectedPath === entry.path }}
                    role="option"
                    aria-selected={props.selectedPath === entry.path ? 'true' : 'false'}
                    onClick={() => {
                      if (entry.isDir) go(entry.path)
                      else props.onSelect(entry)
                    }}
                  >
                    <span class="files-row-icon" aria-hidden="true">
                      <Icon name={entry.isDir ? 'folder' : 'file'} size={15} />
                    </span>
                    <span class="files-name">{entry.name}</span>
                    <span class="files-meta">{metaFor(entry)}</span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
        <Show when={error() !== null && visible().length > 0}>
          <div class="files-error" role="alert">
            {error()}
          </div>
        </Show>
      </Show>
    </section>
  )
}
