/**
 * UnifiedDiffViewer - Diff viewer for pre-computed unified diff strings
 *
 * Used for Codex file operations which provide unified diff patches
 * instead of original/modified content strings.
 *
 * Uses @pierre/diffs parsePatchFiles to parse the unified diff string
 * and renders via the FileDiff component with proper theming.
 */

import * as React from 'react'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { FileDiff, type FileDiffProps } from '@pierre/diffs/react'
import { DIFFS_TAG_NAME, type FileDiffMetadata } from '@pierre/diffs'
import { parseUnifiedDiff } from './diff-stats'

export { getUnifiedDiffStats } from './diff-stats'
import { cn } from '../../lib/utils'
import { LANGUAGE_MAP } from './language-map'
import { registerCraftShikiThemes } from './registerShikiThemes'
import { getShikiThemeType } from './zedShikiThemeData'
import { useShikiTheme } from '../../context/ShikiThemeContext'

// Register the diffs-container custom element if not already registered
// (shared with ShikiDiffViewer - safe to call multiple times)
if (typeof HTMLElement !== 'undefined' && !customElements.get(DIFFS_TAG_NAME)) {
  class FileDiffContainer extends HTMLElement {
    constructor() {
      super()
      if (this.shadowRoot != null) return
      this.attachShadow({ mode: 'open' })
    }
  }
  customElements.define(DIFFS_TAG_NAME, FileDiffContainer)
}

registerCraftShikiThemes()

export interface UnifiedDiffViewerProps {
  /** Raw unified diff string (e.g., from Codex fileChange.diff) */
  unifiedDiff: string
  /** File path - used for display in header */
  filePath?: string
  /** Diff style: 'unified' (stacked) or 'split' (side-by-side) */
  diffStyle?: 'unified' | 'split'
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Shiki theme name (e.g., 'dracula', 'github-dark'). When provided, uses the matching
   *  Shiki theme natively. Falls back to craft-dark/craft-light (transparent bg) if not set. */
  shikiTheme?: string
  /** Disable background highlighting on changed lines */
  disableBackground?: boolean
  /** Whether to hide pierre's native file header (filename + stats). Default: true */
  disableFileHeader?: boolean
  /** Callback when the file header is clicked (e.g. to open the file in an editor).
   *  When provided, the header becomes clickable with cursor: pointer. */
  onFileHeaderClick?: (filePath: string) => void
  /** Callback when ready */
  onReady?: () => void
  /** Additional class names */
  className?: string
}


/**
 * UnifiedDiffViewer - Renders pre-computed unified diff strings
 */
export function UnifiedDiffViewer({
  unifiedDiff,
  filePath = 'file',
  diffStyle = 'unified',
  theme = 'light',
  shikiTheme,
  disableBackground = false,
  disableFileHeader = true,
  onFileHeaderClick,
  onReady,
  className,
}: UnifiedDiffViewerProps) {
  const hasCalledReady = useRef(false)
  const [isReady, setIsReady] = useState(false)
  const contextShikiTheme = useShikiTheme()

  // Parse the unified diff
  const fileDiff = useMemo(() => {
    return parseUnifiedDiff(unifiedDiff, filePath)
  }, [unifiedDiff, filePath])

  // Diff options - use the app's Shiki theme if available, otherwise fall back
  // to craft-dark/craft-light which have transparent bg for CSS variable theming
  const resolvedThemeName = shikiTheme || contextShikiTheme || (theme === 'dark' ? 'craft-dark' : 'craft-light')
  const resolvedThemeType = getShikiThemeType(resolvedThemeName) ?? theme

  // When onFileHeaderClick is provided, inject CSS to make the header look clickable
  const unsafeCSS = onFileHeaderClick
    ? '[data-diffs-header] { cursor: pointer; } [data-diffs-header]:hover [data-title] { text-decoration: underline; }'
    : undefined

  const options: FileDiffProps<undefined>['options'] = useMemo(() => ({
    theme: resolvedThemeName,
    diffStyle,
    diffIndicators: 'bars',
    disableBackground,
    lineDiffType: 'word',
    overflow: 'scroll',
    disableFileHeader,
    themeType: resolvedThemeType,
    unsafeCSS,
  }), [resolvedThemeName, resolvedThemeType, diffStyle, disableBackground, disableFileHeader, unsafeCSS])

  // Call onReady after first render
  useEffect(() => {
    if (!hasCalledReady.current && onReady) {
      hasCalledReady.current = true
      // Give Shiki time to highlight
      const timer = setTimeout(() => {
        setIsReady(true)
        onReady()
      }, 100)
      return () => {
        clearTimeout(timer)
        hasCalledReady.current = false // Reset so re-mounts (including StrictMode) re-arm the timer
      }
    }
  }, [onReady, unifiedDiff, fileDiff])

  // Attach a click listener to the file header inside pierre's shadow DOM.
  const containerRef = useRef<HTMLDivElement>(null)
  const onFileHeaderClickRef = useRef(onFileHeaderClick)
  onFileHeaderClickRef.current = onFileHeaderClick

  useEffect(() => {
    if (!onFileHeaderClick || disableFileHeader) return

    // Wait briefly for pierre to render the header into the shadow DOM
    const timer = setTimeout(() => {
      const diffsContainer = containerRef.current?.querySelector(DIFFS_TAG_NAME)
      const header = diffsContainer?.shadowRoot?.querySelector('[data-diffs-header]')
      if (!header) return

      const handleClick = () => {
        onFileHeaderClickRef.current?.(filePath)
      }
      header.addEventListener('click', handleClick)
      // Store cleanup ref so we can remove listener
      ;(header as any).__craftClickCleanup = () => header.removeEventListener('click', handleClick)
    }, 150)

    return () => {
      clearTimeout(timer)
      const diffsContainer = containerRef.current?.querySelector(DIFFS_TAG_NAME)
      const header = diffsContainer?.shadowRoot?.querySelector('[data-diffs-header]')
      if (header) {
        ;(header as any).__craftClickCleanup?.()
      }
    }
  }, [filePath, disableFileHeader, onFileHeaderClick])

  // Use CSS variable so custom themes are respected
  const backgroundColor = 'var(--background)'

  // If we couldn't parse the diff, show a fallback
  if (!fileDiff) {
    return (
      <div
        ref={containerRef}
        className={cn(
          'h-full w-full overflow-auto p-4',
          className
        )}
        style={{
          backgroundColor,
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <pre className="text-foreground/70 whitespace-pre-wrap">{unifiedDiff || '(empty diff)'}</pre>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full overflow-auto transition-opacity duration-200',
        className
      )}
      style={{
        backgroundColor,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <FileDiff
        fileDiff={fileDiff}
        options={options}
        className="min-h-full h-full"
      />
    </div>
  )
}

