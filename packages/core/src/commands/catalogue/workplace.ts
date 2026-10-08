// W1-03 (#1500) — Mail bridge, templates & export, forms, batches (TECH-SPEC §4.15, §20 X-19 / X-23).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const MAIL_COMMANDS = moduleCatalogue('mail', F.mail, [
  ['mail.share_to_chat', 'workspace'],
  ['mail.create_task_from_thread', 'by-target'],
])

export const TEMPLATES_COMMANDS = moduleCatalogue('templates', undefined, [
  ['project_templates.create_from_project', 'by-target'],
  ['project_templates.create_project', 'by-target'],
  ['exports.markdown', 'by-target', 'read'],
])

export const XFN_CORE_COMMANDS = moduleCatalogue('core', F.xfn, [
  ['commands.batch', 'by-target'],
  ['forms.configure_on_submit', 'workspace'],
])
