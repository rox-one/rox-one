/**
 * Insight engine barrel (requirement E).
 *
 * Aggregate -> synthesize -> render: metrics aggregation, the Q&A slot
 * synthesis prompt/runner and the cached cognitive-profile block.
 */

export {
  aggregateMetrics,
  deriveSlotCandidates,
  DEFAULT_DAILY_LIMIT,
  DEFAULT_METRICS_WINDOW_DAYS,
  DEFAULT_MONTHLY_LIMIT,
  type AggregateMetricsOptions,
  type MetricsDraft,
} from './aggregate.ts'
export { buildSynthesisPrompt, synthesizeSlots, type SynthesizeSlotsInput } from './synthesis.ts'
export {
  buildCognitiveProfileBlock,
  clearCognitiveProfileCache,
  COGNITIVE_PROFILE_BASENAME,
  DEFAULT_MAX_CHARS,
  DEFAULT_MIN_CONFIDENCE,
  readCognitiveProfileCache,
  writeCognitiveProfileCache,
} from './cognitiveProfile.ts'