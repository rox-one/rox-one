/**
 * PDFPreviewOverlay - In-app PDF preview using Mozilla's pdf.js via react-pdf.
 *
 * Renders PDFs using the react-pdf library, which wraps pdfjs-dist.
 * Supports multiple items with arrow navigation in the header.
 *
 * The PDF is loaded from a Uint8Array (via IPC) and rendered to canvas.
 * The pdf.js worker handles decoding and rendering in a background thread.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Page, pdfjs } from 'react-pdf'
import { FileText, Minus, Plus, Search } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'
import { ItemNavigator } from './ItemNavigator'
import { findMatchingPages } from './pdf-search'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure pdf.js worker using Vite's ?url import for cross-platform dev/prod compatibility
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

interface PreviewItem {
  src: string
  label?: string
}

interface PdfTextDocument {
  numPages: number
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>
  }>
}

export interface PDFPreviewOverlayProps {
  isOpen: boolean
  onClose: () => void
  /** Absolute file path for the PDF (single item / backward compat) */
  filePath: string
  /** Multiple items for arrow navigation */
  items?: PreviewItem[]
  /** Initial active item index (defaults to 0) */
  initialIndex?: number
  /** Async loader that returns PDF data as Uint8Array */
  loadPdfData: (path: string) => Promise<Uint8Array>
  theme?: 'light' | 'dark'
}

