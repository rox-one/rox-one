/**
 * `buildNotebookExport` — unit tests (SPEC wave 9 §4, §Testing; wave 11 §16).
 *
 * The builder is pure and deterministic: these tests pin the nbformat 4.5
 * shape, the exact line-splitting rule ("every line keeps its `\n` except the
 * last"; empty text → `[]`), the stdout/stderr stream mapping, the wave-11
 * `display_data` records that follow them and the `execution_count ?? null`
 * rule, then round-trip the output through `JSON.parse` the way a notebook
 * reader would.
 */
import { describe, expect, it } from 'bun:test'
import { buildNotebookExport } from '../cookbooks'

/** One output record as it lands in the file: a stream or a display record. */
interface ParsedOutput {
  output_type: string
  name?: string
  text?: string[]
  metadata?: Record<string, unknown>
  data?: Record<string, unknown>
}

/** The parsed notebook shape this file asserts against. */
interface ParsedCell {
  cell_type: 'code' | 'markdown'
  source: string[]
  execution_count?: number | null
  metadata: Record<string, unknown>
  outputs?: ParsedOutput[]
}

interface ParsedNotebook {
  cells: ParsedCell[]
  metadata: { title: string }
  nbformat: number
  nbformat_minor: number
}

const parse = (json: string): ParsedNotebook => JSON.parse(json) as ParsedNotebook

