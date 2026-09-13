/**
 * Issue 08 — provider-neutral Notes views: Base/Table, JSON Canvas, Outline, Graph.
 */

export type NoteViewKind = 'document' | 'table' | 'base' | 'canvas' | 'outline' | 'graph'

export type NoteViewFilterOp = 'eq' | 'includes' | 'exists' | 'gt' | 'lt'

export type NoteViewFilter = {
  field: string
  op: NoteViewFilterOp
  value?: unknown
}

export const NOTE_FORMULA_EXPRS = ['taskCount', 'openTaskCount', 'backlinkCount', 'tagCount'] as const

export type NoteViewFormulaExpr = (typeof NOTE_FORMULA_EXPRS)[number]

export type NoteViewFormula = {
  name: string
  expr: NoteViewFormulaExpr
}

export type NoteBaseView = {
  v: 1
  id: string
  name: string
  kind: 'table' | 'base'
  filters: NoteViewFilter[]
  formulas: NoteViewFormula[]
  groupBy?: string
  sort?: { field: string; dir: 'asc' | 'desc' }
  columns: string[]
}

export type NoteOutlineNode = {
  id: string
  title: string
  collapsed: boolean
  supertag?: string
  children: NoteOutlineNode[]
}

export type JsonCanvasNode = {
  id: string
  type: 'file' | 'text' | 'group'
  x: number
  y: number
  width: number
  height: number
  file?: string
  text?: string
  color?: string
  noteId?: string
}

export type JsonCanvasEdge = {
  id: string
  fromNode: string
  toNode: string
  fromSide?: 'left' | 'right' | 'top' | 'bottom'
  toSide?: 'left' | 'right' | 'top' | 'bottom'
}

export type JsonCanvas = {
  nodes: JsonCanvasNode[]
  edges: JsonCanvasEdge[]
}

export type NoteGraphNode = { id: string; title: string; kind: 'note' | 'entity' }
export type NoteGraphEdge = { from: string; to: string; kind: 'wikilink' | 'backlink' }

export type NoteProjectionRow = {
  id: string
  title: string
  folder: string
  tags: string[]
  properties: Record<string, unknown>
  tasks: number
  openTasks: number
  backlinks: number
  provenance: { noteId: string }
}

export type ConvertibleNote = {
  id: string
  title: string
  markdown: string
  tags?: string[]
}

export type NoteConversion =
  | { kind: 'session-draft'; title: string; prompt: string; provenance: { noteId: string } }
  | { kind: 'task'; title: string; body: string; provenance: { noteId: string } }

const VIEW_STORAGE_PREFIX = 'notes:views:'
export const NOTES_CANVAS_STORAGE_PREFIX = 'notes:canvas:'
export const DAILY_VAULT_FOLDER = 'daily'

export function notesViewsStorageKey(workspaceId: string): string {
  return `${VIEW_STORAGE_PREFIX}${workspaceId}`
}

export function notesCanvasStorageKey(workspaceId: string, canvasId: string): string {
  return `${NOTES_CANVAS_STORAGE_PREFIX}${workspaceId}:${canvasId}`
}

export function parseNoteBaseView(raw: unknown): NoteBaseView | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<NoteBaseView>
  if (value.v !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string') return null
  if (value.kind !== 'table' && value.kind !== 'base') return null
  return {
    v: 1,
    id: value.id,
    name: value.name,
    kind: value.kind,
    filters: Array.isArray(value.filters) ? value.filters.filter(isFilter) : [],
    formulas: Array.isArray(value.formulas) ? value.formulas.filter(isFormula) : [],
    groupBy: typeof value.groupBy === 'string' ? value.groupBy : undefined,
    sort:
      value.sort && (value.sort.dir === 'asc' || value.sort.dir === 'desc') && typeof value.sort.field === 'string'
        ? { field: value.sort.field, dir: value.sort.dir }
        : undefined,
    columns: Array.isArray(value.columns) ? value.columns.filter((column) => typeof column === 'string') : ['title'],
  }
}

