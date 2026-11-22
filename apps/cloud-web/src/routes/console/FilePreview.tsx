import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, EmptyState, Icon, Skeleton } from '@/components'
import { api } from '@/lib/api'
import type { FileEntry } from '@/lib/api'
import { formatBytes, formatDate } from '@/lib/format'

import CodeEditor, { CodeView } from './CodeEditor'
import { errorText } from './components/console-ui'

import './file-preview.css'

/** Above one megabyte the file is not read as text; the browser only saves it. */
const MAX_TEXT_BYTES = 1024 * 1024

/** Exact UTF-8 length without building a byte array on every keystroke. */
function utf8Length(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdfff) {
      const low = text.charCodeAt(index + 1)
      if (code <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        // A lone surrogate is written as the three-byte replacement character.
        bytes += 3
      }
    } else bytes += 3
  }
  return bytes
}

type Guard = { kind: 'close' } | { kind: 'switch'; entry: FileEntry | null } | { kind: 'pick'; file: File }

export interface FilePreviewProps {
  sandboxId: string
  entry: FileEntry | null
  enabled: boolean
  onClose: () => void
  /** Called with the entry whose size and time changed, so the list keeps up. */
  onSaved?: (entry: FileEntry) => void
}

/**
 * The right-hand inspector: one file at a time, read first and editable on
 * request. It never writes an empty body to a file that was not read, so a
 * failed read cannot wipe a file, and it asks before dropping unsaved edits.
 */