describe('buildNotebookExport', () => {
  it('emits an nbformat 4.5 document with metadata.title', () => {
    const json = buildNotebookExport({ title: 'Probe notebook', cells: [] })
    // Pretty-printed (2-space indent), so a human can diff it.
    expect(json).toContain('\n  "cells"')
    const notebook = parse(json)
    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(5)
    expect(notebook.metadata).toEqual({ title: 'Probe notebook' })
    expect(notebook.cells).toEqual([])
  })

  it('maps a code cell with stdout and error to two stream outputs', () => {
    const notebook = parse(
      buildNotebookExport({
        title: 'T',
        cells: [{ cellType: 'code', source: 'print(1)', executionCount: 3, stdout: 'one\ntwo\n', error: 'boom\n' }],
      }),
    )
    expect(notebook.cells).toEqual([
      {
        cell_type: 'code',
        source: ['print(1)'],
        execution_count: 3,
        metadata: {},
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['one\n', 'two\n'] },
          { output_type: 'stream', name: 'stderr', text: ['boom\n'] },
        ],
      },
    ])
  })

  it('omits stream outputs for a code cell with no stdout or error', () => {
    const notebook = parse(
      buildNotebookExport({ title: 'T', cells: [{ cellType: 'code', source: 'x = 1' }] }),
    )
    expect(notebook.cells[0].execution_count).toBeNull()
    expect(notebook.cells[0].outputs).toEqual([])
  })

  it('treats empty stdout/error strings as no output', () => {
    const notebook = parse(
      buildNotebookExport({ title: 'T', cells: [{ cellType: 'code', source: '', stdout: '', error: '' }] }),
    )
    expect(notebook.cells[0].outputs).toEqual([])
    expect(notebook.cells[0].source).toEqual([])
  })

  it('keeps execution_count null, a number or the numeric fallback', () => {
    const notebook = parse(
      buildNotebookExport({
        title: 'T',
        cells: [
          { cellType: 'code', source: 'a', executionCount: null },
          { cellType: 'code', source: 'b', executionCount: 0 },
          { cellType: 'code', source: 'c', executionCount: 42 },
        ],
      }),
    )
    expect(notebook.cells.map((cell) => cell.execution_count)).toEqual([null, 0, 42])
  })

  it('writes a markdown cell to just cell_type/metadata/source', () => {
    const notebook = parse(
      buildNotebookExport({ title: 'T', cells: [{ cellType: 'markdown', source: '# Heading\n\nBody' }] }),
    )
    expect(notebook.cells).toEqual([
      { cell_type: 'markdown', metadata: {}, source: ['# Heading\n', '\n', 'Body'] },
    ])
    expect(notebook.cells[0]).not.toHaveProperty('execution_count')
    expect(notebook.cells[0]).not.toHaveProperty('outputs')
  })

  // Wave 11: rich records (SPEC §16) land as `display_data` after the streams.
  it('writes one display_data record per display, after the stream output', () => {
    const notebook = parse(
      buildNotebookExport({
        title: 'T',
        cells: [
          {
            cellType: 'code',
            source: 'display("42")',
            executionCount: 1,
            stdout: 'out\n',
            displays: [
              { mime: 'text/plain', data: '42' },
              { mime: 'image/png', data: 'QUJD' },
            ],
          },
        ],
      }),
    )
    expect(notebook.cells[0].outputs).toEqual([
      { output_type: 'stream', name: 'stdout', text: ['out\n'] },
      { output_type: 'display_data', metadata: {}, data: { 'text/plain': '42' } },
      { output_type: 'display_data', metadata: {}, data: { 'image/png': 'QUJD' } },
    ])
  })

  it('keeps the stream → stderr → display_data order for a failing cell', () => {
    const notebook = parse(
      buildNotebookExport({
        title: 'T',
        cells: [
          {
            cellType: 'code',
            source: 'x',
            executionCount: 2,
            stdout: 'partial\n',
            error: 'ValueError: boom',
            displays: [{ mime: 'text/html', data: '<b>hi</b>' }],
          },
        ],
      }),
    )
    expect(notebook.cells[0].outputs).toEqual([
      { output_type: 'stream', name: 'stdout', text: ['partial\n'] },
      { output_type: 'stream', name: 'stderr', text: ['ValueError: boom'] },
      { output_type: 'display_data', metadata: {}, data: { 'text/html': '<b>hi</b>' } },
    ])
  })

  it('stores an application/json display parsed, and one that does not parse verbatim', () => {
    const notebook = parse(
      buildNotebookExport({
        title: 'T',
        cells: [
          {
            cellType: 'code',
            source: 'x',
            displays: [
              { mime: 'application/json', data: '{"answer":[1,2]}' },
              { mime: 'application/json', data: 'not json' },
            ],
          },
        ],
      }),
    )
    expect(notebook.cells[0].outputs).toEqual([
      { output_type: 'display_data', metadata: {}, data: { 'application/json': { answer: [1, 2] } } },
      { output_type: 'display_data', metadata: {}, data: { 'application/json': 'not json' } },
    ])
  })

  it('writes no display_data for an absent or empty display list', () => {
    const notebook = parse(
      buildNotebookExport({
        title: 'T',
        cells: [
          { cellType: 'code', source: 'a', displays: [] },
          { cellType: 'code', source: 'b' },
        ],
      }),
    )
    expect(notebook.cells[0].outputs).toEqual([])
    expect(notebook.cells[1].outputs).toEqual([])
  })

  it('splits multiline text so every line but the last ends with a newline', () => {
    const notebook = parse(
      buildNotebookExport({
        title: 'T',
        cells: [{ cellType: 'code', source: 'a\nb\nc', executionCount: 1 }],
      }),
    )
    expect(notebook.cells[0].source).toEqual(['a\n', 'b\n', 'c'])
  })

  it('folds a final newline into the preceding line instead of a trailing empty one', () => {
    const notebook = parse(
      buildNotebookExport({ title: 'T', cells: [{ cellType: 'code', source: 'a\nb\n' }] }),
    )
    expect(notebook.cells[0].source).toEqual(['a\n', 'b\n'])
  })

  it('keeps interior blank lines as their own "\n" entry', () => {
    const notebook = parse(
      buildNotebookExport({ title: 'T', cells: [{ cellType: 'code', source: 'a\n\nb' }] }),
    )
    expect(notebook.cells[0].source).toEqual(['a\n', '\n', 'b'])
  })

  it('is deterministic — identical input renders byte-equal output', () => {
    const input = {
      title: 'Deterministic',
      cells: [
        { cellType: 'code' as const, source: 'print(1)', executionCount: 1, stdout: '1\n' },
        { cellType: 'markdown' as const, source: 'notes' },
      ],
    }
    expect(buildNotebookExport(input)).toBe(buildNotebookExport(input))
    // No Date/random leaks into the serialised document.
    expect(buildNotebookExport(input)).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('round-trips through JSON.parse preserving the code/markdown mix', () => {
    const json = buildNotebookExport({
      title: 'Mixed',
      cells: [
        { cellType: 'markdown', source: 'Intro' },
        { cellType: 'code', source: 'x', executionCount: 7, stdout: 'ok\n', error: 'warn\n' },
        { cellType: 'markdown', source: 'Outro' },
      ],
    })
    const notebook = parse(json)
    expect(notebook.nbformat).toBe(4)
    expect(notebook.nbformat_minor).toBe(5)
    expect(notebook.metadata.title).toBe('Mixed')
    expect(notebook.cells.map((cell) => cell.cell_type)).toEqual(['markdown', 'code', 'markdown'])
    expect(notebook.cells[1].outputs?.map((output) => output.name)).toEqual(['stdout', 'stderr'])
  })
})