export function serializeNoteBaseView(view: NoteBaseView): string {
  return JSON.stringify(view)
}

export function projectNoteRows(
  notes: ReadonlyArray<{
    id: string
    title: string
    tags?: string[]
    properties?: Record<string, unknown>
    tasks?: Array<{ checked: boolean }>
    backlinks?: unknown[]
  }>,
): NoteProjectionRow[] {
  return notes.map((note) => {
    const tasks = note.tasks ?? []
    const folder = note.id.includes('/') ? note.id.slice(0, note.id.lastIndexOf('/')) : ''
    return {
      id: note.id,
      title: note.title,
      folder,
      tags: note.tags ?? [],
      properties: note.properties ?? {},
      tasks: tasks.length,
      openTasks: tasks.filter((task) => !task.checked).length,
      backlinks: note.backlinks?.length ?? 0,
      provenance: { noteId: note.id },
    }
  })
}

export function applyNoteBaseView(rows: readonly NoteProjectionRow[], view: NoteBaseView): NoteProjectionRow[] {
  let next = rows.filter((row) => view.filters.every((filter) => matchesFilter(row, filter)))
  if (view.sort) {
    const field = view.sort.field
    const dir = view.sort.dir === 'asc' ? 1 : -1
    next = [...next].sort((a, b) => compareUnknown(readField(a, field), readField(b, field)) * dir)
  }
  return next
}

export function groupNoteRows(
  rows: readonly NoteProjectionRow[],
  groupBy: string | undefined,
): Array<{ key: string; rows: NoteProjectionRow[] }> {
  if (!groupBy) return [{ key: '', rows: [...rows] }]
  const groups = new Map<string, NoteProjectionRow[]>()
  for (const row of rows) {
    const key = String(readField(row, groupBy) ?? '')
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }
  return [...groups.entries()].map(([key, grouped]) => ({ key, rows: grouped }))
}

export function formulaValue(row: NoteProjectionRow, formula: NoteViewFormula): number {
  switch (formula.expr) {
    case 'taskCount':
      return row.tasks
    case 'openTaskCount':
      return row.openTasks
    case 'backlinkCount':
      return row.backlinks
    case 'tagCount':
      return row.tags.length
  }
}

export function formulaI18nKey(expr: NoteViewFormulaExpr): string {
  switch (expr) {
    case 'taskCount':
      return 'notes.views.formulaTaskCount'
    case 'openTaskCount':
      return 'notes.views.formulaOpenTasks'
    case 'backlinkCount':
      return 'notes.views.formulaBacklinks'
    case 'tagCount':
      return 'notes.views.formulaTagCount'
  }
}

export function addFormula(view: NoteBaseView, expr: NoteViewFormulaExpr): NoteBaseView {
  if (view.formulas.some((formula) => formula.expr === expr)) return view
  return { ...view, formulas: [...view.formulas, { name: expr, expr }] }
}

export function removeFormula(view: NoteBaseView, expr: NoteViewFormulaExpr): NoteBaseView {
  return { ...view, formulas: view.formulas.filter((formula) => formula.expr !== expr) }
}

export function availableFormulaExprs(view: NoteBaseView): NoteViewFormulaExpr[] {
  const used = new Set(view.formulas.map((formula) => formula.expr))
  return NOTE_FORMULA_EXPRS.filter((expr) => !used.has(expr))
}

export function parseJsonCanvas(raw: string | null): JsonCanvas {
  if (!raw) return { nodes: [], edges: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<JsonCanvas>
    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.filter(isCanvasNode) : []
    const known = new Set(nodes.map((node) => node.id))
    const edges = Array.isArray(parsed.edges)
      ? parsed.edges.filter((edge): edge is JsonCanvasEdge => isCanvasEdge(edge) && known.has(edge.fromNode) && known.has(edge.toNode))
      : []
    return { nodes, edges }
  } catch {
    return { nodes: [], edges: [] }
  }
}

