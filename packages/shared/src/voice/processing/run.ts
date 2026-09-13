import { COMPOUND_FALLBACK_MODEL, SPARK_PROCESS_ALIAS, VOICE_ENDPOINTS, voiceUrl } from '../contracts.ts'
import { compilePrompt, type CompilePromptInput } from './compiler.ts'
import { parseProcessResult, type ProcessResult } from './result-schema.ts'

export interface ProcessHttp { fetch(input: string, init: RequestInit): Promise<Response> }
export class VoiceProcessError extends Error {
  readonly code: 'unavailable' | 'tools-on' | 'schema' | 'timeout'
  constructor(code: VoiceProcessError['code'], message: string) {
    super(message); this.name = 'VoiceProcessError'; this.code = code
  }
}

export async function runProcessing(
  input: CompilePromptInput,
  http: ProcessHttp,
  options: { baseUrl?: string; token: string; sparkAvailable?: boolean; compoundToolsOffProven?: boolean; enrichmentEnabled: boolean },
): Promise<{ result: ProcessResult; model: string; degraded: boolean }> {
  const compiled = compilePrompt(input)
  const models = options.sparkAvailable === false ? [COMPOUND_FALLBACK_MODEL] : [SPARK_PROCESS_ALIAS, COMPOUND_FALLBACK_MODEL]
  let lastError: unknown
  for (const model of models) {
    if (model === COMPOUND_FALLBACK_MODEL && !options.compoundToolsOffProven && !options.enrichmentEnabled) continue
    try {
      const response = await http.fetch(voiceUrl(VOICE_ENDPOINTS.process, options.baseUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          tools: options.enrichmentEnabled ? ['web_search', 'visit_website'] : [],
          system: compiled.system,
          user: compiled.user,
          promptVersion: compiled.version,
          promptHash: compiled.hash,
        }),
      })
      if (!response.ok) { lastError = new VoiceProcessError('unavailable', `Process ${response.status}`); continue }
      const json = await response.json() as { executed_tools?: string[]; result?: unknown }
      if (!options.enrichmentEnabled && Array.isArray(json.executed_tools) && json.executed_tools.length > 0) {
        throw new VoiceProcessError('tools-on', 'Search tools ran while enrichment is off')
      }
      if (Array.isArray(json.executed_tools) && json.executed_tools.includes('code_execution')) {
        throw new VoiceProcessError('tools-on', 'Code execution is forbidden')
      }
      const parsed = parseProcessResult(json.result ?? json)
      if (!parsed.result.outputText) { lastError = new VoiceProcessError('schema', 'Empty process output'); continue }
      return { result: parsed.result, model, degraded: model !== SPARK_PROCESS_ALIAS }
    } catch (error) { lastError = error }
  }
  throw lastError instanceof VoiceProcessError ? lastError : new VoiceProcessError('unavailable', 'Processing unavailable')
}
