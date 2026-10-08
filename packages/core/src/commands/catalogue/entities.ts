// W1-03 (#1500) — `links.*`, `entities.*` (TECH-SPEC §3.2, §20 X-13 / X-26).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const ENTITIES_COMMANDS = moduleCatalogue('entities', F.entitiesLinks, [
  ['links.add', 'by-target'],
  ['links.remove', 'by-target'],
  ['entities.drop', 'by-target', 'write', F.xfn],
  ['entities.pin', 'by-target', 'write', F.xfn],
  ['entities.unpin', 'by-target', 'write', F.xfn],
  ['entities.reorder_pins', 'by-target', 'write', F.xfn],
])
