/** W1-06 (#1503) — KPIs: TECH-SPEC §4.12; DATA-MODEL §5.7. */
import { z } from 'zod'
import { cmd, createIdShape, emptyPayload, entity, idSchema, isoDateSchema, isoDateTimeSchema, nameSchema, principalIdSchema, richTextSchema, titleSchema, type CommandSchemaMap } from '../common'

export const kpiCadenceSchema = z.enum(['weekly', 'monthly'])
export const kpiEntrySchema = entity({ kpiId: idSchema, recordedBy: idSchema, value: z.number(), period: isoDateSchema, note: z.string().optional() })
export const kpiAnnotationSchema = entity({ kpiId: idSchema, createdBy: idSchema.optional(), date: isoDateSchema, title: titleSchema })
export const kpiSchema = entity({
  spaceId: idSchema, championId: idSchema.optional(), name: nameSchema, unit: z.string().max(32), cadence: kpiCadenceSchema,
  description: richTextSchema.optional(), direction: z.enum(['increase', 'decrease']), targetValue: z.number().optional(),
  nextEntryDueAt: isoDateTimeSchema.optional(),
  /** Local mode embeds entries and annotations (`work/kpis/<id>.json`). */
  entries: z.array(kpiEntrySchema.partial({ revision: true, authority: true })).optional(),
  annotations: z.array(kpiAnnotationSchema.partial({ revision: true, authority: true })).optional(),
})

export const KPIS_COMMAND_SCHEMAS: CommandSchemaMap = {
  'kpis.create': cmd({
    ...createIdShape, spaceId: idSchema, name: nameSchema, unit: z.string().max(32).optional(), cadence: kpiCadenceSchema,
    description: richTextSchema.optional(), direction: z.enum(['increase', 'decrease']).optional(), targetValue: z.number().finite().optional(),
    championId: principalIdSchema.optional(),
  }),
  'kpis.update': cmd({
    name: nameSchema.optional(), unit: z.string().max(32).optional(), cadence: kpiCadenceSchema.optional(), description: richTextSchema.nullable().optional(),
    direction: z.enum(['increase', 'decrease']).optional(), targetValue: z.number().finite().nullable().optional(), championId: principalIdSchema.nullable().optional(),
  }).refine(value => Object.keys(value).length > 0, { message: 'empty update' }),
  'kpis.delete': emptyPayload,
  'kpis.log_entry': cmd({ ...createIdShape, value: z.number().finite(), period: isoDateSchema, note: z.string().max(2000).optional() }),
  'kpis.edit_entry': cmd({ entryId: idSchema, value: z.number().finite().optional(), period: isoDateSchema.optional(), note: z.string().max(2000).nullable().optional() }),
  'kpis.delete_entry': cmd({ entryId: idSchema }),
  'kpis.add_annotation': cmd({ ...createIdShape, date: isoDateSchema, title: titleSchema }),
  'kpis.edit_annotation': cmd({ annotationId: idSchema, date: isoDateSchema.optional(), title: titleSchema.optional() }),
  'kpis.delete_annotation': cmd({ annotationId: idSchema }),
}

export const KPIS_ENTITY_SCHEMAS = { kpi: kpiSchema, 'kpi-entry': kpiEntrySchema } as const
