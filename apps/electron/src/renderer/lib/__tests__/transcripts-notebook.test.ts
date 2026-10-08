import { describe, expect, it } from 'bun:test'
import { saveTranscriptToNotebook } from '../transcripts-notebook'

/**
 * The notebook writer serializes its own writes and survives the transient claim-gate losses of
 * the notes commit store (`Document claim requires recovery` / `Document writer is busy`), while a
 * permanent failure must not leave an empty transcript stub behind.
 */

const WORKSPACE = 'ws-notebook'

type Call = { op: string; id?: string }

/** RPC failures reach the renderer as plain objects, not Error instances. */
function claimFailure(): unknown {
  return { code: 'rateLimited', message: 'Document claim requires recovery' }
}

function makeApi(options: { saveFailures?: number; saveError?: unknown; onCall?: (call: Call) => void } = {}) {
  const calls: Call[] = []
  const record = (call: Call) => { calls.push(call); options.onCall?.(call) }
  let saveAttempts = 0
  const api = {
    getWindowWorkspace: async () => WORKSPACE,
    listNotes: async () => { record({ op: 'list' }); return [] },
    createNote: async (_workspaceId: string, title: string, folder?: string) => {
      record({ op: 'create', id: title })
      return { id: folder ? `${folder}/${title}` : title, title, content: '', revision: undefined, sourceStoreId: undefined }
    },
    readNote: async (_workspaceId: string, id: string) => { record({ op: 'read', id }); return { id, content: '', revision: 'rev-1', sourceStoreId: 'store-1' } },
    saveNote: async (_workspaceId: string, id: string) => {
      saveAttempts += 1
      record({ op: 'save', id })
      if (saveAttempts <= (options.saveFailures ?? 0)) throw options.saveError ?? claimFailure()
      return { id }
    },
    deleteNote: async (_workspaceId: string, id: string) => { record({ op: 'delete', id }); return true },
  }
  return { api: api as never, calls, saveAttempts: () => saveAttempts }
}

function install(api: unknown): void {
  ;(globalThis as { window?: unknown }).window = { electronAPI: api }
}

describe('transcripts notebook writer', () => {
  it('retries a transient claim loss and stores the transcript', async () => {
    const { api, saveAttempts } = makeApi({ saveFailures: 1 })
    install(api)
    await saveTranscriptToNotebook({ title: 'Транскрипт QA', text: 'проверка диктовки', source: 'dictation' })
    expect(saveAttempts()).toBe(2)
  })

  it('reports a permanent failure without leaving an empty stub', async () => {
    const { api, calls, saveAttempts } = makeApi({ saveFailures: Number.MAX_SAFE_INTEGER, saveError: new Error('store offline') })
    install(api)
    await expect(saveTranscriptToNotebook({ title: 'Транскрипт QA', text: 'проверка диктовки', source: 'dictation' })).rejects.toThrow('store offline')
    expect(saveAttempts()).toBe(1)
    expect(calls.filter((call) => call.op === 'delete')).toHaveLength(1)
  })

  it('serializes concurrent transcripts instead of racing the claim gate', async () => {
    const order: string[] = []
    let created = 0
    const api = {
      getWindowWorkspace: async () => WORKSPACE,
      listNotes: async () => [],
      createNote: async (_workspaceId: string, title: string, folder?: string) => {
        created += 1
        order.push(`create#${created}:${title}`)
        return { id: folder ? `${folder}/${title}` : title, title, content: '', revision: undefined, sourceStoreId: undefined }
      },
      readNote: async (_workspaceId: string, id: string) => ({ id, content: '', revision: 'rev-1', sourceStoreId: 'store-1' }),
      saveNote: async (_workspaceId: string, id: string) => { order.push(`save:${id}`); return { id } },
      deleteNote: async () => true,
    }
    install(api)
    await Promise.all([
      saveTranscriptToNotebook({ title: 'Первый', text: 'первый', source: 'dictation' }),
      saveTranscriptToNotebook({ title: 'Второй', text: 'второй', source: 'dictation' }),
    ])
    const firstSave = order.findIndex((entry) => entry.startsWith('save:') && entry.includes('Первый'))
    const secondCreate = order.findIndex((entry) => entry.includes('create') && entry.includes('Второй'))
    expect(firstSave).toBeGreaterThanOrEqual(0)
    expect(secondCreate).toBeGreaterThan(firstSave)
  })
})