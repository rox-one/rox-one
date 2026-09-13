export const PROCESS_RESULT_VERSION = 1 as const
export interface ProcessResult {
  outputText: string; transcriptLanguage: string; outputLanguage: string; answerLanguage: string
  appliedModules: string[]; unresolvedQuestions: string[]; assumptions: string[]
  sources: Array<{ sourceId: string; url?: string; title?: string }>; warnings: string[]
}
export function emptyProcessResult(partial: Partial<ProcessResult> = {}): ProcessResult {
  return {
    outputText: '', transcriptLanguage: 'und', outputLanguage: 'preserve', answerLanguage: 'preserve',
    appliedModules: [], unresolvedQuestions: [], assumptions: [], sources: [], warnings: [], ...partial,
  }
}
export function parseProcessResult(raw: unknown): { result: ProcessResult; repaired: boolean } {
  if (!raw || typeof raw !== 'object') return { result: emptyProcessResult({ warnings: ['invalid-json'] }), repaired: false }
  const obj = raw as Record<string, unknown>
  const result = emptyProcessResult({
    outputText: typeof obj.outputText === 'string' ? obj.outputText : '',
    transcriptLanguage: typeof obj.transcriptLanguage === 'string' ? obj.transcriptLanguage : 'und',
    outputLanguage: typeof obj.outputLanguage === 'string' ? obj.outputLanguage : 'preserve',
    answerLanguage: typeof obj.answerLanguage === 'string' ? obj.answerLanguage : 'preserve',
    appliedModules: Array.isArray(obj.appliedModules) ? obj.appliedModules.filter((v): v is string => typeof v === 'string') : [],
    unresolvedQuestions: Array.isArray(obj.unresolvedQuestions) ? obj.unresolvedQuestions.filter((v): v is string => typeof v === 'string') : [],
    assumptions: Array.isArray(obj.assumptions) ? obj.assumptions.filter((v): v is string => typeof v === 'string') : [],
    sources: Array.isArray(obj.sources) ? obj.sources.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const src = item as Record<string, unknown>
      if (typeof src.sourceId !== 'string') return []
      return [{ sourceId: src.sourceId, url: typeof src.url === 'string' ? src.url : undefined, title: typeof src.title === 'string' ? src.title : undefined }]
    }) : [],
    warnings: Array.isArray(obj.warnings) ? obj.warnings.filter((v): v is string => typeof v === 'string') : [],
  })
  if (!result.outputText) result.warnings.push('empty-output')
  return { result, repaired: false }
}