export function PDFPreviewOverlay({
  isOpen,
  onClose,
  filePath,
  items,
  initialIndex = 0,
  loadPdfData,
  theme = 'light',
}: PDFPreviewOverlayProps) {
  const { t } = useTranslation()
  const resolvedItems = useMemo<PreviewItem[]>(() => {
    if (items && items.length > 0) return items
    return [{ src: filePath }]
  }, [items, filePath])

  const [activeIdx, setActiveIdx] = useState(initialIndex)
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState(String(currentPage))
  const [scale, setScale] = useState(1)
  const [fitWidth, setFitWidth] = useState(0)
  const [query, setQuery] = useState('')
  const [matchingPages, setMatchingPages] = useState<number[]>([])
  const [currentMatch, setCurrentMatch] = useState(0)
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const pdfRef = useRef<PdfTextDocument | null>(null)
  const searchVersion = useRef(0)
  const pdfViewport = useRef<HTMLDivElement | null>(null)
  const pageElements = useRef(new Map<number, HTMLDivElement>())
  const activeItem = resolvedItems[activeIdx]

  useEffect(() => {
    if (!isOpen) return
    setActiveIdx(initialIndex)
    setCurrentPage(1)
    setScale(1)
    setQuery('')
    setMatchingPages([])
    setHasSearched(false)
  }, [isOpen, initialIndex])

  useEffect(() => {
    setPageInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    if (!isOpen || !activeItem?.src) return

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setPdfData(null)
    setNumPages(0)
    setCurrentPage(1)
    setMatchingPages([])
    searchVersion.current += 1
    setSearching(false)
    setHasSearched(false)
    pdfRef.current = null

    loadPdfData(activeItem.src)
      .then((data) => {
        if (!cancelled) {
          setPdfData(data)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF')
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
      searchVersion.current += 1
    }
  }, [isOpen, activeItem?.src, loadPdfData, retryKey])

  useEffect(() => {
    const viewport = pdfViewport.current
    if (!isOpen || !viewport) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFitWidth(Math.max(280, Math.floor(entry.contentRect.width - 32)))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [isOpen])

  const onDocumentLoadSuccess = useCallback((document: PdfTextDocument) => {
    pdfRef.current = document
    setNumPages(document.numPages)
    setError(null)
  }, [])

  const onDocumentLoadError = useCallback((loadError: Error) => {
    setError(`Failed to load PDF: ${loadError.message}`)
  }, [])

  const navigateToPage = useCallback((page: number) => {
    const boundedPage = Math.max(1, Math.min(numPages || 1, Math.trunc(page) || 1))
    setCurrentPage(boundedPage)
    pageElements.current.get(boundedPage)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [numPages])

  const searchPdf = useCallback(async () => {
    const document = pdfRef.current
    const searchTerm = query.trim()
    if (!document || !searchTerm) {
      setMatchingPages([])
      setCurrentMatch(0)
      setHasSearched(false)
      return
    }

    const version = ++searchVersion.current
    setSearching(true)
    setHasSearched(false)
    setError(null)
    try {
      const pageTexts: string[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const text = await page.getTextContent()
        if (version !== searchVersion.current) return
        pageTexts.push(text.items.map((item) => {
          if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string') return ''
          return item.str
        }).join(' '))
      }
      const results = findMatchingPages(pageTexts, searchTerm)
      if (version !== searchVersion.current) return
      setMatchingPages(results)
      setCurrentMatch(0)
      setHasSearched(true)
      if (results.length > 0) navigateToPage(results[0]!)
    } catch (searchError) {
      if (version !== searchVersion.current) return
      setError(searchError instanceof Error ? searchError.message : 'Unable to search this PDF')
      setMatchingPages([])
      setHasSearched(true)
    } finally {
      if (version === searchVersion.current) setSearching(false)
    }
  }, [navigateToPage, query])

  const navigateMatch = useCallback((delta: number) => {
    if (matchingPages.length === 0) return
    const nextMatch = (currentMatch + delta + matchingPages.length) % matchingPages.length
    setCurrentMatch(nextMatch)
    navigateToPage(matchingPages[nextMatch]!)
  }, [currentMatch, matchingPages, navigateToPage])

  const fileObj = useMemo(() => pdfData ? { data: pdfData } : null, [pdfData])
  const headerActions = (
    <div className="flex items-center gap-2">
      <ItemNavigator items={resolvedItems} activeIndex={activeIdx} onSelect={setActiveIdx} size="md" />
      <CopyButton content={activeItem?.src || filePath} title={t('common.copyPath')} className="bg-background shadow-minimal" />
    </div>
  )

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={{ icon: FileText, label: 'PDF', variant: 'orange' }}
      filePath={activeItem?.src || filePath}
      error={error ? { label: 'Load Failed', message: error } : undefined}
      headerActions={headerActions}
    >
      <div className="flex h-full min-h-0 flex-col">
        {fileObj && (
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
            <label className="flex items-center gap-1.5 text-sm">
              <span>{t('common.pageOf', { page: currentPage, total: numPages })}</span>
              <input
                aria-label={t('pdf.pageLabel')}
                type="number"
                min={1}
                max={numPages || 1}
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={() => navigateToPage(Number(pageInput))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
                className="w-16 rounded border bg-background px-2 py-1 text-center"
              />
            </label>
            <div className="flex items-center gap-1">
              <button type="button" aria-label={t('overlay.zoomOut')} title={t('overlay.zoomOut')} onClick={() => setScale((value) => Math.max(0.5, Math.round((value - 0.1) * 10) / 10))} className="rounded border p-1.5 hover:bg-muted"><Minus className="h-4 w-4" /></button>
              <span className="min-w-12 text-center text-sm tabular-nums">{Math.round(scale * 100)}%</span>
              <button type="button" aria-label={t('overlay.zoomIn')} title={t('overlay.zoomIn')} onClick={() => setScale((value) => Math.min(2.5, Math.round((value + 0.1) * 10) / 10))} className="rounded border p-1.5 hover:bg-muted"><Plus className="h-4 w-4" /></button>
              <button type="button" onClick={() => setScale(1)} className="rounded border px-2 py-1 text-sm">{t('overlay.zoomToFit')}</button>
            </div>
            <form
              className="flex min-w-56 items-center gap-1"
              role="search"
              onSubmit={(event) => { event.preventDefault(); void searchPdf() }}
            >
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                aria-label={t('pdf.searchPlaceholder')}
                value={query}
                onChange={(event) => {
                  searchVersion.current += 1
                  setSearching(false)
                  setQuery(event.target.value)
                  setMatchingPages([])
                  setHasSearched(false)
                }}
                placeholder={t('pdf.searchPlaceholder')}
                className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
              />
              <button type="submit" disabled={!pdfRef.current || searching || !query.trim()} className="rounded border px-2 py-1 text-sm disabled:opacity-50">
                {searching ? t('pdf.searching') : t('common.search')}
              </button>
              {matchingPages.length > 0 && (
                <>
                  <span aria-live="polite" className="whitespace-nowrap text-xs tabular-nums">{currentMatch + 1}/{matchingPages.length}</span>
                  <button type="button" aria-label={t('pdf.previousResult')} onClick={() => navigateMatch(-1)} className="rounded border px-2 py-1 text-sm">‹</button>
                  <button type="button" aria-label={t('pdf.nextResult')} onClick={() => navigateMatch(1)} className="rounded border px-2 py-1 text-sm">›</button>
                </>
              )}
            </form>
            {hasSearched && !searching && matchingPages.length === 0 && (
              <span aria-live="polite" className="text-xs text-muted-foreground">{t('common.noResults')}</span>
            )}
          </div>
        )}
        <div ref={pdfViewport} className="flex min-h-0 flex-1 flex-col items-center overflow-auto">
          {isLoading && <div className="text-muted-foreground text-sm">{t('preview.loadingPdf')}</div>}
          {error && !isLoading && (
            <div className="flex flex-col items-center gap-3 py-8" role="alert">
              <p className="text-sm text-destructive">{error}</p>
              <button type="button" onClick={() => { setError(null); setRetryKey((key) => key + 1) }} className="rounded border px-3 py-1.5 text-sm hover:bg-muted">
                {t('common.retry')}
              </button>
            </div>
          )}
          {fileObj && (
            <Document
              key={`${activeItem?.src}:${retryKey}`}
              file={fileObj}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={<div className="text-muted-foreground text-sm">{t('common.rendering')}</div>}
            >
              {Array.from({ length: numPages }, (_, i) => {
                const pageNumber = i + 1
                return (
                  <div
                    key={pageNumber}
                    ref={(element) => {
                      if (element) pageElements.current.set(pageNumber, element)
                      else pageElements.current.delete(pageNumber)
                    }}
                    className="pdf-page-wrapper mb-4"
                    onMouseEnter={() => setCurrentPage(pageNumber)}
                  >
                    <Page pageNumber={pageNumber} width={fitWidth || undefined} scale={scale} renderTextLayer renderAnnotationLayer className="pdf-page" />
                  </div>
                )
              })}
            </Document>
          )}
        </div>
      </div>
    </PreviewOverlay>
  )
}
