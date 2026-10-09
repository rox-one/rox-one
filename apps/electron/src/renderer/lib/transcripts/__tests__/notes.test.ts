import { describe, expect, it } from 'bun:test'
import { setupI18n } from '@rox/shared/i18n/setupI18n'
import type { NoteCreateOptions, NoteDocument } from '../../../../shared/types'
import {
  recordTranscript,
  transcriptMarkdown,
  transcriptNoteTitle,
  transcriptsFolder,
} from '../notes'

await setupI18n().changeLanguage('ru')

type Deps = NonNullable<Parameters<typeof recordTranscript>[1]>
type FakeApi = NonNullable<Deps['api']>
type ControllerFactory = NonNullable<Deps['createSyncController']>

/** Local wall-clock timestamp so the pinned Russian format is timezone-independent. */
const AT = new Date(2026, 9, 8, 14, 32, 0, 0).getTime()

function note(overrides: Partial<NoteDocument>): NoteDocument {
  return {
    id: 'note-1',
    title: 'title',
    path: 'title.md',
    relativePath: 'title.md',
    tags: [],
    properties: {},
    links: [],
    assetRefs: [],
    updatedAt: 0,
    createdAt: 0,
    size: 0,
    content: '',
    backlinks: [],
    ...overrides,
  }
}

function makeApi(
  created: NoteDocument | Error,
  saved?: NoteDocument,
  options: { nativeChannels?: boolean } = {},
) {
  const calls = {
    create: [] as Array<{ workspaceId: string; title: string; folder?: string; operation?: NoteCreateOptions }>,
    save: [] as unknown[][],
  }
  const api: Record<string, unknown> = {
    createNote: async (workspaceId: string, title: string, folder?: string, operation?: NoteCreateOptions) => {
      calls.create.push({ workspaceId, title, folder, operation })
      if (created instanceof Error) throw created
      return created
    },
    saveNote: async (...args: unknown[]) => {
      calls.save.push(args)
      return saved ?? created
    },
    readNote: async () => { throw new Error('readNote is not used by recordTranscript') },
    listNotes: async () => [],
  }
  if (options.nativeChannels !== false) {
    api.nativeData = { readEntity: async () => null, mutate: async () => { throw new Error('unused') } }
    api.nativeReplica = { open: async () => 'handle' }
  }
  return { api: api as unknown as FakeApi, calls }
}

function controllerStub(receipts: Array<{ operationId: string }> = [{ operationId: 'op-1' }]) {
  const calls = { factory: 0, start: [] as string[], queueSave: [] as Array<{ note: unknown; content: string }>, flush: 0, stop: 0 }
  const stub = {
    start: async (workspaceId: string) => { calls.start.push(workspaceId) },
    queueSave: async (queued: unknown, content: string) => {
      calls.queueSave.push({ note: queued, content })
      return { operationId: 'op-1' }
    },
    flush: async () => { calls.flush++; return receipts },
    stop: async () => { calls.stop++ },
  }
  const factory = (() => { calls.factory++; return stub }) as unknown as ControllerFactory
  return { calls, factory }
}

describe('transcriptNoteTitle', () => {
  it('titles dictation and global transcripts with the source-agnostic stamp', () => {
    expect(transcriptNoteTitle({ workspaceId: 'ws', text: 'hi', source: 'dictation', at: AT }))
      .toBe('Транскрипт 08.10.2026, 14:32')
    expect(transcriptNoteTitle({ workspaceId: 'ws', text: 'hi', source: 'global', at: AT }))
      .toBe('Транскрипт 08.10.2026, 14:32')
  })

  it('names meetings by title and falls back without one', () => {
    expect(transcriptNoteTitle({ workspaceId: 'ws', text: '', source: 'meeting', at: AT, meetingTitle: 'Планёрка' }))
      .toBe('Транскрипт встречи: Планёрка · 08.10.2026, 14:32')
    expect(transcriptNoteTitle({ workspaceId: 'ws', text: '', source: 'meeting', at: AT, meetingTitle: '   ' }))
      .toBe('Транскрипт встречи: Встреча без названия · 08.10.2026, 14:32')
    expect(transcriptNoteTitle({ workspaceId: 'ws', text: '', source: 'meeting', at: AT }))
      .toBe('Транскрипт встречи: Встреча без названия · 08.10.2026, 14:32')
  })
})

