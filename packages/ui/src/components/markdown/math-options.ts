/**
 * Shared remark-math configuration for markdown rendering.
 *
 * We intentionally disable single-dollar inline math so currency strings
 * (e.g. $100, $2M–$4M) remain plain text.
 */
export const MARKDOWN_MATH_OPTIONS = {
  singleDollarTextMath: false,
} as const

/**
 * Cheap pre-check for whether KaTeX may be needed (it is loaded lazily).
 * With single-dollar math disabled, KaTeX renders only `$$` math and
 * ```math / ~~~math fences (rehype-katex handles `language-math` code).
 */
export function markdownMayContainMath(content: string): boolean {
  return content.includes('$$') || /(?:```|~~~)[ \t]*math\b/.test(content)
}
