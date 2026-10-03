import type { Measurement, RuntimeLaunch } from '@rox/core/runtime-trace'
import { safeDisplayText, timestampText } from './measurements'

export interface RuntimeLaunchDetail { id: string; labelKey: string; value?: string; valueKey?: string; measurement?: Measurement<number> }

/** These rows retain source measurements, including estimates and unknowns. */
export function runtimeLaunchDetails(launch: RuntimeLaunch): RuntimeLaunchDetail[] {
  const rows: RuntimeLaunchDetail[] = []
  const text = (id: string, labelKey: string, value?: string) => {
    const observed = safeDisplayText(value) || undefined
    rows.push({ id, labelKey, value: observed, valueKey: observed ? undefined : 'runtimeMap.unknown' })
  }
  const timestamp = (id: string, labelKey: string, measurement?: Measurement<number>) => {
    const value = timestampText(measurement)
    rows.push({ id, labelKey, value, valueKey: value ? undefined : 'runtimeMap.unknown', measurement: value ? measurement : undefined })
  }
  if (launch.kind === 'scheduled' || launch.occurrenceId) text('occurrence', 'runtimeMap.occurrence', launch.occurrenceId)
  if (launch.kind === 'scheduled' || launch.timezone) text('timezone', 'runtimeMap.timezone', launch.timezone)
  if (launch.kind === 'scheduled' || launch.scheduledAt) timestamp('planned', 'runtimeMap.plannedTime', launch.scheduledAt)
  timestamp('dispatched', 'runtimeMap.dispatchTime', launch.dispatchedAt)
  return rows
}