export function serializeJsonCanvas(canvas: JsonCanvas): string {
  return JSON.stringify({ nodes: canvas.nodes, edges: canvas.edges })
}

export function createCanvasFileCard(input: {
  noteId: string
  title: string
  x: number
  y: number
}): JsonCanvasNode {
  return {
    id: `file:${input.noteId}`,
    type: 'file',
    x: input.x,
    y: input.y,
    width: 240,
    height: 120,
    file: `${input.noteId}.md`,
    text: input.title,
    noteId: input.noteId,
  }
}

export function outlineFromHeadings(
  noteId: string,
  headings: ReadonlyArray<{ level: number; text: string }>,
  collapsedIds: ReadonlySet<string> = new Set(),
  supertag?: string,
): NoteOutlineNode {
  const root: NoteOutlineNode = {
    id: noteId,
    title: noteId,
    collapsed: collapsedIds.has(noteId),
    supertag,
    children: [],
  }
  const stack: Array<{ level: number; node: NoteOutlineNode }> = [{ level: 0, node: root }]
  headings.forEach((heading, index) => {
    const node: NoteOutlineNode = {
      id: `${noteId}:${index}:${heading.text}`,
      title: heading.text,
      collapsed: collapsedIds.has(`${noteId}:${index}:${heading.text}`),
      children: [],
    }
    while (stack.length > 1 && stack.at(-1)!.level >= heading.level) stack.pop()
    stack.at(-1)!.node.children.push(node)
    stack.push({ level: heading.level, node })
  })
  return root
}

export function graphFromLinks(
  notes: ReadonlyArray<{ id: string; title: string; links?: Array<{ target: string }>; backlinks?: Array<{ noteId: string }> }>,
): { nodes: NoteGraphNode[]; edges: NoteGraphEdge[] } {
  const nodes = notes.map((note) => ({ id: note.id, title: note.title, kind: 'note' as const }))
  const known = new Set(notes.map((note) => note.id))
  const byTitle = new Map(notes.map((note) => [note.title.toLowerCase(), note.id]))
  const edges: NoteGraphEdge[] = []
  for (const note of notes) {
    for (const link of note.links ?? []) {
      const target = known.has(link.target) ? link.target : byTitle.get(link.target.toLowerCase())
      if (!target) continue
      edges.push({ from: note.id, to: target, kind: 'wikilink' })
    }
    for (const backlink of note.backlinks ?? []) {
      edges.push({ from: backlink.noteId, to: note.id, kind: 'backlink' })
    }
  }
  return { nodes, edges }
}

export type NoteGraphEdgeKindFilter = 'all' | 'wikilink' | 'backlink'

export function filterGraphByEdgeKind(
  graph: { nodes: NoteGraphNode[]; edges: NoteGraphEdge[] },
  kind: NoteGraphEdgeKindFilter,
): { nodes: NoteGraphNode[]; edges: NoteGraphEdge[] } {
  if (kind === 'all') return { nodes: [...graph.nodes], edges: [...graph.edges] }
  const edges = graph.edges.filter((edge) => edge.kind === kind)
  const used = new Set<string>()
  for (const edge of edges) {
    used.add(edge.from)
    used.add(edge.to)
  }
  return { nodes: graph.nodes.filter((node) => used.has(node.id)), edges }
}

export const DEFAULT_VAULT_TABLE_VIEW: NoteBaseView = {
  v: 1,
  id: 'vault-table',
  name: 'Vault',
  kind: 'table',
  filters: [],
  formulas: [{ name: 'open', expr: 'openTaskCount' }],
  sort: { field: 'title', dir: 'asc' },
  columns: ['title', 'folder', 'tags', 'openTasks'],
}

export function loadSavedViews(raw: string | null): NoteBaseView[] {
  const saved = restoreSavedViews(raw)
  return saved.length > 0 ? saved : [{ ...DEFAULT_VAULT_TABLE_VIEW }]
}