describe('transcriptMarkdown', () => {
  it('renders the metadata block followed by the dictation text', () => {
    expect(transcriptMarkdown({
      workspaceId: 'ws',
      text: 'Привет, мир',
      source: 'dictation',
      at: AT,
      language: 'ru',
      model: 'deepgram/nova-3',
      durationMs: 125_000,
    })).toBe([
      '**Дата:** 08.10.2026, 14:32',
      '**Источник:** Голосовой ввод',
      '**Язык:** ru',
      '**Модель:** deepgram/nova-3',
      '**Длительность:** 02:05',
      '',
      'Привет, мир',
    ].join('\n'))
  })

  it('omits absent optional metadata and marks meetings as Встреча', () => {
    expect(transcriptMarkdown({ workspaceId: 'ws', text: 'Тело', source: 'meeting', at: AT }))
      .toBe(['**Дата:** 08.10.2026, 14:32', '**Источник:** Встреча', '', 'Тело'].join('\n'))
  })

  it('renders meeting segments as timestamped speaker lines', () => {
    expect(transcriptMarkdown({
      workspaceId: 'ws',
      text: 'unused',
      source: 'meeting',
      at: AT,
      segments: [
        { speaker: 'Speaker 1', text: 'Привет', startMs: 0 },
        { speaker: 'Speaker 2', text: 'Пока', startMs: 65_000 },
      ],
    })).toBe([
      '**Дата:** 08.10.2026, 14:32',
      '**Источник:** Встреча',
      '',
      '**[00:00] Speaker 1:** Привет',
      '**[01:05] Speaker 2:** Пока',
    ].join('\n'))
  })

  it('ignores segments for dictation transcripts', () => {
    expect(transcriptMarkdown({
      workspaceId: 'ws',
      text: 'Полный текст',
      source: 'dictation',
      at: AT,
      segments: [{ speaker: 'Speaker 1', text: 'фрагмент', startMs: 1_000 }],
    })).toBe(['**Дата:** 08.10.2026, 14:32', '**Источник:** Голосовой ввод', '', 'Полный текст'].join('\n'))
  })
})

describe('recordTranscript markdown branch', () => {
  it('creates the note in the transcripts folder and saves markdown through saveNote', async () => {
    const { api, calls } = makeApi(note({ id: 'note-7', revision: 'rev-1', sourceStoreId: 'markdown:store' }))
    const result = await recordTranscript(
      { workspaceId: 'ws-1', text: 'Привет', source: 'dictation', at: AT, durationMs: 5_000 },
      { api },
    )
    expect(result).toEqual({ ok: true, noteId: 'note-7' })
    expect(calls.create).toHaveLength(1)
    expect(calls.create[0]).toMatchObject({
      workspaceId: 'ws-1',
      title: 'Транскрипт 08.10.2026, 14:32',
      folder: transcriptsFolder(),
      operation: { expectedRevision: null, schemaVersion: 1 },
    })
    expect(calls.create[0].operation?.operationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls.save).toHaveLength(1)
    expect(calls.save[0]).toEqual([
      'ws-1',
      'note-7',
      transcriptMarkdown({ workspaceId: 'ws-1', text: 'Привет', source: 'dictation', at: AT, durationMs: 5_000 }),
      'rev-1',
      'markdown:store',
    ])
  })

  it('fails when saveNote returns a different document', async () => {
    const { api } = makeApi(
      note({ id: 'note-7', revision: 'rev-1' }),
      note({ id: 'other-note' }),
    )
    const result = await recordTranscript({ workspaceId: 'ws-1', text: 'x', source: 'dictation', at: AT }, { api })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('different document')
  })
})

