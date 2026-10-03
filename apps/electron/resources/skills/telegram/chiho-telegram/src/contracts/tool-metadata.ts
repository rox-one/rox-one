export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface McpToolClientMetadata {
  title: string;
  annotations: McpToolAnnotations;
  outputSchema: Record<string, unknown>;
}

const SUCCESS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
  required: ["ok"],
  properties: {
    ok: { type: "boolean", const: true },
  },
};

const NULLABLE_STRING_SCHEMA = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;

const DIALOG_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["peer", "archived", "pinned", "unreadCount", "lastMessage"],
  properties: {
    peer: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "displayName", "username"],
      properties: {
        id: { type: "string" },
        kind: { type: "string", enum: ["user", "chat", "channel", "self"] },
        displayName: { type: "string" },
        username: NULLABLE_STRING_SCHEMA,
      },
    },
    archived: { type: "boolean" },
    pinned: { type: "boolean" },
    unreadCount: { type: "integer", minimum: 0 },
    lastMessage: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "date", "preview"],
          properties: {
            id: { type: "integer" },
            date: { type: "string", format: "date-time" },
            preview: { type: "string" },
          },
        },
      ],
    },
  },
} as const;

const MESSAGE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "date",
    "editedAt",
    "outgoing",
    "pinned",
    "sender",
    "text",
    "hasMedia",
  ],
  properties: {
    id: { type: "integer", minimum: 1 },
    date: { type: "string", format: "date-time" },
    editedAt: NULLABLE_STRING_SCHEMA,
    outgoing: { type: "boolean" },
    pinned: { type: "boolean" },
    sender: {
      type: "object",
      additionalProperties: false,
      required: ["id", "displayName", "username"],
      properties: {
        id: { type: "string" },
        displayName: { type: "string" },
        username: NULLABLE_STRING_SCHEMA,
      },
    },
    text: { type: "string" },
    hasMedia: { type: "boolean" },
    replyToMessageId: {
      anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
    },
  },
} as const;

const MEDIA_INFO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "fileName", "mimeType", "sizeBytes", "downloadable"],
  properties: {
    type: { type: "string" },
    fileName: NULLABLE_STRING_SCHEMA,
    mimeType: NULLABLE_STRING_SCHEMA,
    sizeBytes: {
      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    },
    width: {
      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    },
    height: {
      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    },
    durationSeconds: {
      anyOf: [{ type: "number", minimum: 0 }, { type: "null" }],
    },
    downloadable: { type: "boolean" },
  },
} as const;

const SYNC_STATUS_VALUES = [
  "queued",
  "running",
  "waiting_for_telegram",
  "enriching",
  "complete",
  "failed",
] as const;

const SYNC_RUN_PROPERTIES = {
  runId: { type: "string" },
  status: { type: "string", enum: SYNC_STATUS_VALUES },
  mode: { type: "string", enum: ["recent", "full"] },
  includeArchived: { type: "boolean" },
  phase: {
    type: "string",
    enum: ["active", "archived", "contacts", "enrichment", "complete"],
  },
  fetchedCount: { type: "integer", minimum: 0 },
  persistedCount: { type: "integer", minimum: 0 },
  skippedCount: { type: "integer", minimum: 0 },
  failedCount: { type: "integer", minimum: 0 },
  resumeAt: NULLABLE_STRING_SCHEMA,
  lastErrorCode: NULLABLE_STRING_SCHEMA,
} as const;

function exactOutputSchema(
  required: string[],
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["ok", ...required],
    properties: {
      ok: { type: "boolean", const: true },
      ...properties,
    },
  };
}

const READ_INTERNAL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} satisfies McpToolAnnotations;

const READ_EXTERNAL = {
  ...READ_INTERNAL,
  openWorldHint: true,
} satisfies McpToolAnnotations;

const WRITE_INTERNAL = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} satisfies McpToolAnnotations;

const WRITE_EXTERNAL = {
  ...WRITE_INTERNAL,
  openWorldHint: true,
} satisfies McpToolAnnotations;

function metadata(
  title: string,
  annotations: McpToolAnnotations,
): McpToolClientMetadata {
  return {
    title,
    annotations,
    outputSchema: SUCCESS_OUTPUT_SCHEMA,
  };
}

