import { Show, createSignal, createUniqueId } from 'solid-js'
import type { JSX } from 'solid-js'

import { Button, CodeBlock, EmptyState, Field, Textarea } from '@/components'
import { api } from '@/lib/api'

import { errorText } from './components/console-ui'

import './files.css'

/** The sandbox user's home; `/root` is not readable there, so never start in it. */
const SANDBOX_HOME = '/home/daytona'

export interface FilesProps {
  sandboxId: string
  /** Reading and writing go through the machine's toolbox: it must be running. */
  enabled: boolean
  reason?: string
}

/** `1 символ`, `2 символа`, `5 символов`. */
function characters(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  const word =
    mod100 >= 11 && mod100 <= 14
      ? 'символов'
      : mod10 === 1
        ? 'символ'
        : mod10 >= 2 && mod10 <= 4
          ? 'символа'
          : 'символов'
  return `${count} ${word}`
}

/**
 * One file at a time: read a path into a read-only block, edit it in the
 * textarea and write it back. Binary files are refused instead of mangled.
 */
export default function Files(props: FilesProps): JSX.Element {
  const [path, setPath] = createSignal(`${SANDBOX_HOME}/`)
  const [readPath, setReadPath] = createSignal('')
  const [content, setContent] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal('')
  const [reading, setReading] = createSignal(false)
  const [writing, setWriting] = createSignal(false)
  const [readError, setReadError] = createSignal<string | null>(null)
  const [writeError, setWriteError] = createSignal<string | null>(null)
  const [saved, setSaved] = createSignal(false)

  const pathId = createUniqueId()
  const bodyId = createUniqueId()

  // An empty write to a path that was never read could wipe a file we did not
  // see, so an empty draft is allowed only when this path was read.
  const canSave = (): boolean => {
    if (!props.enabled || path().trim().length === 0) return false
    if (draft().length > 0) return true
    return content() !== null && path().trim() === readPath()
  }

  const open = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    if (!props.enabled || reading()) return
    const target = path().trim()
    if (target.length === 0) {
      setReadError(`Укажите путь к файлу, например ${SANDBOX_HOME}/hello.txt.`)
      return
    }
    // The default is the home directory itself; a trailing slash says «каталог»,
    // so ask for a file instead of sending a read that cannot succeed.
    if (target.endsWith('/')) {
      setReadError(`Это каталог. Укажите файл, например ${SANDBOX_HOME}/hello.txt.`)
      return
    }
    setReading(true)
    setReadError(null)
    setWriteError(null)
    setSaved(false)
    try {
      const text = await api.readFile(props.sandboxId, target)
      // File bytes are read as UTF-8 text; a NUL byte means this is not text at all.
      if (text.includes('\u0000')) {
        setContent(null)
        setDraft('')
        setReadPath(target)
        setReadError('Похоже, это двоичный файл. Такие файлы здесь не показываем и не правим.')
        return
      }
      setContent(text)
      setDraft(text)
      setReadPath(target)
    } catch (error) {
      setContent(null)
      setDraft('')
      setReadError(`Не удалось прочитать файл: ${errorText(error)}`)
    } finally {
      setReading(false)
    }
  }

  const save = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault()
    if (!canSave() || writing()) return
    const target = path().trim()
    setWriting(true)
    setWriteError(null)
    setSaved(false)
    try {
      await api.writeFile(props.sandboxId, target, draft())
      setContent(draft())
      setReadPath(target)
      setReadError(null)
      setSaved(true)
    } catch (error) {
      setWriteError(`Не удалось записать файл: ${errorText(error)}`)
    } finally {
      setWriting(false)
    }
  }

  return (
    <section class="files" aria-label="Файлы машины">
      <Show when={!props.enabled}>
        <div class="files-blocked" role="status">
          {props.reason ?? 'Файлы доступны только на запущенной машине.'}
        </div>
      </Show>

      <form class="files-open" onSubmit={(event) => void open(event)}>
        <Field
          label="Путь к файлу"
          for={pathId}
          hint={`Домашний каталог машины — ${SANDBOX_HOME}. Например, ${SANDBOX_HOME}/hello.sh.`}
          error={readError()}
        >
          <input
            id={pathId}
            class="input"
            type="text"
            value={path()}
            placeholder={`${SANDBOX_HOME}/hello.txt`}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            disabled={!props.enabled || reading()}
            aria-invalid={readError() === null ? undefined : 'true'}
            onInput={(event) => {
              setPath(event.currentTarget.value)
              setSaved(false)
            }}
          />
        </Field>
        <Button type="submit" variant="secondary" loading={reading()} disabled={!props.enabled}>
          Прочитать
        </Button>
      </form>

      <Show
        when={content() !== null}
        fallback={
          <EmptyState
            icon="log"
            title="Файл не прочитан"
            description="Введите путь к файлу и нажмите «Прочитать»."
          />
        }
      >
        <CodeBlock code={content() ?? ''} label={readPath()} class="files-code" />
      </Show>

      <form class="files-save" onSubmit={(event) => void save(event)}>
        <Field
          label="Содержимое для записи"
          for={bodyId}
          hint="Файл создаётся или перезаписывается целиком. Пустую запись можно сделать после чтения файла."
          error={writeError()}
        >
          <Textarea
            id={bodyId}
            rows={10}
            value={draft()}
            disabled={!props.enabled || writing()}
            aria-invalid={writeError() === null ? undefined : 'true'}
            onInput={(event) => {
              setDraft(event.currentTarget.value)
              setSaved(false)
            }}
          />
        </Field>
        <div class="files-actions">
          <Button type="submit" variant="primary" loading={writing()} disabled={!canSave()}>
            Сохранить
          </Button>
          <span class="files-count">{characters(draft().length)}</span>
          <Show when={saved()}>
            <span class="files-saved" role="status">
              Сохранено
            </span>
          </Show>
        </div>
      </form>
    </section>
  )
}
