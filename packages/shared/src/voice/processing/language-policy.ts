export type PreserveLanguage = 'preserve' | 'en' | 'ru'
export interface LanguageDecision {
  transcriptOutputLanguage: 'en' | 'ru' | string
  answerLanguage: 'en' | 'ru' | string
  needsUserChoice: boolean
}
const DOMINANT_THRESHOLD = 0.7
export function resolveLanguages(input: { detectedLanguage?: string; transcriptOutput: PreserveLanguage; answerLanguage: PreserveLanguage; mixed?: boolean }): LanguageDecision {
  const detected = normalizeLang(input.detectedLanguage)
  const mixed = input.mixed === true || !detected
  if (input.transcriptOutput === 'preserve' && mixed) {
    return {
      transcriptOutputLanguage: detected ?? 'und',
      answerLanguage: input.answerLanguage === 'preserve' ? (detected ?? 'und') : input.answerLanguage,
      needsUserChoice: true,
    }
  }
  return {
    transcriptOutputLanguage: input.transcriptOutput === 'preserve' ? (detected ?? 'und') : input.transcriptOutput,
    answerLanguage: input.answerLanguage === 'preserve' ? (detected ?? 'und') : input.answerLanguage,
    needsUserChoice: false,
  }
}
export function isDominantLanguage(counts: Record<string, number>): string | undefined {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  if (total === 0) return undefined
  const [code, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? []
  if (!code || n == null) return undefined
  return n / total >= DOMINANT_THRESHOLD ? normalizeLang(code) : undefined
}
function normalizeLang(code?: string): string | undefined {
  if (!code) return undefined
  const lower = code.toLowerCase()
  if (lower.startsWith('ru')) return 'ru'
  if (lower.startsWith('en')) return 'en'
  return lower.slice(0, 2)
}
