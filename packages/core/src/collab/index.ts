/**
 * W1-14 (#1511) — Collaboration contracts (TECH-SPEC §11, ADR-U18).
 *
 * Frozen surface for every collaboration feature of wave 2: presence, doc
 * awareness, comment anchors, suggestions, field conflicts, read receipts and
 * shared calendars. Package COL (messenger / docs surfaces) consumes these
 * types and the two reference handlers in `@rox/server-core/collab`; it does
 * not redefine any of them.
 */

export {
  OBJECT_PRESENCE_TTL_SECONDS, PRESENCE_CHANGED_THROTTLE_MS, PRESENCE_DEVICES, PRESENCE_HEARTBEAT_INTERVAL_MS, PRESENCE_IDLE_AWAY_MS,
  PRESENCE_STATUSES, PRESENCE_STATUS_RANK, PRESENCE_TTL_SECONDS, isPresenceDevice, isPresenceStatus, liveViewers, mergePresenceStatus,
  objectPresenceKey, presenceAudience, presenceChangedAllowed, presenceKey, presenceTransition, statusForHeartbeat,
} from './presence.ts'
export type {
  PresenceDevice, PresenceHeartbeatPayload, PresenceHeartbeatResult, PresenceObjectPayload, PresenceObjectResult, PresenceState,
  PresenceStatus, PresenceTransition,
} from './presence.ts'

export {
  FOLLOW_SCROLL_THROTTLE_MS, PEER_COLOR_CHROMA, PEER_COLOR_HUES, PEER_COLOR_LIGHTNESS, PEER_LABEL_IDLE_MS, awarenessCapabilityFor,
  awarenessPeers, awarenessReadOnly, followViewport, peerColorFor,
} from './awareness.ts'
export type {
  AwarenessCapability, AwarenessCursor, AwarenessPeer, AwarenessSelection, AwarenessState, AwarenessUser, AwarenessViewport,
} from './awareness.ts'

export { ANCHOR_QUOTE_MAX, anchorIsCollapsed, anchorResolution, decodeBase64, decodeYAnchor, encodeBase64, encodeYAnchor, isUsableAnchor } from './anchor.ts'
export type { AnchorResolution, YAnchor } from './anchor.ts'

export {
  SUGGESTION_DECISIONS, SUGGESTION_KINDS, SUGGESTION_STATUSES, canDecideSuggestion, commenterUpdateAllowed, isSuggestionDecision,
  isSuggestionKind, staleSuggestionIds, suggestionStatusAfterSync, suggestionSummary,
} from './suggestions.ts'
export type {
  DecideSuggestionPayload, DecideSuggestionResult, DocSuggestion, SuggestionDecision, SuggestionDenial, SuggestionKind, SuggestionStatus,
  SuggestionUpdateSummary, SyncSuggestionsPayload, SyncSuggestionsResult,
} from './suggestions.ts'

export {
  CONFLICT_CODE, RESERVED_PATCH_FIELDS, applyFieldPatch, conflictingFields, conflictError, conflictReceiptError, decideFieldPatch,
  fieldConflicts, isFieldPatch, nextFieldRevisions,
} from './field-conflict.ts'
export type { ConflictError, FieldConflict, FieldPatchDecision, FieldRevisions } from './field-conflict.ts'

export {
  CHAT_KINDS, DOC_VIEW_DEBOUNCE_MS, READ_RECEIPT_MEMBER_CAP, READ_RECEIPT_THROTTLE_MS, docViewers, nextLastReadSeq, readBy,
  readChangedAllowed, readChangedVisible, recordDocView,
} from './receipts.ts'
export type { ChatKind, ChatMemberRead, DocViewRecord, DocViewer, MarkReadPayload, ReadBy, ReadReceiptPrivacy } from './receipts.ts'

export {
  CALENDAR_MEMBER_ROLES, CALENDAR_MEMBER_SUBJECT_TYPES, CALENDAR_ROLE_RANK, FREE_BUSY_VISIBLE_FIELDS, aclRoleForCalendarMember,
  effectiveCalendarRole, eventBlocksTime, freeBusyBlocks, freeSlots, isCalendarMemberRole, mergeBusyBlocks, redactCalendarFrame,
  redactEventFields, redactForFreeBusy,
} from './calendar.ts'
export type {
  BusyBlock, CalendarEventTiming, CalendarMember, CalendarMemberRole, CalendarMemberSubjectType, FreeBusyPayload, FreeBusyResult,
  TimeRange,
} from './calendar.ts'

export { COLLAB_COMMAND_RISK, COLLAB_CONTRACT_TYPES, collabRoutineRisk, suggestionDecisionRisk } from './commands.ts'
export type {
  CollabContractType, MarkReadResult, PresenceHeartbeatAck, PresenceViewersResult, RecordDocViewResult,
} from './commands.ts'