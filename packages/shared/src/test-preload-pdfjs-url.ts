/**
 * Bun cannot treat Vite's `?url` suffix as a URL string. Renderer tests that
 * transitively import MarkdownPdfBlock / PDFPreviewOverlay then fail (inventory
 * 8.7). Mock only the Vite specifier — the real `pdfjs-dist` worker used by
 * pi-agent-server is a different module.
 */
import { mock } from 'bun:test'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: '/pdf.worker.min.mjs',
}))
