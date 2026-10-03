import type { Measurement, RuntimeEvent, UsageRecord } from './types'
import { known, unknown } from './types'
import { runtimeProjectionEvents, type RuntimeProjection } from './projector'
export interface RuntimeUsageSummary {
  inputTokens: Measurement<number>; outputTokens: Measurement<number>
  cacheReadTokens: Measurement<number>; cacheWriteTokens: Measurement<number>; cost: Measurement<number>
  currency?: string; calls: number; aggregateRecords: UsageRecord[]; partial: boolean
}
function total(values: (Measurement<number> | undefined)[], field: string): Measurement<number> {
  if (!values.length) return unknown('not-emitted')
  if (values.some(value => !value || value.state === 'unknown')) return unknown('partial')
  const knownValues = values as Extract<Measurement<number>, { state: 'known' }>[]
  return known(knownValues.reduce((sum,item)=>sum+item.value,0), `Deduplicated provider usage: ${field}`, knownValues.some(item=>item.origin==='estimated')?'estimated':'derived')
}
/** A final provider sample replaces its interim sample. Parent aggregates are never added to child calls. */
export function summarizeUsage(input: RuntimeProjection | readonly RuntimeEvent[]): RuntimeUsageSummary {
  const events = Array.isArray(input) ? input : runtimeProjectionEvents(input as RuntimeProjection)
  const calls = new Map<string, { usage: UsageRecord; seq: number }>()
  for (const event of events) if(event.kind==='usage.reported') { const usage=event.payload.usage; const key=JSON.stringify([event.workspaceId,event.rootRunId,usage.providerCallId]); const previous=calls.get(key)
    if(!previous || (!previous.usage.final && usage.final) || previous.usage.final===usage.final && event.seq>previous.seq) calls.set(key,{usage,seq:event.seq})
  }
  const all=[...calls.values()].map(item=>item.usage); const self=all.filter(item=>item.scope==='self'); const aggregates=all.filter(item=>item.scope==='aggregate')
  const currencies=[...new Set(self.filter(item=>item.cost?.state==='known').map(item=>item.currency ?? 'unknown'))]
  const summary: RuntimeUsageSummary={inputTokens:total(self.map(item=>item.inputTokens),'input'),outputTokens:total(self.map(item=>item.outputTokens),'output'),cacheReadTokens:total(self.map(item=>item.cacheReadTokens),'cache read'),cacheWriteTokens:total(self.map(item=>item.cacheWriteTokens),'cache write'),cost:currencies.length>1?unknown('partial'):total(self.map(item=>item.cost),'cost'),currency:currencies.length===1?currencies[0]:undefined,calls:self.length,aggregateRecords:aggregates,partial:!self.length || self.some(item=>!item.final)}
  summary.partial ||= summary.inputTokens.state==='unknown'||summary.outputTokens.state==='unknown'
  return summary
}
