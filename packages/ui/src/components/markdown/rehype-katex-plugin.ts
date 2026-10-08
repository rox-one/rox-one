/**
 * KaTeX rehype plugin + stylesheet, split out of the startup bundle (PERF-04).
 * Loaded by Markdown only when a message actually contains `$$` math.
 */
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

export default rehypeKatex