export default function FilePreview(props: FilePreviewProps): JSX.Element {
  const [shown, setShown] = createSignal<FileEntry | null>(null)
  const [content, setContent] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [uploading, setUploading] = createSignal(false)
  const [downloading, setDownloading] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [tooLarge, setTooLarge] = createSignal(false)
  const [guard, setGuard] = createSignal<Guard | null>(null)

  let requestToken = 0
  let fileInput: HTMLInputElement | undefined
  let copiedTimer: number | undefined

  const dirty = (): boolean => editing() && content() !== null && draft() !== content()
  const current = (): FileEntry | null => shown() ?? props.entry

  const load = async (entry: FileEntry): Promise<void> => {
    const token = ++requestToken
    setLoading(true)
    setError(null)
    setEditing(false)
    setSaved(false)
    setContent(null)
    setDraft('')
    setTooLarge(false)
    try {
      const text = await api.readFile(props.sandboxId, entry.path)
      if (token !== requestToken) return
      if (text.includes('\u0000')) {
        setError('Похоже, это двоичный файл. Такие файлы здесь не показываем и не правим.')
        return
      }
      setContent(text)
      setDraft(text)
    } catch (failure) {
      if (token !== requestToken) return
      setError(`Файл не прочитан: ${errorText(failure)}`)
    } finally {
      if (token === requestToken) setLoading(false)
    }
  }

  const applyEntry = (next: FileEntry | null): void => {
    requestToken += 1
    setShown(next)
    setGuard(null)
    setContent(null)
    setDraft('')
    setError(null)
    setEditing(false)
    setSaved(false)
    setCopied(false)
    setTooLarge(false)
    if (next === null) {
      setLoading(false)
      return
    }
    if (next.size > MAX_TEXT_BYTES) {
      setLoading(false)
      setTooLarge(true)
      return
    }
    void load(next)
  }

  createEffect(
    on(
      () => props.entry,
      (next) => {
        const pendingGuard = guard()
        if (pendingGuard !== null && pendingGuard.kind === 'pick') return
        const active = shown()
        if (active === null) {
          if (next !== null) applyEntry(next)
          return
        }
        if (next === null) {
          if (dirty()) {
            setGuard({ kind: 'switch', entry: null })
            return
          }
          applyEntry(null)
          return
        }
        if (next.path === active.path) {
          const staleGuard = guard()
          if (staleGuard !== null && staleGuard.kind === 'switch') setGuard(null)
          return
        }
        if (dirty()) {
          setGuard({ kind: 'switch', entry: next })
          return
        }
        applyEntry(next)
      },
    ),
  )

  onMount(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    onCleanup(() => window.removeEventListener('beforeunload', beforeUnload))
  })

  onCleanup(() => {
    requestToken += 1
    clearTimeout(copiedTimer)
  })

  const notifySaved = (entry: FileEntry): void => {
    setShown(entry)
    setSaved(true)
    props.onSaved?.(entry)
  }

  /** Writes the draft over the read file; returns true when the file is on disk. */
  const save = async (notify: boolean): Promise<boolean> => {
    const entry = shown()
    if (entry === null || content() === null || saving() || !props.enabled) return false
    setSaving(true)
    setError(null)
    try {
      const text = draft()
      await api.writeFile(props.sandboxId, entry.path, text)
      setContent(text)
      setEditing(false)
      const next: FileEntry = { ...entry, size: utf8Length(text), modifiedAt: Date.now() }
      if (notify) notifySaved(next)
      else {
        setShown(next)
        setSaved(true)
      }
      return true
    } catch (failure) {
      setError(`Файл не сохранён: ${errorText(failure)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  const finishClose = (): void => {
    setGuard(null)
    setEditing(false)
    setDraft(content() ?? '')
    setSaved(false)
    props.onClose()
  }

  const requestClose = (): void => {
    if (dirty()) {
      setGuard({ kind: 'close' })
      return
    }
    finishClose()
  }

  const download = async (): Promise<void> => {
    const entry = current()
    if (entry === null || downloading()) return
    setDownloading(true)
    setError(null)
    try {
      const blob = await api.downloadFile(props.sandboxId, entry.path)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = entry.name
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (failure) {
      setError(`Файл не скачан: ${errorText(failure)}`)
    } finally {
      setDownloading(false)
    }
  }

  const copy = async (): Promise<void> => {
    const text = content()
    if (text === null) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(copiedTimer)
      copiedTimer = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('Не удалось скопировать текст: браузер не разрешил доступ к буферу.')
    }
  }

  const upload = async (file: File): Promise<void> => {
    const entry = shown()
    if (entry === null || uploading() || !props.enabled) return
    setUploading(true)
    setError(null)
    try {
      const slash = entry.path.lastIndexOf('/')
      const directory = slash === -1 ? '' : entry.path.slice(0, slash)
      const path = directory.length === 0 ? file.name : `${directory}/${file.name}`
      await api.writeFile(props.sandboxId, path, file)
      const next: FileEntry = {
        name: file.name,
        path,
        isDir: false,
        size: file.size,
        modifiedAt: Date.now(),
      }
      applyEntry(next)
      setSaved(true)
      props.onSaved?.(next)
    } catch (failure) {
      setError(`Файл не загружен: ${errorText(failure)}`)
    } finally {
      setUploading(false)
    }
  }

  const acceptFile = (file: File | null): void => {
    if (file === null || shown() === null) return
    if (dirty()) {
      setGuard({ kind: 'pick', file })
      return
    }
    void upload(file)
  }

  const resolveGuard = async (choice: 'save' | 'discard' | 'stay'): Promise<void> => {
    const pendingGuard = guard()
    if (pendingGuard === null) return
    if (choice === 'stay') {
      setGuard(null)
      const active = shown()
      // Re-select the file the panel still shows, undoing the outside switch.
      if (active !== null) props.onSaved?.(active)
      return
    }
    if (choice === 'save' && dirty()) {
      const done = await save(pendingGuard.kind === 'pick')
      if (!done) return
    }
    setGuard(null)
    if (pendingGuard.kind === 'close') {
      finishClose()
      return
    }
    if (pendingGuard.kind === 'switch') {
      applyEntry(pendingGuard.entry)
      return
    }
    void upload(pendingGuard.file)
  }

  const guardQuestion = createMemo(() => {
    const pendingGuard = guard()
    if (pendingGuard === null) return ''
    if (pendingGuard.kind === 'close') return 'Есть несохранённые изменения. Закрыть файл?'
    if (pendingGuard.kind === 'pick') return 'Есть несохранённые изменения. Загрузить выбранный файл?'
    if (pendingGuard.entry === null) return 'Есть несохранённые изменения. Закрыть файл?'
    return 'Есть несохранённые изменения. Открыть другой файл?'
  })

  return (
    <section class="file-preview" aria-label="Содержимое файла">
      <header class="file-preview-head">
        <span class="file-preview-title">
          <Icon name="file" size={14} /> Файл
        </span>
        <Show when={current() !== null}>
          <div class="file-preview-tools">
            <Show when={content() !== null && !editing()}>
              <button type="button" class="file-preview-tool" onClick={() => void copy()}>
                {copied() ? 'Скопировано' : 'Копировать'}
              </button>
            </Show>
            <Show when={content() !== null && !editing()}>
              <button
                type="button"
                class="file-preview-tool"
                onClick={() => {
                  setSaved(false)
                  setEditing(true)
                }}
                disabled={!props.enabled}
              >
                Изменить
              </button>
            </Show>
            <button
              type="button"
              class="file-preview-tool"
              onClick={() => fileInput?.click()}
              disabled={!props.enabled || uploading() || saving()}
              title="Файл с тем же именем заменит текущий, с другим — появится рядом."
            >
              {uploading() ? 'Загрузка…' : 'Загрузить'}
            </button>
            <button
              type="button"
              class="file-preview-tool"
              onClick={() => void download()}
              disabled={downloading()}
            >
              {downloading() ? 'Скачивание…' : 'Скачать'}
            </button>
            <button
              type="button"
              class="file-preview-tool"
              onClick={() => requestClose()}
              aria-label="Закрыть файл"
            >
              Закрыть
            </button>
            <input
              ref={fileInput}
              type="file"
              class="file-preview-file"
              onChange={(event) => {
                const input = event.currentTarget
                const file = input.files?.[0] ?? null
                input.value = ''
                acceptFile(file)
              }}
              aria-label="Выбрать файл для загрузки"
            />
          </div>
        </Show>
      </header>

      <Show
        when={current()}
        fallback={
          <EmptyState
            icon="file"
            title="Файл не выбран"
            description="Нажмите на файл слева — здесь появится его содержимое."
          />
        }
      >
        {(entry) => (
          <>
            <div class="file-preview-name">
              <strong>{entry().name}</strong>
              <span title={entry().path}>{entry().path}</span>
            </div>
            <div class="file-preview-meta">
              <span>{formatBytes(entry().size)}</span>
              <Show when={entry().modifiedAt !== null}>
                <span>изменён {formatDate(entry().modifiedAt)}</span>
              </Show>
              <Show when={dirty()}>
                <span class="file-preview-dirty">не сохранено</span>
              </Show>
              <Show when={saved()}>
                <span class="file-preview-saved" role="status">
                  Сохранено
                </span>
              </Show>
            </div>

            <Show when={guard() !== null}>
              <div class="file-preview-guard" role="group" aria-label="Несохранённые изменения">
                <span>{guardQuestion()}</span>
                <div class="file-preview-guard-actions">
                  <Show when={props.enabled && content() !== null}>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={saving()}
                      onClick={() => void resolveGuard('save')}
                    >
                      Сохранить и продолжить
                    </Button>
                  </Show>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving()}
                    onClick={() => void resolveGuard('discard')}
                  >
                    Не сохранять
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving()}
                    onClick={() => void resolveGuard('stay')}
                  >
                    Остаться
                  </Button>
                </div>
              </div>
            </Show>

            <Show when={error() !== null}>
              <div class="file-preview-error" role="alert">
                {error()}
              </div>
            </Show>

            <div class="file-preview-body">
              <Show
                when={!loading()}
                fallback={
                  <div class="file-preview-loading" aria-live="polite">
                    <Skeleton lines={6} />
                  </div>
                }
              >
                <Show
                  when={editing()}
                  fallback={
                    <Show
                      when={tooLarge()}
                      fallback={
                        <Show
                          when={content() !== null}
                          fallback={<div class="file-preview-empty">Содержимое не прочитано.</div>}
                        >
                          <CodeView code={content() ?? ''} name={entry().name} />
                        </Show>
                      }
                    >
                      <div class="file-preview-large">
                        <p>
                          Файл занимает {formatBytes(entry().size)}. Такие файлы мы не показываем и не
                          правим в браузере — их можно скачать целиком.
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={downloading()}
                          onClick={() => void download()}
                        >
                          Скачать файл
                        </Button>
                      </div>
                    </Show>
                  }
                >
                  <div class="file-preview-edit">
                    <CodeEditor
                      value={draft()}
                      onInput={setDraft}
                      disabled={saving() || !props.enabled}
                      label={`Содержимое ${entry().name}`}
                    />
                    <div class="file-preview-actions">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={saving()}
                        disabled={content() === null || !props.enabled}
                        onClick={() => void save(true)}
                      >
                        Сохранить
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={saving()}
                        onClick={() => {
                          setDraft(content() ?? '')
                          setEditing(false)
                          setError(null)
                        }}
                      >
                        Отмена
                      </Button>
                      <span class="file-preview-count">
                        {draft().length} символов, {utf8Length(draft())} Б
                      </span>
                    </div>
                  </div>
                </Show>
              </Show>
            </div>
          </>
        )}
      </Show>
    </section>
  )
}
