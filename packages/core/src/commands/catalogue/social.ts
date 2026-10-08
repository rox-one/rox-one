// W1-03 (#1500) — `comments.*`, `reactions.*`, `subscriptions.*` (TECH-SPEC §3.7, §11.3).
import { CATALOGUE_FLAGS as F, moduleCatalogue } from './entry.ts'

export const SOCIAL_COMMANDS = moduleCatalogue('social', undefined, [
  ['comments.create', 'workspace'],
  ['comments.edit', 'workspace'],
  ['comments.delete', 'workspace', 'destroy'],
  ['comments.resolve', 'workspace'],
  ['comments.resolve_thread', 'workspace', 'write', F.collabComments],
  ['comments.reopen_thread', 'workspace', 'write', F.collabComments],
  ['comments.react', 'workspace', 'write', F.collabComments],
  ['comments.convert_to_task', 'workspace', 'write', F.collabComments],
  ['reactions.add', 'workspace'],
  ['reactions.remove', 'workspace'],
  ['subscriptions.subscribe', 'workspace'],
  ['subscriptions.unsubscribe', 'workspace'],
  ['subscriptions.set_notify_everyone', 'workspace'],
])
