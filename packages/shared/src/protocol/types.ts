/**
 * Wire protocol types for the WS-based RPC layer.
 *
 * Shared between server (main process / headless) and client (renderer / Node).
 */

// ---------------------------------------------------------------------------
// Message envelope
// ---------------------------------------------------------------------------

export type MessageType =
  | 'handshake'
  | 'handshake_ack'
  | 'connect.challenge'
  | 'request'
  | 'response'
  | 'event'
  | 'error'
  | 'sequence_ack'

/**
 * Advertised protocol feature block (handshake_ack `features`).
 *
 * Optional for backwards compatibility: an ack that omits it means "server did
 * not advertise", and clients MUST assume every channel is available.
 */
export interface ProtocolFeatures {
  /** Method channel names − every `RPC_CHANNELS` value. */
  methods: string[]
  /** Broadcast event channel names − every `BroadcastEventMap` key. */
  events: string[]
  /** Capability tokens the server can drive/accept. */
  capabilities: string[]
}

/** Advertised transport policy (handshake_ack `policy`). */
export interface ProtocolPolicy {
  /** Max WS frame payload in bytes. */
  maxPayloadBytes: number
}

export interface MessageEnvelope {
  /** Correlation ID. UUIDv4 for requests; echoed in responses. */
  id: string
  type: MessageType
  /** Required for request / response / event / error. */
  channel?: string
  /** Request args or event payload. */
  args?: unknown[]
  /** Response payload. */
  result?: unknown
  /** Structured error. */
  error?: WireError
  /** Sent on handshake / handshake_ack. */
  protocolVersion?: string
  /** Sent on handshake by the client. */
  workspaceId?: string
  /** Sent on handshake for remote auth. */
  token?: string
  /** Assigned by server in handshake_ack. */
  clientId?: string
  /** Server identity stamp on outgoing events. For MultiClient source disambiguation. */
  serverId?: string
  /** Electron webContents.id, sent on handshake by local clients. */
  webContentsId?: number
  /**
   * Ephemeral proof issued by Electron main for its own local renderer.
   * It is accepted only by a server-side trusted binding resolver and is never
   * retained, logged, or used as a general authentication credential.
   */
  localClientProof?: string
  /** Client capabilities advertised on handshake. */
  clientCapabilities?: string[]
  /**
   * e2.2 device-auth challenge: server-minted per-connection nonce sent in a
   * `connect.challenge` frame; the client echoes it on `handshake` together
   * with its `deviceProof`. Flat so the same field carries the issued nonce
   * and the echoed copy.
   */
  challengeNonce?: string
  /** e2.2: freshness stamp (epoch ms) of the server-issued challenge nonce. */
  challengeIssuedAt?: number
  /** e2.2: client's HMAC over `challengeNonce`, keyed by the ROX identity credential. */
  deviceProof?: string
  /** Server-registered channels, sent in handshake_ack. Clients use this to avoid calling unavailable channels. */
  registeredChannels?: string[]
  /** Protocol feature block, sent in handshake_ack. Optional for back-compat. */
  features?: ProtocolFeatures
  /** Transport policy, sent in handshake_ack. Optional for back-compat. */
  policy?: ProtocolPolicy

  // -- Reliable delivery fields --

  /** Per-client monotonic delivery sequence number, assigned when an event is targeted to that client. */
  seq?: number
  /** Client's last processed per-client seq — sent in sequence_ack and reconnect handshake. */
  lastSeq?: number
  /** Previous clientId — sent by client on reconnect handshake. */
  reconnectClientId?: string
  /** True when handshake_ack is for a reconnection (vs fresh connect). */
  reconnected?: boolean
  /** True when server buffer was evicted — client must do a full state refresh. */
  stale?: boolean
  /** Server app version, sent in handshake_ack. Clients can use this for compatibility checks. */
  serverVersion?: string
}

