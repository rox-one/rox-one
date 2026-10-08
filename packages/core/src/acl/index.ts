/**
 * W1-04 (#1501) — ACL engine public surface (`@rox/core/acl`).
 */

export {
  ACL_ACTIONS,
  ACL_ACTION_ROX2_VERB,
  aclActionForRox2Verb,
  isAclAction,
  type AclAction,
} from './actions.ts'

export {
  ACL_ROLES,
  ACL_SPECIAL_ROLES,
  OPERATELY_ACCESS_LEVELS,
  ROLE_LEVEL,
  effectiveRole,
  isAclRole,
  isAclStoredRole,
  maxRole,
  minRole,
  normalizeRoleAlias,
  operatelyLevelForRole,
  roleAtLeast,
  roleFromOperatelyLevel,
  roleLevel,
  type AclRole,
  type AclSpecialRole,
  type AclStoredRole,
  type OperatelyAccessLevelName,
} from './roles.ts'

export {
  ACL_RESOURCE_TYPES,
  ACL_SUBJECT_TYPES,
  DEFAULT_ACL_CACHE_TTL_MS,
  DEFAULT_ACL_CONCURRENCY,
  GOAL_INHERITING_KINDS,
  GUEST_ROLE_CAP,
  LINK_SHAREABLE_KINDS,
  SPACE_VISIBLE_BY_DEFAULT_KINDS,
  aclResourceTypeForKind,
  chatInheritanceCap,
  createAcl,
  decide,
  inheritanceEdge,
  listingVisibility,
  spaceInheritanceCap,
  type Acl,
  type AclDecision,
  type AclDenyReason,
  type AclEngine,
  type AclEntryFact,
  type AclFactSource,
  type InheritanceEdge,
  type AclMembership,
  type AclPolicyFact,
  type AclPrincipal,
  type AclPrincipalGroups,
  type AclPrincipalKind,
  type AclPrincipalStatus,
  type AclResourceNode,
  type AclResourceType,
  type AclRoleResult,
  type AclRoleSource,
  type AclSubjectType,
  type CreateAclOptions,
  type ListingVisibility,
} from './evaluate.ts'

export { MemoryAclFacts } from './memory-facts.ts'

export { LOCAL_OWNER_PRINCIPAL_ID, createLocalAcl, type LocalAcl, type LocalAclOptions } from './local-shim.ts'

export { createAclTopicAuthorizer, parseTopicRef, type ParsedTopic, type TopicAuthorizer } from './topics.ts'

// Permission rules + matrix generator (DATA-MODEL §8.3; consumed by W1-10).
export {
  CONTEXTUAL_TAGS,
  CONTEXTUAL_TAG_ROLE,
  PERMISSION_MATRIX_TAG_SCENARIOS,
  PERMISSION_RULES,
  applyPermissionRule,
  generatePermissionMatrix,
  permissionRule,
  roleWithTags,
  type ContextualTag,
  type GeneratePermissionMatrixOptions,
  type PermissionBlocker,
  type PermissionContext,
  type PermissionMatrixRow,
  type PermissionOutcome,
  type PermissionRule,
} from '../entities/permissions.ts'
