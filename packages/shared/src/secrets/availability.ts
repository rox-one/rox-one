/**
 * Infisical availability for settings GET — never resolves secret values.
 */

import { InfisicalProvider, type InfisicalProviderOptions } from './providers/infisical.ts';
import type { SecretErrorCode, SecretRefEntry } from './types.ts';

export interface InfisicalAvailability {
  available: boolean;
  errorCode?: Extract<SecretErrorCode, 'INFISICAL_UNAVAILABLE'>;
}

/** Settings GET payload: refs only (no values) plus Infisical availability. */
export interface SecretRefsSettingsPayload {
  refs: SecretRefEntry[];
  infisical: InfisicalAvailability;
}

export async function diagnoseInfisicalAvailability(
  options?: InfisicalProviderOptions,
): Promise<InfisicalAvailability> {
  const provider = new InfisicalProvider(options);
  if (await provider.isAvailable()) return { available: true };
  return { available: false, errorCode: 'INFISICAL_UNAVAILABLE' };
}
