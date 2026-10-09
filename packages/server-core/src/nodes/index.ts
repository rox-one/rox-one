/**
 * f.9 — node/device model: registry, presence TTL and bounded pending invokes.
 *
 * Clean-room re-expression of the OpenClaw gateway node model
 * (port-analysis row f.9; upstream `src/gateway/node-registry.ts:175`).
 * Declared caps/commands are claims; the server allowlist is authoritative.
 */

export {
  DEFAULT_PRESENCE_TTL_MS,
  PresenceTracker,
  type PresenceStatus,
  type PresenceTrackerOptions,
} from './presence.ts'

export {
  DEFAULT_INVOKE_TIMEOUT_MS,
  DEFAULT_MAX_PENDING_PER_NODE,
  PendingInvokeTracker,
  type CreatePendingInvoke,
  type InvokeError,
  type InvokeErrorCode,
  type PendingInvokeHandle,
  type PendingInvokeOwner,
  type PendingInvokeTrackerOptions,
  type TerminalInvokeResult,
} from './pending-invokes.ts'

export {
  NodeRegistry,
  type InvokeOwnershipRefusal,
  type InvokeOwnershipRefusalCode,
  type InvokeRefusal,
  type InvokeRefusalCode,
  type InvokeSettlement,
  type NodeAllowlist,
  type NodeDeclaration,
  type NodeInvokeDispatch,
  type NodeRegistryOptions,
  type NodeView,
  type PresenceSweepResult,
  type RegisteredNode,
} from './registry.ts'

export {
  NodeClient,
  type NodeClientOptions,
  type NodeInvokeHandler,
  type NodeInvokeRequest,
} from './node-client.ts'