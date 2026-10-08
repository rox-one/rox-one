/**
 * Lazily loaded rich markdown blocks (PERF-04).
 *
 * The mermaid (beautiful-mermaid + elkjs), PDF (react-pdf + pdf.js), KaTeX,
 * JSON-view, datatable and spreadsheet renderers together are several MB of
 * JavaScript that every window used to parse at startup, even though most
 * conversations never contain such a block. Each block now loads on first use;
 * until its chunk arrives the fence renders as the plain code block it falls
 * back to on errors anyway, so nothing is hidden while loading.
 */
import * as React from 'react'
import { CodeBlock } from './CodeBlock'
import type { MarkdownPdfBlockProps } from './MarkdownPdfBlock'
import type { MarkdownJsonBlockProps } from './MarkdownJsonBlock'
import type { MarkdownDatatableBlockProps } from './MarkdownDatatableBlock'
import type { MarkdownSpreadsheetBlockProps } from './MarkdownSpreadsheetBlock'

interface BlockProps {
  code: string
  className?: string
}

export interface LazyMarkdownMermaidBlockProps extends BlockProps {
  showExpandButton?: boolean
  tapToOpen?: boolean
  minHeight?: number
}

export interface LazyMarkdownLatexBlockProps extends BlockProps {}

type LazyBlock<P extends BlockProps> = React.FC<P> & {
  /** Start fetching the block's chunk without rendering it. */
  preload: () => Promise<unknown>
}

function lazyBlock<P extends BlockProps>(
  load: () => Promise<React.ComponentType<P>>,
  fallbackLanguage: string,
  displayName: string,
): LazyBlock<P> {
  const Fallback = ({ code, className }: BlockProps) => (
    <CodeBlock code={code} language={fallbackLanguage} mode="full" className={className} />
  )
  let pending: Promise<{ default: React.ComponentType<P> }> | null = null
  const loadModule = () => {
    pending ??= load().then(
      (Component) => ({ default: Component }),
      // A missing chunk (e.g. after an update) degrades to the same code
      // block the renderers show for invalid input instead of crashing the
      // surrounding message.
      () => ({ default: Fallback as React.ComponentType<P> }),
    )
    return pending
  }
  // Typed as a plain component: the blocks take no ref, and React.lazy's
  // ref-aware props type does not narrow for a generic P.
  const Lazy = React.lazy(loadModule) as unknown as React.ComponentType<P>
  const Block = ((props: P) => (
    <React.Suspense fallback={<Fallback code={props.code} className={props.className} />}>
      <Lazy {...props} />
    </React.Suspense>
  )) as LazyBlock<P>
  Block.displayName = displayName
  Block.preload = loadModule
  return Block
}

export const LazyMarkdownMermaidBlock = lazyBlock<LazyMarkdownMermaidBlockProps>(
  () => import('./MarkdownMermaidBlock').then((m) => m.MarkdownMermaidBlock),
  'mermaid',
  'LazyMarkdownMermaidBlock',
)

export const LazyMarkdownPdfBlock = lazyBlock<MarkdownPdfBlockProps>(
  () => import('./MarkdownPdfBlock').then((m) => m.MarkdownPdfBlock),
  'json',
  'LazyMarkdownPdfBlock',
)

export const LazyMarkdownLatexBlock = lazyBlock<LazyMarkdownLatexBlockProps>(
  () => import('./MarkdownLatexBlock').then((m) => m.MarkdownLatexBlock),
  'latex',
  'LazyMarkdownLatexBlock',
)

export const LazyMarkdownJsonBlock = lazyBlock<MarkdownJsonBlockProps>(
  () => import('./MarkdownJsonBlock').then((m) => m.MarkdownJsonBlock),
  'json',
  'LazyMarkdownJsonBlock',
)

export const LazyMarkdownDatatableBlock = lazyBlock<MarkdownDatatableBlockProps>(
  () => import('./MarkdownDatatableBlock').then((m) => m.MarkdownDatatableBlock),
  'json',
  'LazyMarkdownDatatableBlock',
)

export const LazyMarkdownSpreadsheetBlock = lazyBlock<MarkdownSpreadsheetBlockProps>(
  () => import('./MarkdownSpreadsheetBlock').then((m) => m.MarkdownSpreadsheetBlock),
  'json',
  'LazyMarkdownSpreadsheetBlock',
)
