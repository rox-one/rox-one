/**
 * W1-03 (#1500) — Domain events, realtime topics and sequencing.
 */

export {
  DOMAIN_EVENT_TYPES,
  DOMAIN_EVENT_TYPE_PATTERN,
  isDomainEventType,
  isKnownDomainEventType,
  type DomainEvent,
  type DomainEventDraft,
  type DomainEventType,
} from './types.ts'

export {
  MAX_SUBSCRIBE_TOPICS,
  MAX_TOPICS_PER_CLIENT,
  REALTIME_RPC,
  MAX_TOPIC_ID_LENGTH,
  REALTIME_EVENT_TYPES,
  TOPIC_KINDS,
  entityTopic,
  formatTopic,
  isRealtimeEventType,
  normalizeTopic,
  parseTopic,
  topicAclTarget,
  userTopic,
  type ParsedTopic,
  type RealtimeEventFrame,
  type RealtimeFrame,
  type RealtimeSnapshotRequiredFrame,
  type RealtimeSubscribeRequest,
  type RealtimeSubscribeResult,
  type RealtimeSubscribeStatus,
  type RealtimeSubscribeTopic,
  type RealtimeSubscribeTopicResult,
  type Topic,
  type TopicAclTarget,
  type TopicKind,
} from './topics.ts'

export {
  DEFAULT_MAX_TOPIC_WINDOWS,
  DEFAULT_TOPIC_REPLAY_CAPACITY,
  DEFAULT_TOPIC_WINDOW_IDLE_MS,
  TopicLog,
  TopicSeqTracker,
  type SeqAcceptResult,
  type TopicLogOptions,
  type TopicReplay,
} from './sequence.ts'

export {
  EventProjectionRegistry,
  ProjectorError,
  defaultEventProjection,
  systemPingedProjection,
  type EventProjector,
  type RealtimePublication,
} from './projection.ts'
