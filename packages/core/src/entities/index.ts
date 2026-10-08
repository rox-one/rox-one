/**
 * W1-01/W1-02 — Entity registry, references and links.
 *
 * Named re-export blocks keep the surface explicit (mirrors `../rox2/index.ts`).
 */

// Kind registry (54 kinds; re-exports the frozen Rox2 subset).
export {
  ENTITY_KINDS,
  ENTITY_ICON_NAMES,
  ENTITY_KIND_DESCRIPTORS,
  NEW_ENTITY_KINDS,
  ROX2_ENTITY_KINDS,
  formatRox2EntityId,
  isEntityKind,
  kindDescriptor,
  parseRox2EntityId,
  type Authority,
  type EntityKind,
  type IconName,
  type KindCapabilities,
  type KindDescriptor,
  type ModuleId,
  type NewEntityKind,
  type Rox2EntityKind,
  type SearchCategory,
} from './kinds.ts'

// Kind alias normalisation.
export { KIND_ALIASES, normalizeKindAlias } from './aliases.ts'

// Reference grammar.
export {
  EntityRefFormatError,
  entityRefEquals,
  entityRefKey,
  formatEntityRef,
  parseEntityRef,
  type EntityRef,
  type RefError,
  type RefErrorCode,
  type Result,
} from './refs.ts'

// `rox://` route map.
export {
  ENTITY_ROUTE_PREFIXES,
  KIND_ROUTE_BUILDERS,
  entityDeepLink,
  entityRoute,
  isEntityRoutePrefix,
} from './routes.ts'

// Entity links (W1-02).
export {
  ENTITY_LINK_SCHEMA_VERSION,
  ENTITY_RELATIONS,
  NEW_ENTITY_RELATIONS,
  ROX2_RELATION_KINDS,
  ROX2_RELATIONS,
  entityLinkDedupeKey,
  isEntityRelation,
  type EntityLink,
  type EntityLinkAnchor,
  type EntityRelation,
} from './links.ts'

// Resolver contracts + LRU (W1-02).
export {
  EntityResolutionCache,
  type Actor,
  type EntityResolutionRequest,
  type Resolver,
  type ResolverHost,
} from './resolver.ts'

// Preview contract (W1-02).
export {
  PREVIEW_STATUSES,
  applyPreviewRedaction,
  isRedactedPreviewRef,
  isRestrictedPreview,
  previewModelFromEntityPreview,
  redactedEntityPreview,
  restrictPreview,
  type Badge,
  type EntityPreview,
  type PreviewAction,
  type PreviewActionKind,
  type PreviewField,
  type PreviewModel,
  type PreviewModelDates,
  type PreviewModelExtras,
  type PreviewModelPerson,
  type PreviewModelProgress,
  type PreviewStatus,
  type RedactedEntityPreview,
  type RestrictedPreview,
} from './preview.ts'