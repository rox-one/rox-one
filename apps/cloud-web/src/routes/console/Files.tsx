import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, Dialog, EmptyState, Icon, Select, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { FileEntry } from '@/lib/api'
import { formatBytes, formatDate } from '@/lib/format'

import { errorText } from './components/console-ui'

import './files.css'

/** The customer's home inside the machine. API calls use this real path; labels
 * show `~`. */
export const SANDBOX_HOME = '/home/rox'

/** An older image or session may still hand back the previous home; it is the
 * same place for the person, so it also reads as `~`. */
const LEGACY_HOME = '/home/daytona'

/** The home spelling a path sits under, if any. */
function homePrefix(path: string): string | null {
  for (const home of [SANDBOX_HOME, LEGACY_HOME]) {
    if (path === home || path.startsWith(`${home}/`)) return home
  }
  return null
}

/** `~` for the home and `~/…` below it; any other absolute path is shown as is. */
export function displayPath(path: string): string {
  const home = homePrefix(path)
  if (home === null) return path
  return home === path ? '~' : `~${path.slice(home.length)}`
}

/** The preview panel announces a deleted file so the browser reloads its rows. */
export const FILES_CHANGED_EVENT = 'rox:files-changed'

export interface FilesChangedDetail {
  sandboxId: string
  path: string
}

export function announceFileDeleted(sandboxId: string, path: string): void {
  window.dispatchEvent(
    new CustomEvent<FilesChangedDetail>(FILES_CHANGED_EVENT, { detail: { sandboxId, path } }),
  )
}

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

/**
 * Files the machine keeps for itself. They never appear in the list, not even
 * when the other dotfiles are shown.
 */
const MACHINE_HIDDEN: Record<string, true> = {
  '.rox-identity-v1': true,
  '.rox': true,
  '.daytona': true,
  '.face': true,
  '.face.icon': true,
}

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
  const home = homePrefix(path)
  if (home === null) {
    return [{ label: '/', path: '/' }, ...path.split('/').filter((part) => part.length > 0).map((part, index, parts) => ({
      label: part,
      path: `/${parts.slice(0, index + 1).join('/')}`,
    }))]
  }
  const rest = path.slice(home.length).split('/').filter((part) => part.length > 0)
  const out: Crumb[] = [{ label: '~', path: SANDBOX_HOME }]
  let current = SANDBOX_HOME
  for (const part of rest) {
    current = `${current}/${part}`
    out.push({ label: part, path: current })
  }
  return out
}

function parentOf(path: string): string {
  if (path === SANDBOX_HOME || path === LEGACY_HOME) return SANDBOX_HOME
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')
  if (cut <= 0) return '/'
  const parent = path.slice(0, cut)
  return parent.length === 0 ? '/' : parent
}

/**
 * A directory browser over the machine's own file listing. A folder opens on
 * click; a file is handed to the preview panel, so the browser never loads a
 * file it was not asked to show. Files can be deleted here and in the preview;
 * folders cannot, so a single click never removes a tree. Dotfiles are listed by
 * default, except the names the machine keeps for itself.
 */
