/**
 * Spec story 23 / inventory 8.7 — bun cannot resolve Vite's `?url` suffix.
 * The repo bunfig [test] preload mocks this specifier to a string default
 * so renderer tests that transitively load MarkdownPdfBlock stay green.
 */
import { describe, expect, it } from 'bun:test'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

describe('pdfjs Vite ?url import under bun test', () => {
  it('resolves pdfjs-dist/build/pdf.worker.min.mjs?url to a string', () => {
    expect(typeof workerUrl).toBe('string')
    expect(workerUrl.length).toBeGreaterThan(0)
  })
})
