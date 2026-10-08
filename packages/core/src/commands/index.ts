/**
 * W1-03 (#1500) — Domain command bus contracts (TECH-SPEC §3.4).
 *
 * Distinct from `platform/commands` (S-04 UI command palette).
 */

export {
  COMMAND_TYPE_PATTERN,
  DEFAULT_MAX_COMMAND_PAYLOAD_BYTES,
  MAX_COMMAND_ID_LENGTH,
  MAX_COMMAND_PAYLOAD_BYTES,
  canonicalCommandRequest,
  canonicalJson,
  createCommandEnvelope,
  isCommandType,
  payloadByteLength,
  type CommandAuthorityHint,
  type CommandEnvelope,
  type CommandOrigin,
  type CommandType,
  type CreateCommandEnvelopeOptions,
} from './envelope.ts'

export {
  COMMAND_RECEIPT_STATUSES,
  conflictReceipt,
  duplicateReceipt,
  isEffectiveReceipt,
  isTerminalReceipt,
  queuedReceipt,
  rejectedReceipt,
  type CommandReceipt,
  type CommandReceiptError,
  type CommandReceiptStatus,
} from './receipt.ts'

export {
  COMMAND_ERROR_CODES,
  CommandConflict,
  CommandRejection,
  isCommandErrorCode,
  type CommandErrorCode,
} from './errors.ts'

export {
  CommandRegistry,
  CommandRegistryError,
  PLACEHOLDER_PAYLOAD_SCHEMA,
  type CapabilityReason,
  type CommandActor,
  type CommandAuthority,
  type CommandCapability,
  type CommandDefinition,
  type CommandHandler,
  type CommandHandlerContext,
  type CommandHandlerResult,
  type CommandRegistryOptions,
  type CommandRiskContext,
  type ExecutionAuthority,
  type RiskClass,
  type SchemaLike,
} from './registry.ts'

export {
  BUILT_IN_COMMAND_STAGES,
  CommandMiddlewareChain,
  composeCommandMiddleware,
  type CommandMiddleware,
  type CommandPipelineContext,
} from './pipeline.ts'

export {
  LOCAL_OWNER_AUTHORIZER,
  authorize,
  createDefaultAuthorizer,
  type Authorizer,
  type AuthorizerPrincipal,
} from './authorizer.ts'

export { dispatchCommand, type CommandClient } from './client.ts'

export {
  CATALOGUE_FLAGS,
  COMMAND_CATALOGUE,
  SYSTEM_PING_SCHEMA,
  moduleCatalogue,
  registerCommandCatalogue,
  type CatalogueEntry,
  type SystemPingPayload,
} from './catalogue/index.ts'
