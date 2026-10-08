// W1-03 (#1500) — KPIs `kpis.*` (TECH-SPEC §4.12).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const KPIS_COMMANDS = moduleCatalogue('kpis', F.kpis, [
  ['kpis.create', 'by-target'],
  ['kpis.update', 'by-target'],
  ['kpis.delete', 'by-target', 'destroy'],
  ['kpis.log_entry', 'by-target'],
  ['kpis.edit_entry', 'by-target'],
  ['kpis.delete_entry', 'by-target', 'destroy'],
  ['kpis.add_annotation', 'by-target'],
  ['kpis.edit_annotation', 'by-target'],
  ['kpis.delete_annotation', 'by-target', 'destroy'],
])
