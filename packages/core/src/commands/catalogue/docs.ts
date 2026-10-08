// W1-03 (#1500) — Docs `docs.*` (TECH-SPEC §4.2, §11, §12, §14.3, §18.2, §20).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const DOCS_COMMANDS = moduleCatalogue('docs', F.docsShared, [
  ['docs.create_document', 'by-target'],
  ['docs.move_note_to_shared', 'workspace', 'share'],
  ['docs.move_back_to_private', 'workspace', 'share'],
  ['docs.update_title', 'by-target'],
  ['docs.publish_post', 'workspace', 'publish'],
  ['docs.schedule_post', 'workspace', 'publish'],
  ['docs.restore_version', 'by-target'],
  ['docs.set_public_sharing', 'workspace', 'share'],
  ['docs.update_permissions', 'workspace', 'share'],
  // v2 collaboration (§11)
  ['docs.suggest_changes', 'workspace', 'write', F.collabSuggestions],
  ['docs.decide_suggestion', 'workspace', 'write', F.collabSuggestions],
  ['docs.sync_suggestions', 'workspace', 'write', F.collabSuggestions],
  ['docs.record_view', 'workspace', 'read', F.collabPresence],
  // §18.2 agent panel: local notes only, after approval
  ['docs.apply_patch', 'local', 'write', F.agentPanel],
  // §14.3 rule engine R1
  ['docs.ensure_daily_note', 'by-target', 'write', F.automation],
  ['docs.append_daily_link', 'by-target', 'write', F.automation],
  ['docs.create_meeting_notes', 'by-target', 'write', F.automation],
  // §12 cross-surface creation
  ['docs.insert_task_block', 'by-target', 'write', F.xsc],
  ['docs.insert_event_block', 'by-target', 'write', F.xsc],
  ['docs.insert_meeting_block', 'by-target', 'write', F.xsc],
  ['docs.embed_view', 'by-target', 'write', F.xsc],
  ['docs.create_from_messages', 'by-target', 'write', F.xsc],
  // §20 X-15 / X-22
  ['docs.append_block', 'by-target', 'write', F.xfn],
  ['docs.create_from_email', 'by-target', 'write', F.xfn],
])
