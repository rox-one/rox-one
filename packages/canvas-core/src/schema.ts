/**
 * «Доска» object schema (clean-room; see plans/canvas/PRD.md §License).
 * Every board object shares `BaseObject`; type-specific props live in `props`.
 * Unknown types are preserved (forward compatibility) — validation reports them,
 * it never drops them.
 */
import { z } from 'zod'
import { isValidIndexKey } from './fractional-index.ts'

export const SCHEMA_VERSION = 1

export const OBJECT_TYPES = [
  'shape', 'path', 'ink', 'line', 'connector', 'text', 'sticky', 'sticker', 'stamp', 'icon',
  'image', 'video', 'audio', 'embed', 'qr', 'table', 'chart', 'group', 'frame', 'mask',
  'boolean', 'mindmap', 'diagramcode', 'boardview', 'slide', 'sheet', 'doc', 'timeline',
  // A live card for a real Rox entity (note, page, dashboard, session, task, … — any EntityKind).
  'entity',
] as const
export type ObjectType = (typeof OBJECT_TYPES)[number]
export const isObjectType = (v: unknown): v is ObjectType =>
  typeof v === 'string' && (OBJECT_TYPES as readonly string[]).includes(v)

/** Types whose `parentId` children render inside them. */
export const CONTAINER_TYPES: ReadonlySet<ObjectType> = new Set(['group', 'frame', 'mask', 'boolean', 'slide', 'mindmap'])

const finite = z.number().finite()

export const fillSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('solid'), color: z.string().min(1) }),
  z.object({ type: z.literal('linear'), angle: finite, stops: z.array(z.object({ offset: z.number().min(0).max(1), color: z.string() })).min(2) }),
  z.object({ type: z.literal('radial'), stops: z.array(z.object({ offset: z.number().min(0).max(1), color: z.string() })).min(2) }),
  z.object({ type: z.literal('pattern'), pattern: z.string(), color: z.string() }),
  z.object({ type: z.literal('image'), assetId: z.string(), fit: z.enum(['cover', 'contain', 'tile']) }),
])
export type Fill = z.infer<typeof fillSchema>

export const effectSchema = z.object({
  type: z.enum(['drop', 'inner', 'blur', 'fade', 'glow']),
  x: finite.default(0), y: finite.default(0), radius: z.number().min(0).default(0),
  color: z.string().optional(), opacity: z.number().min(0).max(1).default(1),
})

export const styleSchema = z.object({
  fill: fillSchema.optional(),
  stroke: z.object({ color: z.string(), width: z.number().min(0), dash: z.array(z.number().min(0)).optional() }).optional(),
  effects: z.array(effectSchema).optional(),
  font: z.object({ family: z.string(), size: z.number().positive(), weight: z.number().int().min(100).max(900).optional() }).optional(),
}).partial()
export type Style = z.infer<typeof styleSchema>

export const entityLinkSchema = z.object({ kind: z.string().min(1), id: z.string().min(1), fragment: z.string().optional() })
export type CanvasEntityLink = z.infer<typeof entityLinkSchema>

export const baseObjectSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  parentId: z.string().nullable(),
  index: z.string().refine(isValidIndexKey, 'invalid fractional index key'),
  x: finite, y: finite,
  w: z.number().finite().min(0), h: z.number().finite().min(0),
  rotation: finite.default(0),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  name: z.string().optional(),
  style: styleSchema.default({}),
  props: z.record(z.string(), z.unknown()).default({}),
  links: z.array(entityLinkSchema).default([]),
  createdBy: z.string().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
})
export type CanvasObject = z.infer<typeof baseObjectSchema>
export type CanvasObjectInput = z.input<typeof baseObjectSchema>

/** Per-type prop validators for types with structural invariants. */
const pointList = z.array(finite).refine(a => a.length % 2 === 0, 'points must be x,y pairs')
const endpoint = z.union([
  z.object({ objectId: z.string().min(1), anchor: z.enum(['auto', 'top', 'right', 'bottom', 'left', 'center']).default('auto') }),
  z.object({ x: finite, y: finite }),
])
export const PROP_SCHEMAS: Partial<Record<ObjectType, z.ZodTypeAny>> = {
  shape: z.object({ kind: z.enum(['rect', 'ellipse', 'triangle', 'diamond', 'polygon', 'star', 'arrow', 'cloud']), sides: z.number().int().min(3).optional(), radius: z.number().min(0).optional() }).passthrough(),
  ink: z.object({ points: pointList, pressure: z.array(z.number()).optional() }).passthrough(),
  path: z.object({ d: z.string().min(1) }).passthrough(),
  line: z.object({ points: pointList }).passthrough(),
  connector: z.object({ from: endpoint, to: endpoint, routing: z.enum(['straight', 'elbow', 'curved']).default('elbow'), startHead: z.string().optional(), endHead: z.string().optional() }).passthrough(),
  image: z.object({ assetId: z.string().min(1) }).passthrough(),
  video: z.object({ assetId: z.string().min(1) }).passthrough(),
  audio: z.object({ assetId: z.string().min(1) }).passthrough(),
  embed: z.object({ url: z.string().url() }).passthrough(),
  qr: z.object({ payload: z.string().min(1) }).passthrough(),
  table: z.object({ rows: z.number().int().min(1), cols: z.number().int().min(1) }).passthrough(),
  diagramcode: z.object({ language: z.enum(['mermaid']) }).passthrough(),
  boardview: z.object({ boardId: z.string().min(1) }).passthrough(),
  entity: z.object({
    kind: z.string().min(1),
    entityId: z.string().min(1),
    /** Cached for offline render; refreshed from the live entity (never the source of truth). */
    snapshot: z.object({
      title: z.string(),
      status: z.string().optional(),
      preview: z.string().max(2000).optional(),
      icon: z.string().optional(),
      updatedAt: z.number().int().nonnegative().optional(),
    }).optional(),
    /** 'created' = minted on this board; 'linked' = dropped existing entity. */
    provenance: z.enum(['created', 'linked']).default('linked'),
  }).passthrough(),
}

export type ValidationIssue = { id: string; message: string }

export function validateObject(raw: unknown): { ok: true; value: CanvasObject; unknownType: boolean } | { ok: false; issues: string[] } {
  const base = baseObjectSchema.safeParse(raw)
  if (!base.success) return { ok: false, issues: base.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }
  const value = base.data
  if (!isObjectType(value.type)) return { ok: true, value, unknownType: true }
  const ps = PROP_SCHEMAS[value.type]
  if (ps) {
    const p = ps.safeParse(value.props)
    if (!p.success) return { ok: false, issues: p.error.issues.map(i => `props.${i.path.join('.')}: ${i.message}`) }
    value.props = p.data as Record<string, unknown>
  }
  return { ok: true, value, unknownType: false }
}