describe('recordTranscript native branch', () => {
  it('uses the native controller when createNote returns native identity and revision', async () => {
    const native = note({ id: 'note-9', nativeId: 'native-9', nativeRevision: 3, sourceStoreId: 'native-journal:x' })
    const { api, calls } = makeApi(native)
    const { calls: controllerCalls, factory } = controllerStub()
    const result = await recordTranscript(
      { workspaceId: 'ws-2', text: 'Голос', source: 'global', at: AT },
      { api, createSyncController: factory },
    )
    expect(result).toEqual({ ok: true, noteId: 'note-9' })
    expect(calls.save).toHaveLength(0)
    expect(controllerCalls.factory).toBe(1)
    expect(controllerCalls.start).toEqual(['ws-2'])
    expect(controllerCalls.queueSave).toHaveLength(1)
    expect(controllerCalls.queueSave[0].note).toBe(native)
    expect(controllerCalls.queueSave[0].content)
      .toBe(transcriptMarkdown({ workspaceId: 'ws-2', text: 'Голос', source: 'global', at: AT }))
    expect(controllerCalls.flush).toBe(1)
    expect(controllerCalls.stop).toBe(1)
  })

  it('stops the controller and fails when flush acknowledges no matching receipt', async () => {
    const native = note({ id: 'note-9', nativeId: 'native-9', nativeRevision: 3, sourceStoreId: 'native-journal:x' })
    const { api } = makeApi(native)
    const { calls, factory } = controllerStub([])
    const result = await recordTranscript(
      { workspaceId: 'ws-2', text: 'Голос', source: 'global', at: AT },
      { api, createSyncController: factory },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('unacknowledged')
    expect(calls.stop).toBe(1)
  })

  it('falls back to markdown when the api has no native channels', async () => {
    const native = note({ id: 'note-9', nativeId: 'native-9', nativeRevision: 3, sourceStoreId: 'native-journal:x' })
    const { api, calls } = makeApi(native, native, { nativeChannels: false })
    const { calls: controllerCalls, factory } = controllerStub()
    const result = await recordTranscript(
      { workspaceId: 'ws-2', text: 'Голос', source: 'global', at: AT },
      { api, createSyncController: factory },
    )
    expect(result).toEqual({ ok: true, noteId: 'note-9' })
    expect(controllerCalls.factory).toBe(0)
    expect(calls.save).toHaveLength(1)
  })
})

describe('recordTranscript failure handling', () => {
  it('never throws when createNote rejects', async () => {
    const { api } = makeApi(new Error('create failed'))
    const result = await recordTranscript({ workspaceId: 'ws', text: 'x', source: 'dictation', at: AT }, { api })
    expect(result).toEqual({ ok: false, error: 'create failed' })
  })

  it('never throws when the native controller start rejects', async () => {
    const native = note({ id: 'note-9', nativeId: 'native-9', nativeRevision: 3, sourceStoreId: 'native-journal:x' })
    const { api } = makeApi(native)
    const calls = { start: 0, stop: 0 }
    const factory = (() => ({
      start: async () => { calls.start++; throw new Error('open failed') },
      queueSave: async () => ({ operationId: 'op-1' }),
      flush: async () => [],
      stop: async () => { calls.stop++ },
    })) as unknown as ControllerFactory
    const result = await recordTranscript(
      { workspaceId: 'ws-2', text: 'x', source: 'global', at: AT },
      { api, createSyncController: factory },
    )
    expect(result).toEqual({ ok: false, error: 'open failed' })
    expect(calls.start).toBe(1)
    expect(calls.stop).toBe(1)
  })
})

describe('recordTranscript write coordination', () => {
  /** Test double over the notes API; native channels are unused on these paths. */
  function apiStub(overrides: Record<string, unknown>): FakeApi {
    return { listNotes: async () => [], ...overrides } as unknown as FakeApi
  }

  it('retries a lost store claim and still files exactly one note', async () => {
    let attempts = 0
    const created = note({ id: 'note-1', revision: 'rev-1', sourceStoreId: 'markdown:store' })
    const api = apiStub({
      createNote: async () => {
        attempts += 1
        // RPC failures reach the renderer as plain objects, not Error instances.
        if (attempts === 1) throw { code: 'rateLimited', message: 'Document claim requires recovery' }
        return created
      },
      saveNote: async () => created,
    })
    const result = await recordTranscript(
      { workspaceId: 'ws-1', text: 'Привет', source: 'dictation', at: AT },
      { api },
    )
    expect(result).toEqual({ ok: true, noteId: 'note-1' })
    expect(attempts).toBe(2)
  }, 15_000)

  it('does not retry a permanent store failure', async () => {
    const deleted: string[] = []
    const stub = note({ id: 'note-5', revision: 'rev-1', sourceStoreId: 'markdown:store' })
    let saveAttempts = 0
    const api = apiStub({
      createNote: async () => stub,
      saveNote: async () => {
        saveAttempts += 1
        throw new Error('store offline')
      },
      readNote: async () => stub,
      deleteNote: async (_workspaceId: string, noteId: string) => { deleted.push(noteId); return true },
    })
    const result = await recordTranscript(
      { workspaceId: 'ws-1', text: 'Привет', source: 'dictation', at: AT },
      { api },
    )
    expect(result).toEqual({ ok: false, error: 'store offline' })
    expect(saveAttempts).toBe(1)
    expect(deleted).toEqual(['note-5'])
  })

  it('serialises concurrent transcript writes through one queue', async () => {
    const events: string[] = []
    const api = apiStub({
      createNote: async (_workspaceId: string, title: string) => {
        events.push(`create:${title}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        return note({ id: `note:${title}`, revision: 'rev-1', sourceStoreId: 'markdown:store' })
      },
      saveNote: async (_workspaceId: string, id: string) => {
        events.push(`save:${id}`)
        return note({ id })
      },
    })
    await Promise.all([
      recordTranscript({ workspaceId: 'ws-1', text: 'первый', source: 'dictation', at: AT }, { api }),
      recordTranscript({ workspaceId: 'ws-1', text: 'второй', source: 'meeting', at: AT + 60_000 }, { api }),
    ])
    // The store claim is per-directory: the second write must not start before
    // the first one committed, and vice versa.
    expect(events.map((event) => event.split(':')[0])).toEqual(['create', 'save', 'create', 'save'])
  })

  it('deletes the created stub when the markdown save fails', async () => {
    const deleted: string[] = []
    const stub = note({ id: 'note-9', revision: 'rev-1', sourceStoreId: 'markdown:store' })
    const api = apiStub({
      createNote: async () => stub,
      saveNote: async () => note({ id: 'other-note' }),
      readNote: async () => stub,
      deleteNote: async (_workspaceId: string, noteId: string) => { deleted.push(noteId); return true },
    })
    const result = await recordTranscript(
      { workspaceId: 'ws-1', text: 'Привет', source: 'dictation', at: AT },
      { api },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('different document')
    expect(deleted).toEqual(['note-9'])
  })
})