const COMMUNITY_TOPIC_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["id", "title", "isClosed", "isPinned", "unreadCount", "unreadMentionsCount", "unreadReactionsCount"],
  properties: { id: { type: "integer" }, title: { type: "string" }, isClosed: { type: "boolean" }, isPinned: { type: "boolean" }, unreadCount: { type: "integer" }, unreadMentionsCount: { type: "integer" }, unreadReactionsCount: { type: "integer" } },
} as const;
const COMMUNITY_INVITE_LINK_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["link", "isMyLink", "isPrimary", "isRevoked", "createdAt", "usage", "pendingApprovals", "approvalNeeded"],
  properties: { link: { type: "string" }, isMyLink: { type: "boolean" }, isPrimary: { type: "boolean" }, isRevoked: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, usage: { type: "integer" }, pendingApprovals: { type: "integer" }, approvalNeeded: { type: "boolean" } },
} as const;
const COMMUNITY_INVITE_MEMBER_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["userId", "displayName", "username", "joinedAt", "isPendingRequest", "approvedByUserId"],
  properties: { userId: { type: "string" }, displayName: { type: "string" }, username: NULLABLE_STRING_SCHEMA, joinedAt: { type: "string", format: "date-time" }, isPendingRequest: { type: "boolean" }, approvedByUserId: NULLABLE_STRING_SCHEMA },
} as const;
const COMMUNITY_ADMIN_EVENT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["id", "occurredAt", "actorUserId", "actorDisplayName", "actionType"],
  properties: { id: { type: "string" }, occurredAt: { type: "string", format: "date-time" }, actorUserId: { type: "string" }, actorDisplayName: { type: "string" }, actionType: { type: "string" } },
} as const;
const COMMUNITY_PERSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["userId", "displayName", "username", "isContact", "isMutualContact", "commonChatsReported"],
  properties: { userId: { type: "string" }, displayName: { type: "string" }, username: NULLABLE_STRING_SCHEMA, isContact: { type: "boolean" }, isMutualContact: { type: "boolean" }, commonChatsReported: { type: "integer" } },
} as const;
const COMMUNITY_COMMON_CHAT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["peer", "title"],
  properties: { peer: { type: "string" }, title: { type: "string" } },
} as const;

