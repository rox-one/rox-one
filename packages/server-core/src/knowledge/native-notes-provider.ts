/** Read-only KnowledgeProvider backed exclusively by authenticated Native Notes. */
import { hashKnowledgeContent, KnowledgeError } from '@rox/core/knowledge'
import type { ContextMode, KnowledgeProvider, KnowledgeRef, SearchInput } from '@rox/core/knowledge'
import type { nativeNotesKnowledgeAccess } from '../handlers/rpc/notes'

export const NATIVE_NOTES_KNOWLEDGE_PROVIDER = 'local-markdown'
export const NATIVE_NOTES_NOTEBOOK_ID = 'local-notes'
type Access = ReturnType<typeof nativeNotesKnowledgeAccess>
type Document = Awaited<ReturnType<Access['list']>>[number]

export class NativeNotesKnowledgeProvider implements KnowledgeProvider {
  constructor(private readonly access: Access) {}

  private ref(id: string): KnowledgeRef {
    return { scheme: 'siyuan', provider: NATIVE_NOTES_KNOWLEDGE_PROVIDER, kind: 'document', id,
      connectionId: this.access.connectionId }
  }

  private async documents() {
    this.access.assertRead()
    const documents = await this.access.list()
    this.access.assertRead()
    return documents
  }

  async capabilities() {
    this.access.assertRead()
    return { provider: NATIVE_NOTES_KNOWLEDGE_PROVIDER, version: '1.0.0', minSupportedVersion: '1.0.0',
      features: { search: true, backlinks: true, attributes: true, databases: false, inbox: false, daily: false, tags: true, assets: false,
        liveReference: true, watch: false, deepLinks: false },
      mutations: { createDocument: false, appendBlock: false, updateBlock: false, setAttribute: false,
        transactions: false, rollback: false } }
  }

  async search(input: SearchInput) {
    this.access.assertRead()
    if (typeof input?.query !== 'string') throw new KnowledgeError('INVALID_REF', 'query must be a string')
    if (input.cursor) throw new KnowledgeError('UNSUPPORTED_OPERATION', 'Native Notes search has no cursor')
    if ((input.notebookId && input.notebookId !== NATIVE_NOTES_NOTEBOOK_ID) ||
      (input.kinds && !input.kinds.includes('document') && !input.kinds.includes('block'))) {
      return { items: [], totalEstimate: 0 }
    }
    const query = input.query.trim().toLowerCase()
    const prefix = (input.pathPrefix ?? '').replace(/^\/+|\/+$/g, '')
    const limit = Math.max(1, Math.min(100, Number.isFinite(input.limit) ? Math.trunc(input.limit!) : 20))
    const matches = (await this.documents()).filter(note =>
      (!prefix || note.id === prefix || note.id.startsWith(`${prefix}/`)) &&
      Object.entries(input.attributes ?? {}).every(([key, value]) => String(note.properties[key] ?? '') === value))
      .map(note => ({ note, score: !query ? 1 :
        (note.title.toLowerCase().includes(query) ? 4 : 0) +
        (note.tags.some(tag => tag.toLowerCase().includes(query)) ? 2 : 0) +
        (note.content.toLowerCase().includes(query) ? 1 : 0) }))
      .filter(hit => hit.score > 0)
      .sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt || a.note.id.localeCompare(b.note.id))
    const items = matches.slice(0, limit).map(({ note, score }) => {
      const offset = query ? Math.max(0, note.content.toLowerCase().indexOf(query) - 60) : 0
      return { ref: this.ref(note.id), title: note.title,
        snippet: note.content.slice(offset, offset + 240).replace(/\s+/g, ' ').trim(),
        notebookPath: `/${note.id}`, updatedAt: note.updatedAt, score,
        attributes: Object.fromEntries(this.attributes(note).map(attribute => [attribute.key, attribute.value])) }
    })
    this.access.assertRead()
    return { items, totalEstimate: matches.length }
  }

  private attributes(note: Document) {
    return Object.entries(note.properties).map(([key, value]) => ({ key,
      value: typeof value === 'string' ? value : JSON.stringify(value) ?? '' }))
  }

  private assertRef(ref: KnowledgeRef) {
    this.access.assertRead()
    if (ref?.provider !== NATIVE_NOTES_KNOWLEDGE_PROVIDER || ref.scheme !== 'siyuan' ||
      (ref.kind !== 'document' && ref.kind !== 'block') ||
      !ref.id || ref.id.split('/').some(part => !part || part === '.' || part === '..') ||
      ref.id.includes('\\') || /[\u0000-\u001f\u007f]/.test(ref.id) ||
      (ref.connectionId !== undefined && ref.connectionId !== this.access.connectionId)) {
      throw new KnowledgeError('INVALID_REF', 'Expected a local-markdown ref in the authenticated workspace')
    }
  }

  async get(ref: KnowledgeRef) {
    this.assertRef(ref)
    const note = (await this.documents()).find(document => document.id === ref.id)
    if (!note) throw new KnowledgeError('NOT_FOUND', 'Native note not found')
    const contentHash = await hashKnowledgeContent(note.content)
    this.access.assertRead()
    return { ref: this.ref(note.id), title: note.title, markdown: note.content, path: `/${note.id}`,
      attributes: this.attributes(note), createdAt: note.createdAt, updatedAt: note.updatedAt,
      contentHash, blockCount: note.content.split(/\n\s*\n/).filter(part => part.trim()).length }
  }

  async getContext(ref: KnowledgeRef, mode: ContextMode) {
    this.assertRef(ref)
    if (mode !== 'snapshot' && mode !== 'live-reference') throw new KnowledgeError('INVALID_REF', 'Invalid context mode')
    const note = (await this.documents()).find(document => document.id === ref.id)
    if (!note) throw new KnowledgeError('NOT_FOUND', 'Native note not found')
    const contentHash = await hashKnowledgeContent(note.content)
    const backlinks = note.backlinks.map(link => ({ ref: this.ref(link.noteId), title: link.title }))
    this.access.assertRead()
    return { ref: this.ref(note.id), mode, blockId: note.id, content: note.content, children: [], backlinks,
      attributes: this.attributes(note), capturedAt: Date.now(), contentHash }
  }

  async proposeMutation(): Promise<never> {
    this.access.assertRead()
    throw new KnowledgeError('UNSUPPORTED_OPERATION', 'Native Notes Knowledge projection is read-only')
  }
  async applyMutation(): Promise<never> { return this.proposeMutation() }
  async open(ref: KnowledgeRef): Promise<void> { await this.get(ref) }
}
