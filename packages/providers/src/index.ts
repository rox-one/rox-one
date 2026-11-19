/**
 * Public surface of `@rox/providers`.
 *
 * The router reads `PROVIDER_CAPABILITIES` to decide what a spec may ask
 * for, then builds one adapter per tenant config with `createDaytonaProvider`.
 */

export type {
  ProviderCapabilities,
  ProviderConfig,
  ProviderFactory,
  ProviderId,
  ProviderStreaming,
} from './types.ts';

export {
  PROVIDER_CAPABILITIES,
  PROVIDER_IDS,
  acceptTtl,
  getProviderCapabilities,
} from './capabilities.ts';

export {
  DAYTONA_AUTO_DELETE_MINUTES,
  DAYTONA_AUTO_STOP_MINUTES,
  DAYTONA_DEFAULT_API_URL,
  DAYTONA_DEFAULT_TOOLBOX_URL,
  DAYTONA_PROVIDER_ID,
  createDaytonaProvider,
} from './daytona.ts';

export type { ModalPlan, ModalProviderConfig } from './modal.ts';

export {
  MODAL_DEFAULT_TIMEOUT_SEC,
  MODAL_PROVIDER_ID,
  createModalProvider,
} from './modal.ts';