export function tagFilterValue(view: NoteBaseView): string {
  const match = view.filters.find((item) => item.field === 'tags' && item.op === 'includes')
  return typeof match?.value === 'string' ? match.value : ''
}

export function withTagFilter(view: NoteBaseView, value: string): NoteBaseView {
  const others = view.filters.filter((filter) => !(filter.field === 'tags' && filter.op === 'includes'))
  const trimmed = value.trim()
  return {
    ...view,
    filters: trimmed ? [...others, { field: 'tags', op: 'includes', value: trimmed }] : others,
  }
}

export const NOTES_OUTLINE_FOLDS_PREFIX = 'notes:outline-folds:'

export function notesOutlineFoldsStorageKey(workspaceId: string, noteId: string): string {
  return `${NOTES_OUTLINE_FOLDS_PREFIX}${workspaceId}:${noteId}`
}

export function parseOutlineFolds(raw: string | null): Set<string> {
  if (!raw) return new Set()
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

export function serializeOutlineFolds(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids])
}

export function convertNote(note: ConvertibleNote, kind: 'session-draft' | 'task'): NoteConversion {
  if (kind === 'task') {
    return {
      kind: 'task',
      title: note.title,
      body: note.markdown,
      provenance: { noteId: note.id },
    }
  }
  return {
    kind: 'session-draft',
    title: note.title,
    prompt: note.markdown,
    provenance: { noteId: note.id },
  }
}

export function dailyNoteDestination(now = new Date()): { folder: string; title: string } {
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return { folder: DAILY_VAULT_FOLDER, title: `${yyyy}-${mm}-${dd}` }
}

export function restoreSavedViews(raw: string | null): NoteBaseView[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseNoteBaseView).filter((view): view is NoteBaseView => view !== null)
  } catch {
    return []
  }
}

function isFilter(value: unknown): value is NoteViewFilter {
  if (!value || typeof value !== 'object') return false
  const filter = value as NoteViewFilter
  return typeof filter.field === 'string' && ['eq', 'includes', 'exists', 'gt', 'lt'].includes(filter.op)
}

function isFormula(value: unknown): value is NoteViewFormula {
  if (!value || typeof value !== 'object') return false
  const formula = value as NoteViewFormula
  return typeof formula.name === 'string' && (NOTE_FORMULA_EXPRS as readonly string[]).includes(formula.expr)
}

function isCanvasNode(value: unknown): value is JsonCanvasNode {
  if (!value || typeof value !== 'object') return false
  const node = value as JsonCanvasNode
  return (
    typeof node.id === 'string' &&
    (node.type === 'file' || node.type === 'text' || node.type === 'group') &&
    typeof node.x === 'number' &&
    typeof node.y === 'number' &&
    typeof node.width === 'number' &&
    typeof node.height === 'number'
  )
}

function isCanvasEdge(value: unknown): value is JsonCanvasEdge {
  if (!value || typeof value !== 'object') return false
  const edge = value as Partial<JsonCanvasEdge>
  return typeof edge.id === 'string' && typeof edge.fromNode === 'string' && typeof edge.toNode === 'string'
}

function readField(row: NoteProjectionRow, field: string): unknown {
  if (field === 'title') return row.title
  if (field === 'folder') return row.folder
  if (field === 'tags') return row.tags
  if (field === 'tasks') return row.tasks
  if (field === 'openTasks') return row.openTasks
  if (field === 'backlinks') return row.backlinks
  return row.properties[field]
}

function matchesFilter(row: NoteProjectionRow, filter: NoteViewFilter): boolean {
  const actual = readField(row, filter.field)
  switch (filter.op) {
    case 'exists':
      return actual !== undefined && actual !== null && actual !== ''
    case 'eq':
      return String(actual) === String(filter.value)
    case 'includes':
      return Array.isArray(actual)
        ? actual.map(String).includes(String(filter.value))
        : String(actual ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase())
    case 'gt':
      return Number(actual) > Number(filter.value)
    case 'lt':
      return Number(actual) < Number(filter.value)
  }
}

function compareUnknown(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''))
}
