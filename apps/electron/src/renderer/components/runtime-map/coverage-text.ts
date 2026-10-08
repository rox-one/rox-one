import type { TFunction } from 'i18next'
import { safeDisplayText } from './measurements'

export function coverageMissingText(missing: readonly string[], t: TFunction, separator = ', '): string {
  const translated: Readonly<Record<string, string>> = {
    'unconfirmed-host-process-termination': 'runtimeMap.processTerminationUnknown',
    'native-tool-parameters': 'runtimeMap.toolParametersUnknown',
    'native-provider-tool-normalization': 'runtimeMap.providerToolNormalizationUnknown',
  }
  return missing.map(code => translated[code]
    ? t(translated[code]!) : safeDisplayText(code, 160)).join(separator)
}
