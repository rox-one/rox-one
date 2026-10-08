/** W1-06 (#1503) — `links.*`, `entities.*`: TECH-SPEC §3.2, §20 X-13 / X-26. Link payloads reuse the W1-02 schemas. */
import { z } from 'zod'
import { entityLinkAnchorSchema } from '../../entities/schemas'
import { cmd, refSchema, relationSchema, sortKeySchema, type CommandSchemaMap } from '../common'

export const ENTITIES_COMMAND_SCHEMAS: CommandSchemaMap = {
  /** `from` defaults to the envelope target. */
  'links.add': cmd({ from: refSchema.optional(), to: refSchema, relation: relationSchema, role: z.string().min(1).max(64).optional(), anchor: entityLinkAnchorSchema.optional() }),
  'links.remove': cmd({ from: refSchema.optional(), to: refSchema, relation: relationSchema }),
  'entities.drop': cmd({ source: refSchema, intent: z.enum(['link', 'embed', 'attach', 'create-task', 'schedule', 'share']).default('link') }),
  'entities.pin': cmd({ entity: refSchema, sortKey: sortKeySchema.optional() }),
  'entities.unpin': cmd({ entity: refSchema }),
  'entities.reorder_pins': cmd({ order: z.array(refSchema).min(1).max(200) }),
}
