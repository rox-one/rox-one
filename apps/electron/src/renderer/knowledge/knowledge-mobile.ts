/**
 * Knowledge mobile chrome threshold (W2 compact / WebUI).
 *
 * Independent of AppShell's 768px auto-compact: Knowledge stacks the
 * notebook tree full-width and grows tap targets below 640px, or whenever
 * the shell is already in compact mode.
 */

export const KNOWLEDGE_MOBILE_WIDTH = 640

export function shouldUseKnowledgeMobileChrome(args: {
  width: number
  compactShell?: boolean
}): boolean {
  if (args.compactShell) return true
  return args.width < KNOWLEDGE_MOBILE_WIDTH
}
