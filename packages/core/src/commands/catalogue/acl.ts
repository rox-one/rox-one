// W1-03 (#1500) — `acl.*` sharing commands (TECH-SPEC §11.5; engine is W1-04 #1501).
import { moduleCatalogue } from './entry.ts'

export const ACL_COMMANDS = moduleCatalogue('acl', undefined, [
  ['acl.grant', 'workspace', 'share'],
  ['acl.revoke', 'workspace', 'share'],
  ['acl.set_link', 'workspace', 'share'],
  ['acl.request_access', 'workspace', 'read'],
  ['acl.decide_request', 'workspace', 'share'],
  ['acl.transfer_ownership', 'workspace', 'share'],
])