export interface WireError {
  code: ErrorCode
  message: string
  data?: unknown
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'HANDLER_ERROR'
  | 'CHANNEL_NOT_FOUND'
  | 'AUTH_FAILED'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'SESSION_NOT_IDLE'
  | 'SESSION_ID_CONFLICT'
  | 'ARTIFACT_NOT_PORTABLE'
  | 'TRANSFER_TOO_LARGE'
  | 'TRANSFER_TIMEOUT'
  | 'TRANSFER_VERIFICATION_FAILED'
  | 'REQUEST_TIMEOUT'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CLIENT_DISCONNECTED'
  | 'CLIENT_REQUEST_TIMEOUT'
  | 'BROWSER_NO_CAPABLE_CLIENT'
  | 'BROWSER_INSTANCE_NOT_OWNED'
  | 'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED'
  | 'BROWSER_REMOTE_EVALUATE_BLOCKED'
  | 'TOOL_NOT_IN_MANIFEST'
  | 'MARKETPLACE_ENTRY_NOT_FOUND'
  | 'MARKETPLACE_ENTRY_NOT_INSTALLED'
  | 'MARKETPLACE_OPERATION_IN_FLIGHT'
  | 'MARKETPLACE_TOOL_INSTALL_FAILED'
  // Registry trust gate (wave-3 c2.7): the catalog verdict refuses the install
  // before any network work; review-required needs explicit operator confirmation.
  | 'REGISTRY_TRUST_BLOCKED'
  | 'REGISTRY_TRUST_REVIEW_REQUIRED'
  // Knowledge provider (P1 read-only), spec 03 §3.2 KnowledgeErrorCode
  | 'CONNECTION_UNAVAILABLE'
  | 'UNSUPPORTED_OPERATION'
  | 'NOT_FOUND'
  | 'HASH_CONFLICT'
  // Native journal revision conflicts (Notes/canonical entity mutations).
  | 'CONFLICT'
  | 'INVALID_REF'
  | 'CAPABILITY_DISABLED'
  | 'TLS_REQUIRED'
  | 'PROVIDER_ERROR'
  | 'LOCAL_ONLY_DENIED'
  | 'SECRET_ENVVAR_DENIED'
  | 'DOCUMENT_VALIDATION_FAILED'
  | 'DOCUMENT_AUTHORITY_CHANGED'
  | 'DOCUMENT_BUSY'
  | 'DOCUMENT_RESULT_UNAVAILABLE'
  // Authenticated workspace authority: constant domain errors, never resource details.
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'WORKSPACE_MISMATCH'
  | 'INVALID_PAYLOAD'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'CURSOR_INVALID'
  | 'PROVIDER_UNAVAILABLE'
  // Board widgets (wave 3, row b2.3): a widget revision whose authored kind has
  // no shipping renderer is refused as a typed kind error rather than stored.
  | 'UNSUPPORTED_WIDGET_KIND'
  // Uniform render-ticket refusal: one constant code for every reason a widget
  // ticket is rejected (unknown, expired, stale revision/generation, foreign
  // workspace), so the reason never leaks to the sandbox.
  | 'WIDGET_TICKET_REFUSED'
  // Session collaboration visibility (a2.5): a non-owner write is denied by the
  // session's visibility instead of the workspace role.
  | 'SESSION_READ_ONLY'
  | 'SESSION_OWNER_ONLY'
  // a2.5 suggestions: a `suggest` session refuses a non-owner DIRECT write (they
  // must propose a suggestion instead), and the suggestion store reports its own
  // invalid/limit/not-found refusals as typed codes.
  | 'SESSION_SUGGEST_ONLY'
  | 'SESSION_SUGGESTION_INVALID'
  | 'SESSION_SUGGESTION_LIMIT'
  | 'SESSION_SUGGESTION_NOT_FOUND'
  // Named operator role ceiling (a1.2): the connection's role lacks the method's
  // required scope. Typed so a client can render a role-specific message.
  | 'OPERATOR_ACCESS_DENIED'
  // Node-plane fencing (wave 4, row e2.2): a settlement (`nodes:invokeResult`)
  // or heartbeat arrives from a connection that is not the node's live one —
  // e.g. superseded by a newer registration or an impostor. Typed so the
  // stale connection is refused rather than silently ignored, and the pending
  // invoke stays unsettled for its real owner.
  | 'NODE_CONNECTION_MISMATCH'
  // Voice provider registry failures (S8): typed so a client can branch on an
  // unconfigured provider instead of receiving a collapsed HANDLER_ERROR.
  | 'unconfigured'
  | 'unknown-provider'
  | 'unsupported'

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'HANDLER_ERROR',
  'CHANNEL_NOT_FOUND',
  'AUTH_FAILED',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'SESSION_NOT_IDLE',
  'SESSION_ID_CONFLICT',
  'ARTIFACT_NOT_PORTABLE',
  'TRANSFER_TOO_LARGE',
  'TRANSFER_TIMEOUT',
  'TRANSFER_VERIFICATION_FAILED',
  'REQUEST_TIMEOUT',
  'CAPABILITY_UNAVAILABLE',
  'CLIENT_DISCONNECTED',
  'CLIENT_REQUEST_TIMEOUT',
  'BROWSER_NO_CAPABLE_CLIENT',
  'BROWSER_INSTANCE_NOT_OWNED',
  'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED',
  'BROWSER_REMOTE_EVALUATE_BLOCKED',
  'TOOL_NOT_IN_MANIFEST',
  'MARKETPLACE_ENTRY_NOT_FOUND',
  'MARKETPLACE_ENTRY_NOT_INSTALLED',
  'MARKETPLACE_OPERATION_IN_FLIGHT',
  'MARKETPLACE_TOOL_INSTALL_FAILED',
  'REGISTRY_TRUST_BLOCKED',
  'REGISTRY_TRUST_REVIEW_REQUIRED',
  'CONNECTION_UNAVAILABLE',
  'UNSUPPORTED_OPERATION',
  'NOT_FOUND',
  'HASH_CONFLICT',
  'CONFLICT',
  'INVALID_REF',
  'CAPABILITY_DISABLED',
  'TLS_REQUIRED',
  'PROVIDER_ERROR',
  'LOCAL_ONLY_DENIED',
  'SECRET_ENVVAR_DENIED',
  'DOCUMENT_VALIDATION_FAILED',
  'DOCUMENT_AUTHORITY_CHANGED',
  'DOCUMENT_BUSY',
  'DOCUMENT_RESULT_UNAVAILABLE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'WORKSPACE_MISMATCH',
  'INVALID_PAYLOAD',
  'REVISION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'SCHEMA_VERSION_UNSUPPORTED',
  'CURSOR_INVALID',
  'PROVIDER_UNAVAILABLE',
  'UNSUPPORTED_WIDGET_KIND',
  'WIDGET_TICKET_REFUSED',
  'SESSION_READ_ONLY',
  'SESSION_OWNER_ONLY',
  'SESSION_SUGGEST_ONLY',
  'SESSION_SUGGESTION_INVALID',
  'SESSION_SUGGESTION_LIMIT',
  'SESSION_SUGGESTION_NOT_FOUND',
  'OPERATOR_ACCESS_DENIED',
  'NODE_CONNECTION_MISMATCH',
  'unconfigured',
  'unknown-provider',
  'unsupported',
])

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value)
}