const TOOL_METADATA: Record<string, McpToolClientMetadata> = {
  "auth.status": metadata("Check local Telegram connection", READ_INTERNAL),
  "account.whoami": metadata("Show the local Telegram account", READ_EXTERNAL),
  "inventory.summary": {
    title: "Summarize Telegram inventory",
    annotations: READ_EXTERNAL,
    outputSchema: exactOutputSchema(
      ["telegramDialogs", "chihoDialogs", "sync"],
      {
        telegramDialogs: {
          type: "object",
          additionalProperties: false,
          required: ["activeTotal", "archivedTotal", "allTotal", "measuredAt"],
          properties: {
            activeTotal: { type: "integer", minimum: 0 },
            archivedTotal: { type: "integer", minimum: 0 },
            allTotal: { type: "integer", minimum: 0 },
            measuredAt: { type: "string", format: "date-time" },
          },
        },
        chihoDialogs: {
          type: "object",
          additionalProperties: false,
          required: ["syncedTotal", "lastSyncedAt"],
          properties: {
            syncedTotal: {
              anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
            },
            lastSyncedAt: NULLABLE_STRING_SCHEMA,
          },
        },
        sync: {
          type: "object",
          additionalProperties: false,
          required: ["status", "runId"],
          properties: {
            status: {
              anyOf: [
                { type: "string", enum: SYNC_STATUS_VALUES },
                { type: "null" },
              ],
            },
            runId: NULLABLE_STRING_SCHEMA,
          },
        },
      },
    ),
  },
  "dialogs.list": {
    title: "List live Telegram chats",
    annotations: READ_EXTERNAL,
    outputSchema: exactOutputSchema(
      ["source", "location", "inventoryTotal", "hasMore", "nextCursor", "dialogs"],
      {
        source: { type: "string", const: "telegram" },
        location: { type: "string", enum: ["active", "archived", "all"] },
        inventoryTotal: { type: "integer", minimum: 0 },
        hasMore: { type: "boolean" },
        nextCursor: NULLABLE_STRING_SCHEMA,
        dialogs: { type: "array", items: DIALOG_ITEM_SCHEMA },
      },
    ),
  },
  "crm.dialogs.list": {
    title: "List synced CRM chats",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(
      ["source", "syncedTotal", "lastSyncedAt", "hasMore", "nextCursor", "dialogs"],
      {
        source: { type: "string", const: "chiho-crm" },
        syncedTotal: { type: "integer", minimum: 0 },
        lastSyncedAt: NULLABLE_STRING_SCHEMA,
        hasMore: { type: "boolean" },
        nextCursor: NULLABLE_STRING_SCHEMA,
        dialogs: { type: "array", items: DIALOG_ITEM_SCHEMA },
      },
    ),
  },
  "contacts.count": {
    title: "Count Telegram contacts",
    annotations: READ_EXTERNAL,
    outputSchema: exactOutputSchema(
      ["source", "contactTotal", "fetchedAt"],
      {
        source: { type: "string", const: "telegram-contacts" },
        contactTotal: { type: "integer", minimum: 0 },
        fetchedAt: { type: "string", format: "date-time" },
      },
    ),
  },
  "contacts.list": {
    title: "List Telegram contacts",
    annotations: READ_EXTERNAL,
    outputSchema: exactOutputSchema(
      ["source", "contactTotal", "hasMore", "nextCursor", "contacts"],
      {
        source: { type: "string", const: "telegram-contacts" },
        contactTotal: { type: "integer", minimum: 0 },
        hasMore: { type: "boolean" },
        nextCursor: NULLABLE_STRING_SCHEMA,
        contacts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["peerId", "displayName", "username"],
            properties: {
              peerId: { type: "string" },
              displayName: { type: "string" },
              username: NULLABLE_STRING_SCHEMA,
            },
          },
        },
      },
    ),
  },
  "chat.read": metadata("Read a Telegram chat", READ_EXTERNAL),
  "message.get": {
    title: "Get one Telegram message",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(["peer", "message"], {
      peer: { type: "string" },
      message: MESSAGE_ITEM_SCHEMA,
    }),
  },
  "thread.read": {
    title: "Read a Telegram reply thread",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(
      ["peer", "rootMessageId", "threadKind", "hasMore", "nextCursor", "messages"],
      {
        peer: { type: "string" },
        rootMessageId: { type: "integer", minimum: 1 },
        threadKind: { type: "string", enum: ["replies", "discussion", "none"] },
        hasMore: { type: "boolean" },
        nextCursor: NULLABLE_STRING_SCHEMA,
        messages: { type: "array", items: MESSAGE_ITEM_SCHEMA },
      },
    ),
  },
  "scheduled.list": {
    title: "List scheduled Telegram messages",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(["peer", "hasMore", "nextCursor", "messages"], {
      peer: { type: "string" },
      hasMore: { type: "boolean" },
      nextCursor: NULLABLE_STRING_SCHEMA,
      messages: { type: "array", items: MESSAGE_ITEM_SCHEMA },
    }),
  },
  "media.info": {
    title: "Inspect Telegram media",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(["peer", "messageId", "media"], {
      peer: { type: "string" },
      messageId: { type: "integer", minimum: 1 },
      media: { anyOf: [MEDIA_INFO_SCHEMA, { type: "null" }] },
    }),
  },
  "media.download": {
    title: "Create a Telegram media download",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(
      ["peer", "messageId", "downloadRef", "expiresAt", "media"],
      {
        peer: { type: "string" },
        messageId: { type: "integer", minimum: 1 },
        downloadRef: { type: "string" },
        expiresAt: { type: "string", format: "date-time" },
        media: MEDIA_INFO_SCHEMA,
      },
    ),
  },
  "members.list": {
    title: "List Telegram chat members",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(
      ["peer", "chatType", "filter", "query", "reportedTotal", "returnedCount", "completeness", "visibility", "limitReason", "hasMore", "nextCursor", "members"],
      {
        peer: { type: "string" },
        chatType: { type: "string" },
        filter: { type: "string" },
        query: { type: "string" },
        reportedTotal: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
        returnedCount: { type: "integer", minimum: 0 },
        completeness: { type: "string", enum: ["complete", "partial", "unknown"] },
        visibility: { type: "string", enum: ["visible", "limited", "unavailable"] },
        limitReason: NULLABLE_STRING_SCHEMA,
        hasMore: { type: "boolean" },
        nextCursor: NULLABLE_STRING_SCHEMA,
        members: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "displayName", "username", "status", "title"],
            properties: {
              id: { type: "string" },
              displayName: { type: "string" },
              username: NULLABLE_STRING_SCHEMA,
              status: { type: "string" },
              title: NULLABLE_STRING_SCHEMA,
            },
          },
        },
      },
    ),
  },
  "member.get": {
    title: "Get one Telegram chat member",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(["peer", "userId", "membership", "reason", "member"], {
      peer: { type: "string" }, userId: { type: "string" },
      membership: { type: "string", enum: ["member", "not_member", "unknown"] },
      reason: NULLABLE_STRING_SCHEMA,
      member: { anyOf: [
        { type: "object", additionalProperties: false,
          required: ["id", "displayName", "username", "status", "title"],
          properties: {
            id: { type: "string" }, displayName: { type: "string" },
            username: NULLABLE_STRING_SCHEMA, status: { type: "string" }, title: NULLABLE_STRING_SCHEMA,
          } },
        { type: "null" },
      ] },
    }),
  },
  "chat.capabilitiesGet": {
    title: "Inspect Telegram chat capabilities",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(["peer", "chatType", "membership", "memberCountReported", "participantVisibility", "participantsHidden", "canViewParticipants", "adminRights", "defaultPermissions", "capabilities"], {
      peer: { type: "string" }, chatType: { type: "string" },
      membership: { type: "string", enum: ["member", "admin", "creator", "left", "unknown"] },
      memberCountReported: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
      participantVisibility: { type: "string", enum: ["visible", "limited", "unavailable", "unknown"] },
      participantsHidden: { type: "boolean" },
      canViewParticipants: { anyOf: [{ type: "boolean" }, { type: "null" }] },
      adminRights: { type: "object", additionalProperties: { type: "boolean" } },
      defaultPermissions: { type: "object", additionalProperties: { type: "boolean" } },
      capabilities: { type: "object", additionalProperties: { anyOf: [{ type: "boolean" }, { type: "null" }] } },
    }),
  },
  "attention.list": { title: "List selected chat attention", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peers", "hasMore", "nextCursor", "chats"],
    { peers: { type: "array", items: { type: "string" } }, hasMore: { type: "boolean" }, nextCursor: NULLABLE_STRING_SCHEMA, chats: { type: "array", items: { type: "object", additionalProperties: false, required: ["peer", "unreadCount", "unreadMentionsCount", "unreadReactionsCount", "isManuallyUnread"], properties: { peer: { type: "string" }, unreadCount: { type: "integer" }, unreadMentionsCount: { type: "integer" }, unreadReactionsCount: { type: "integer" }, isManuallyUnread: { type: "boolean" } } } } },
  ) },
  "drafts.list": { title: "List selected native drafts", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peers", "hasMore", "nextCursor", "drafts"],
    { peers: { type: "array", items: { type: "string" } }, hasMore: { type: "boolean" }, nextCursor: NULLABLE_STRING_SCHEMA, drafts: { type: "array", items: { type: "object", additionalProperties: false, required: ["peer", "text", "updatedAt"], properties: { peer: { type: "string" }, text: { type: "string" }, updatedAt: { type: "string" } } } } },
  ) },
  "draft.save": { title: "Save a native Telegram draft", annotations: { ...WRITE_EXTERNAL, destructiveHint: true }, outputSchema: exactOutputSchema(
    ["peer", "saved", "cleared"],
    { peer: { type: "string" }, saved: { type: "boolean" }, cleared: { type: "boolean" } },
  ) },
  "forumTopics.list": { title: "List forum topics", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peer", "hasMore", "nextCursor", "topics"],
    { peer: { type: "string" }, hasMore: { type: "boolean" }, nextCursor: NULLABLE_STRING_SCHEMA, topics: { type: "array", items: COMMUNITY_TOPIC_SCHEMA } },
  ) },
  "joinRequests.list": { title: "List join requests", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peer", "hasMore", "nextCursor", "requests"],
    { peer: { type: "string" }, hasMore: { type: "boolean" }, nextCursor: NULLABLE_STRING_SCHEMA, requests: { type: "array", items: COMMUNITY_INVITE_MEMBER_SCHEMA } },
  ) },
  "inviteLinks.list": { title: "List invite links", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peer", "hasMore", "nextCursor", "links"],
    { peer: { type: "string" }, hasMore: { type: "boolean" }, nextCursor: NULLABLE_STRING_SCHEMA, links: { type: "array", items: COMMUNITY_INVITE_LINK_SCHEMA } },
  ) },
  "inviteLinkMembers.list": { title: "List invite link members", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peer", "hasMore", "nextCursor", "members"],
    { peer: { type: "string" }, hasMore: { type: "boolean" }, nextCursor: NULLABLE_STRING_SCHEMA, members: { type: "array", items: COMMUNITY_INVITE_MEMBER_SCHEMA } },
  ) },
  "chat.adminLog": { title: "Read recent chat admin actions", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peer", "hasMore", "nextCursor", "events"],
    { peer: { type: "string" }, hasMore: { type: "boolean" }, nextCursor: NULLABLE_STRING_SCHEMA, events: { type: "array", items: COMMUNITY_ADMIN_EVENT_SCHEMA } },
  ) },
  "person.contextGet": { title: "Get authorized person context", annotations: READ_INTERNAL, outputSchema: exactOutputSchema(
    ["peer", "person", "commonChats"],
    { peer: { type: "string" }, person: COMMUNITY_PERSON_SCHEMA, commonChats: { type: "array", items: COMMUNITY_COMMON_CHAT_SCHEMA } },
  ) },
  "updates.poll": {
    title: "Poll Telegram updates",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(
      ["epoch", "gapDetected", "nextCursor", "events", "reconcileWith"],
      {
        epoch: { type: "string" },
        gapDetected: { type: "boolean" },
        nextCursor: { type: "string" },
        events: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "type", "occurredAt", "peer", "messageId"],
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              occurredAt: { type: "string", format: "date-time" },
              peer: NULLABLE_STRING_SCHEMA,
              messageId: {
                anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
              },
            },
          },
        },
        reconcileWith: {
          type: "array",
          items: { type: "string", enum: ["dialogs.list", "chat.read"] },
        },
      },
    ),
  },
  "message.actionPreview": {
    title: "Preview a Telegram message action",
    annotations: WRITE_INTERNAL,
    outputSchema: exactOutputSchema(["preview"], {
      preview: {
        type: "object",
        additionalProperties: false,
        required: ["previewId", "action", "payloadHash", "createdAt", "expiresAt", "summary"],
        properties: {
          previewId: { type: "string" },
          action: { type: "string" },
          payloadHash: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
          summary: { type: "string" },
        },
      },
    }),
  },
  "message.actionApproved": {
    title: "Execute an approved Telegram message action",
    annotations: { ...WRITE_EXTERNAL, destructiveHint: true, idempotentHint: true },
    outputSchema: exactOutputSchema(
      ["previewId", "action", "completedAt", "idempotentReplay"],
      {
        previewId: { type: "string" },
        action: { type: "string" },
        completedAt: { type: "string", format: "date-time" },
        idempotentReplay: { type: "boolean" },
        resultMessageId: {
          anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
        },
      },
    ),
  },
  "media.sendPreview": {
    title: "Preview a Telegram media send",
    annotations: WRITE_INTERNAL,
    outputSchema: exactOutputSchema(["preview"], {
      preview: {
        type: "object",
        additionalProperties: false,
        required: ["previewId", "payloadHash", "uploadSha256", "createdAt", "expiresAt", "summary"],
        properties: {
          previewId: { type: "string" },
          payloadHash: { type: "string" },
          uploadSha256: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          expiresAt: { type: "string", format: "date-time" },
          summary: { type: "string" },
        },
      },
    }),
  },
  "media.sendApproved": {
    title: "Send approved Telegram media",
    annotations: { ...WRITE_EXTERNAL, destructiveHint: true, idempotentHint: true },
    outputSchema: exactOutputSchema(
      ["previewId", "messageId", "completedAt", "idempotentReplay"],
      {
        previewId: { type: "string" },
        messageId: { type: "integer", minimum: 1 },
        completedAt: { type: "string", format: "date-time" },
        idempotentReplay: { type: "boolean" },
      },
    ),
  },
  "search.messages": metadata("Search Telegram messages", READ_EXTERNAL),
  "folders.list": metadata("List Telegram folders", READ_EXTERNAL),
  "folders.update": metadata("Update Telegram folders", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "folders.create": metadata("Create a Telegram folder", WRITE_EXTERNAL),
  "folders.addDialog": metadata(
    "Add a chat to a Telegram folder",
    WRITE_EXTERNAL,
  ),
  "folders.removeDialog": metadata("Remove a chat from a Telegram folder", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "outbox.preview": metadata("Prepare Telegram messages", WRITE_EXTERNAL),
  "outbox.sendApproved": metadata("Send approved Telegram messages", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
    idempotentHint: true,
  }),
  "message.sendDraft": metadata("Send a Telegram message", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "members.invitePreview": metadata(
    "Prepare Telegram member invites",
    WRITE_EXTERNAL,
  ),
  "members.inviteApproved": metadata("Invite approved Telegram members", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
    idempotentHint: true,
  }),
  "groups.leavePreview": metadata(
    "Prepare leaving Telegram groups",
    WRITE_EXTERNAL,
  ),
  "groups.leaveApproved": metadata("Leave approved Telegram groups", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
    idempotentHint: true,
  }),
  "tags.get": metadata("Show CRM tags", READ_INTERNAL),
  "tags.set": metadata("Set CRM tags", {
    ...WRITE_INTERNAL,
    destructiveHint: true,
  }),
  "tags.clear": metadata("Clear CRM tags", {
    ...WRITE_INTERNAL,
    destructiveHint: true,
  }),
  "tags.suggest": metadata("Suggest or apply CRM tags", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "company.get": metadata("Show a linked company", READ_INTERNAL),
  "company.link": metadata("Link a company", {
    ...WRITE_INTERNAL,
    destructiveHint: true,
  }),
  "company.unlink": metadata("Unlink a company", {
    ...WRITE_INTERNAL,
    destructiveHint: true,
  }),
  "company.suggest": metadata("Suggest or apply a company", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "tasks.today": metadata("List tasks due today", READ_INTERNAL),
  "tasks.add": metadata("Add a follow-up task", WRITE_INTERNAL),
  "tasks.done": metadata("Complete a follow-up task", {
    ...WRITE_INTERNAL,
    destructiveHint: true,
  }),
  "tasks.suggest": metadata("Suggest or apply follow-up tasks", WRITE_EXTERNAL),
  "summary.show": metadata("Show a chat summary", READ_INTERNAL),
  "summary.refresh": metadata("Refresh chat summaries", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "nudge.generate": metadata("Generate a follow-up message", WRITE_EXTERNAL),
  "rules.list": metadata("List automation rules", READ_INTERNAL),
  "rules.add": metadata("Add an automation rule", WRITE_INTERNAL),
  "rules.disable": metadata("Disable an automation rule", {
    ...WRITE_INTERNAL,
    destructiveHint: true,
  }),
  "rules.delete": metadata("Delete an automation rule", {
    ...WRITE_INTERNAL,
    destructiveHint: true,
  }),
  "rules.run": metadata("Run automation rules", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "rules.dryRun": metadata(
    "Preview automation rule results",
    WRITE_EXTERNAL,
  ),
  "rules.log": metadata("List automation activity", READ_INTERNAL),
  "sync.backfill": metadata("Backfill the local Telegram database", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
  "sync.once": {
    title: "Start or resume Telegram sync",
    annotations: { ...WRITE_EXTERNAL, destructiveHint: true, idempotentHint: true },
    outputSchema: exactOutputSchema(
      Object.keys(SYNC_RUN_PROPERTIES),
      SYNC_RUN_PROPERTIES,
    ),
  },
  "sync.status": {
    title: "Show Telegram sync status",
    annotations: READ_INTERNAL,
    outputSchema: exactOutputSchema(
      Object.keys(SYNC_RUN_PROPERTIES),
      SYNC_RUN_PROPERTIES,
    ),
  },
  "session.logout": metadata("Disconnect the local Telegram account", {
    ...WRITE_EXTERNAL,
    destructiveHint: true,
  }),
};

export function getMcpToolClientMetadata(toolName: string) {
  const clientMetadata = TOOL_METADATA[toolName];
  if (!clientMetadata) {
    throw new Error(`Missing MCP client metadata for ${toolName}.`);
  }
  return clientMetadata;
}
