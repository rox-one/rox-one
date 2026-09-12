import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ElectronAPI } from '../../../shared/types'

type NoteSummary = Awaited<ReturnType<ElectronAPI['listNotes']>>[number]
type NoteDocument = Awaited<ReturnType<ElectronAPI['readNote']>>

type NotesDocument = {
  id: string
  title: string
  body?: string | null
}

export type ConationNotesApi = {
  listNotes: (workspaceId: string) => Promise<ReadonlyArray<Pick<NoteSummary, 'id' | 'title'>>>
  readNote: (
    workspaceId: string,
    noteId: string,
  ) => Promise<Pick<NoteDocument, 'id' | 'title' | 'content'>>
}

export type NotesBridge = {
  listNotes: () => Promise<{ items: NotesDocument[] }>
  getNote: (id: string) => Promise<NotesDocument | null>
}

type Props = {
  bridge?: NotesBridge | null
}

type NotesErrorKey = 'conation.notes.loadError' | 'conation.notes.readError'

/** Bind the existing Electron Notes reads to one active workspace. */
export function createConationNotesBridge(
  api: ConationNotesApi | null | undefined,
  workspaceId: string | null | undefined,
): NotesBridge | null {
  if (!api || !workspaceId) return null

  return {
    listNotes: async () => {
      const notes = await api.listNotes(workspaceId)
      return {
        items: notes.map(({ id, title }) => ({ id, title })),
      }
    },
    getNote: async (noteId) => {
      const note = await api.readNote(workspaceId, noteId)
      return {
        id: note.id,
        title: note.title,
        body: note.content,
      }
    },
  }
}

/**
 * Read-only Conation Notes pane. No write controls.
 * Forge: restyle to Rox Notes/Imports chrome if KnowledgeInspector is the host.
 */
export function ConationNotesPanel({ bridge = null }: Props = {}) {
  const { t } = useTranslation()
  const [items, setItems] = useState<NotesDocument[]>([])
  const [open, setOpen] = useState<NotesDocument | null>(null)
  const [errorKey, setErrorKey] = useState<NotesErrorKey | null>(null)
  const readGenerationRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    readGenerationRef.current += 1
    setItems([])
    setOpen(null)
    setErrorKey(null)

    if (bridge) {
      void bridge
        .listNotes()
        .then((page) => {
          if (!cancelled) setItems(page.items)
        })
        .catch((err: unknown) => {
          console.error('[ConationNotesPanel] Failed to list notes:', err)
          if (!cancelled) setErrorKey('conation.notes.loadError')
        })
    }

    return () => {
      cancelled = true
      readGenerationRef.current += 1
    }
  }, [bridge])

  if (!bridge) {
    return <div data-conation-notes="off">{t('conation.notes.off')}</div>
  }

  const openNote = (noteId: string) => {
    const generation = ++readGenerationRef.current
    setErrorKey(null)
    setOpen(null)
    void bridge
      .getNote(noteId)
      .then((note) => {
        if (generation !== readGenerationRef.current) return
        setOpen(note)
      })
      .catch((err: unknown) => {
        console.error('[ConationNotesPanel] Failed to read note:', err)
        if (generation !== readGenerationRef.current) return
        setOpen(null)
        setErrorKey('conation.notes.readError')
      })
  }

  return (
    <div data-conation-notes="readonly">
      {errorKey ? <p>{t(errorKey)}</p> : null}
      <ul>
        {items.map((doc) => (
          <li key={doc.id}>
            <button type="button" onClick={() => openNote(doc.id)}>
              {doc.title}
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <article>
          <h2>{open.title}</h2>
          <pre>{open.body ?? ''}</pre>
        </article>
      ) : null}
    </div>
  )
}
