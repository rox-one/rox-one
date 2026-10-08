/**
 * W1-09 (#1506) — Activity, notifications and the Inbox provider contract
 * (DATA-MODEL §9, TECH-SPEC §4.11, UI-SPEC §12).
 *
 * Dependency-free contracts shared by the workspace notify module, the
 * Electron Inbox/Review surfaces and every module that produces activity.
 */

export {
  DEFAULT_EMAIL_BATCH_WINDOW_MINUTES,
  NOTIFICATION_BATCH_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EMAIL_STATES,
  NOTIFICATION_KIND_TABLE,
  NOTIFICATION_KINDS,
  NOTIFICATION_PAYLOAD_KEYS,
  NOTIFICATION_SCHEMA_VERSION,
  REVIEW_ACTIONS,
  REVIEW_GROUPS,
  defaultChannelEnabled,
  isNotificationChannel,
  isNotificationKind,
  notificationKindDescriptor,
  notificationKindsForReviewGroup,
  tryNotificationKindDescriptor,
  type AudienceSource,
  type NotificationBatchStatus,
  type NotificationChannel,
  type NotificationEmailBatchRow,
  type NotificationEmailState,
  type NotificationKind,
  type NotificationKindDescriptor,
  type NotificationPayload,
  type NotificationPrefRow,
  type NotificationRow,
  type NotificationSpecVersion,
  type ReviewAction,
  type ReviewGroup,
} from './types.ts'

export {
  AUDIENCE_SOURCES,
  audienceSourcesFor,
  resolveAudience,
  type AudienceContext,
  type AudienceOptions,
  type AudienceResolution,
} from './audience.ts'

export {
  applyNotificationPrefUpdate,
  defaultChannelsFor,
  indexNotificationPrefs,
  isNotificationChannelList,
  mutedPrincipalsFor,
  notificationPrefKey,
  resolveNotificationPref,
  type NotificationPrefDefaults,
  type NotificationPrefUpdate,
  type ResolvedNotificationPref,
} from './prefs.ts'

export {
  MAX_PAYLOAD_DEPTH,
  MAX_PAYLOAD_ID_FIELDS,
  MAX_PAYLOAD_REFS,
  NOTIFICATION_TRIGGERS,
  collectEntityRefs,
  notificationTriggerFor,
  planNotifications,
  restrictNotificationPayload,
  type NotificationPlan,
  type NotificationSkipReason,
  type NotificationTriggerRule,
  type PlanNotificationsInput,
  type PlannedNotification,
} from './triggers.ts'

export {
  MAX_ACTIVITY_ITEMS,
  activityByDay,
  activityDayKey,
  activityItemFromEvent,
  createActivityState,
  moduleOfEventType,
  reduceActivity,
  type ActivityDayGroup,
  type ActivityItem,
  type ActivityState,
} from './activity.ts'

export {
  REVIEW_GROUP_ORDER,
  groupReviewItems,
  isReviewOverdue,
  mergeReviewItems,
  reviewCounts,
  reviewGroupForKind,
  type GroupReviewOptions,
  type ReviewCounts,
  type ReviewGroupView,
  type ReviewItem,
  type ReviewSource,
} from './review.ts'

export {
  BATCHED_NOTIFICATION_KINDS,
  EMAIL_WINDOW_MINUTES,
  coalesceNotificationIntoBatch,
  dueEmailBatches,
  emailDeliveryFor,
  openEmailBatch,
  planEmailDelivery,
  type CoalesceResult,
  type EmailDelivery,
  type EmailDeliveryPlan,
  type OpenEmailBatchInput,
} from './batching.ts'

export {
  ActivityRendererRegistry,
  type ActivityRendererRegistration,
} from './renderers-contract.ts'

export {
  MAX_MARK_READ_IDS,
  MAX_PREF_UPDATES,
  NOTIFICATIONS_MARK_ALL_READ_SCHEMA,
  NOTIFICATIONS_MARK_READ_SCHEMA,
  NOTIFICATIONS_UPDATE_PREFS_SCHEMA,
  NOTIFY_COMMAND_TYPES,
  bindNotifyCommands,
  getNotifyCommandHost,
  setNotifyCommandHost,
  type NotificationsMarkAllReadPayload,
  type NotificationsMarkReadPayload,
  type NotificationsUpdatePrefsPayload,
  type NotifyCommandContext,
  type NotifyCommandHost,
  type NotifyCommandResult,
  type NotifyCommandType,
} from './command-bindings.ts'