export default function Files(props: FilesProps): JSX.Element {
  const [path, setPath] = createSignal(SANDBOX_HOME)
  const [entries, setEntries] = createSignal<FileEntry[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [query, setQuery] = createSignal('')
  const [sort, setSort] = createSignal<SortKey>('name')
  const [showHidden, setShowHidden] = createSignal(true)
  const [pendingDelete, setPendingDelete] = createSignal<FileEntry | null>(null)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal(false)

  let requestToken = 0

  const hiddenCount = createMemo(
    () =>
      entries().filter(
        (entry) => MACHINE_HIDDEN[entry.name] !== true && entry.name.startsWith('.'),
      ).length,
  )

  const visible = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase('ru')
    const allowed = entries().filter(
      (entry) =>
        MACHINE_HIDDEN[entry.name] !== true && (showHidden() || !entry.name.startsWith('.')),
    )
    const rows =
      needle.length === 0
        ? [...allowed]
        : allowed.filter((entry) => entry.name.toLocaleLowerCase('ru').includes(needle))
    return rows.sort(compareEntries(sort()))
  })

  /** «Скрытые» is a filter, so its tooltip says what the next press does. */
  const hiddenHint = createMemo(() => {
    const count = hiddenCount()
    if (showHidden()) {
      return count > 0
        ? `Скрытые файлы и папки видны: ${count}. Спрятать`
        : 'Скрытые файлы и папки видны'
    }
    return count > 0
      ? `Показать скрытые файлы и папки: ${count}`
      : 'Скрытых файлов и папок нет'
  })

  const hasQuery = createMemo(() => query().trim().length > 0)

  /** Everything in the folder is a dotfile, so an empty list needs an explanation. */
  const hiddenOnly = createMemo(
    () => !showHidden() && hiddenCount() > 0 && visible().length === 0,
  )

  const emptyTitle = createMemo(() => {
    if (error() !== null) return 'Каталог не открылся'
    if (hasQuery()) return 'Ничего не найдено'
    if (hiddenOnly()) return 'Только скрытое'
    return 'Пусто'
  })

  const emptyDescription = createMemo(() => {
    const failure = error()
    if (failure !== null) return failure
    if (hasQuery()) return `По запросу «${query().trim()}» ничего не найдено.`
    if (hiddenOnly()) {
      return `Здесь ${hiddenCount()} скрытых файлов и папок. Включите «Скрытые», чтобы их увидеть.`
    }
    return 'В этом каталоге нет файлов и папок.'
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

  const closeDelete = (): void => {
    setPendingDelete(null)
    setDeleteError(null)
  }

  const confirmDelete = async (): Promise<void> => {
    const entry = pendingDelete()
    if (entry === null || deleting() || !props.enabled) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteFile(props.sandboxId, entry.path)
      setPendingDelete(null)
      // The browser and the preview both listen, so one announcement reloads the
      // rows and closes the preview of the file that is gone.
      announceFileDeleted(props.sandboxId, entry.path)
    } catch (failure) {
      // The confirmation stays open, so the refusal is read where it happened.
      setDeleteError(`Файл не удалён: ${errorText(failure)}`)
    } finally {
      setDeleting(false)
    }
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
        setPendingDelete(null)
        props.onSelect(null)
        void load(SANDBOX_HOME)
      },
    ),
  )

  // The preview deletes files too; it announces the path, so rows drop without
  // either panel knowing the other's state.
  onMount(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<FilesChangedDetail | undefined>).detail
      if (detail === undefined || detail.sandboxId !== props.sandboxId) return
      if (props.selectedPath === detail.path) props.onSelect(null)
      if (props.enabled) void load()
    }
    window.addEventListener(FILES_CHANGED_EVENT, listener)
    onCleanup(() => window.removeEventListener(FILES_CHANGED_EVENT, listener))
  })

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
          <button
            type="button"
            class="files-tool files-hidden-toggle"
            aria-pressed={showHidden() ? 'true' : 'false'}
            aria-label="Показывать скрытые файлы и папки"
            title={hiddenHint()}
            onClick={() => setShowHidden(!showHidden())}
          >
            Скрытые
          </button>
          <Select
            class="files-sort"
            options={SORT_OPTIONS}
            value={sort()}
            aria-label="Сортировка файлов"
            onChange={(event) => setSort(event.currentTarget.value as SortKey)}
          />
        </div>

        <div class="files-list">
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
              <div class="files-rows" role="list" aria-label={`Содержимое ${displayPath(path())}`}>
                <For each={visible()}>
                  {(entry) => (
                    <div
                      class="files-item"
                      classList={{ 'is-selected': props.selectedPath === entry.path }}
                      role="listitem"
                    >
                      <button
                        type="button"
                        class="files-row"
                        aria-current={props.selectedPath === entry.path ? 'true' : undefined}
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
                      <Show when={!entry.isDir}>
                        <button
                          type="button"
                          class="files-row-delete"
                          aria-label={`Удалить ${entry.name}`}
                          title="Удалить файл"
                          onClick={() => {
                            setDeleteError(null)
                            setPendingDelete(entry)
                          }}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
        <Show when={error() !== null && visible().length > 0}>
          <div class="files-error" role="alert">
            {error()}
          </div>
        </Show>
      </Show>

      <Dialog
        open={pendingDelete() !== null}
        onClose={() => closeDelete()}
        title="Удалить файл?"
        subtitle={displayPath(pendingDelete()?.path ?? '')}
        footer={
          <>
            <Button variant="ghost" onClick={() => closeDelete()} disabled={deleting()}>
              Отмена
            </Button>
            <Button variant="danger" loading={deleting()} onClick={() => void confirmDelete()}>
              Удалить
            </Button>
          </>
        }
      >
        <p>
          Файл пропадёт с машины, и вернуть его будет нельзя. Папки этим действием не удаляются.
        </p>
        <Show when={deleteError() !== null}>
          <div class="files-error" role="alert">
            {deleteError()}
          </div>
        </Show>
      </Dialog>
    </section>
  )
}
