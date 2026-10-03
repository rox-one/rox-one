import type { TFunction } from 'i18next'
import { safeDisplayText } from './measurements'

export function coverageMissingText(missing: readonly string[], t: TFunction, separator = ', '): string {
  return missing.map(code => code === 'unconfirmed-host-process-termination'
    ? t('runtimeMap.processTerminationUnknown') : safeDisplayText(code, 160)).join(separator)
}