/**
 * Sender-side helper for throwing transport errors with a typed `code`.
 *
 * Class identity is lost across the wire — the transport reconstructs a plain
 * `Error` with `.code` on the receiving side. Receivers MUST branch on
 * `err.code === 'X'`, never `err instanceof CodedError`.
 */
export class CodedError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'CodedError'
  }
}

/** Enforce confidentiality before either native client opens a socket or sends a secret. */
export function assertNativeCredentialTransport(url: string, token?: string): void {
  if (!token?.startsWith('na_') && !token?.startsWith('ne_')) return
  const target = new URL(url)
  const loopback = target.hostname === '127.0.0.1' || target.hostname === '[::1]'
    || target.hostname === 'localhost'
  if (target.protocol !== 'wss:' && !(target.protocol === 'ws:' && loopback)) {
    throw new CodedError('TLS_REQUIRED', 'Native credentials require TLS')
  }
}

// ---------------------------------------------------------------------------
// Push target (server → clients)
// ---------------------------------------------------------------------------

export type PushTarget =
  | { to: 'all'; exclude?: string }
  | { to: 'workspace'; workspaceId: string; exclude?: string }
  | { to: 'client'; clientId: string }

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = '1.0'

/** Heartbeat interval in ms. Server pings every 30s. */
export const HEARTBEAT_INTERVAL_MS = 30_000

/** Client that misses this many pongs gets terminated. */
export const HEARTBEAT_MAX_MISSED = 2

/** Default request timeout in ms. */
export const REQUEST_TIMEOUT_MS = 30_000

// -- Reliable delivery constants --

/** Max events to retain per client in the ring buffer. */
export const EVENT_BUFFER_MAX_SIZE = 500

/** Events older than this are evicted from the buffer. */
export const EVENT_BUFFER_TTL_MS = 30_000

/** How long to retain a disconnected client's buffer for potential reconnect. */
export const DISCONNECTED_CLIENT_TTL_MS = 60_000

/** Client sends a sequence_ack every N ms. */
export const SEQUENCE_ACK_INTERVAL_MS = 5_000
