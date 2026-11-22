import { Show, createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, CodeBlock, EmptyState, Icon, Skeleton, Textarea } from '@/components'
import { api } from '@/lib/api'
import type { FileEntry } from '@/lib/api'
import { formatBytes, formatDate } from '@/lib/format'

import { errorText } from './components/console-ui'

import './file-preview.css'

export interface FilePreviewProps {
  sandboxId: string
  entry: FileEntry | null
  enabled: boolean
  onClose: () => void
}

/**
 * The right-hand inspector: one file at a time, read first and editable on
 * request. It never writes an empty body to a file that was not read, so a
 * failed read cannot wipe a file.
 */
export default function FilePreview(props: FilePreviewProps): JSX.Element {
  const [content, setContent] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)

  let requestToken = 0

  const load = async (entry: FileEntry): Promise<void> => {
    const token = ++requestToken
    setLoading(true)
    setError(null)
    setEditing(false)
    setSaved(false)
    setContent(null)
    setDraft('')
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

  createEffect(
    on(
      () => props.entry?.path ?? '',
      (path) => {
        const entry = props.entry
        if (path.length === 0 || entry === null) {
          setContent(null)
          setDraft('')
          setError(null)
          setEditing(false)
          return
        }
        void load(entry)
      },
    ),
  )

  onCleanup(() => {
    requestToken += 1
  })

  const save = async (): Promise<void> => {
    const entry = props.entry
    if (entry === null || content() === null || saving()) return
    setSaving(true)
    setError(null)
    try {
      await api.writeFile(props.sandboxId, entry.path, draft())
      setContent(draft())
      setEditing(false)
      setSaved(true)
    } catch (failure) {
      setError(`Файл не сохранён: ${errorText(failure)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section class="file-preview" aria-label="Содержимое файла">
      <header class="file-preview-head">
        <span class="file-preview-title">
          <Icon name="file" size={14} /> Файл
        </span>
        <Show when={props.entry !== null}>
          <div class="file-preview-tools">
            <Show when={content() !== null && !editing()}>
              <button
                type="button"
                class="file-preview-tool"
                onClick={() => setEditing(true)}
                disabled={!props.enabled}
              >
                Изменить
              </button>
            </Show>
            <button
              type="button"
              class="file-preview-tool"
              onClick={() => props.onClose()}
              aria-label="Закрыть файл"
            >
              Закрыть
            </button>
          </div>
        </Show>
      </header>

      <Show
        when={props.entry}
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
              <Show when={saved()}>
                <span class="file-preview-saved" role="status">
                  Сохранено
                </span>
              </Show>
            </div>

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
                      when={content() !== null}
                      fallback={<div class="file-preview-empty">Содержимое не прочитано.</div>}
                    >
                      <CodeBlock code={content() ?? ''} label={entry().name} class="file-preview-code" />
                    </Show>
                  }
                >
                  <div class="file-preview-edit">
                    <Textarea
                      rows={16}
                      value={draft()}
                      disabled={saving()}
                      aria-label={`Содержимое ${entry().name}`}
                      onInput={(event) => setDraft(event.currentTarget.value)}
                    />
                    <div class="file-preview-actions">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={saving()}
                        disabled={content() === null}
                        onClick={() => void save()}
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
                      <span class="file-preview-count">{draft().length} символов</span>
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
