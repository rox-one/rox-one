import React, { useEffect, useState } from 'react'

/** Local shape so Forge can retarget the core barrel import later. */
type NotesDocument = {
  id: string
  title: string
  body?: string | null
}

type NotesBridge = {
  listNotes: () => Promise<{ items: NotesDocument[] }>
  getNote: (id: string) => Promise<NotesDocument | null>
}

type Props = {
  bridge?: NotesBridge | null
}

/**
 * Read-only Conation Notes pane. No write controls.
 * Forge: restyle to Rox Notes/Imports chrome if KnowledgeInspector is the host.
 */
export function ConationNotesPanel({ bridge = null }: Props = {}) {
  const [items, setItems] = useState<NotesDocument[]>([])
  const [open, setOpen] = useState<NotesDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!bridge) {
      setItems([])
      setOpen(null)
      return
    }
    void bridge
      .listNotes()
      .then((page) => {
        if (!cancelled) setItems(page.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'notes list failed')
      })
    return () => {
      cancelled = true
    }
  }, [bridge])

  if (!bridge) {
    return <div data-conation-notes="off">Conation Notes is off.</div>
  }

  return (
    <div data-conation-notes="readonly">
      {error ? <p>{error}</p> : null}
      <ul>
        {items.map((doc) => (
          <li key={doc.id}>
            <button type="button" onClick={() => void bridge.getNote(doc.id).then(setOpen)}>
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
