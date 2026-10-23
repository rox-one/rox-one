import { describe, expect, it } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { tiptapCodeBlock } from '../TiptapCodeBlockView'
import {
  codeBytesForCopy,
  containsForbiddenRedactionLabel,
  countCodeLines,
  countHiddenLines,
  cycleFoldMode,
  formatHideLines,
  isUnsafeHtmlAttrName,
  lineNumberLabels,
  normalizeCodePresentation,
  parseHideLines,
  rejectsUnsafeMarkPayload,
  renderCodeFenceMarkdown,
  sanitizePresentationColorToken,
} from '../code-presentation'

const FULL_CODE = [
  'function greet(name: string) {',
  '  // secret-looking but not redacted',
  '  const token = "abc"',
  '  return `hi ${name}`',
  '}',
].join('\n')

describe('code presentation helpers', () => {
  it('normalizes presentation attrs without inventing redaction', () => {
    expect(normalizeCodePresentation({
      wrap: 'true',
      fold: 'semi',
      lineNumbers: 1,
      lineStart: '12',
      hideLines: '3-5,8,8,4',
    })).toEqual({
      wrap: true,
      fold: 'semi',
      lineNumbers: true,
      lineStart: 12,
      hideLines: '3-5,8',
    })
  })

  it('cycles fold none → semi → fold → none', () => {
    expect(cycleFoldMode('none')).toBe('semi')
    expect(cycleFoldMode('semi')).toBe('fold')
    expect(cycleFoldMode('fold')).toBe('none')
  })

  it('parses and counts hide-lines ranges as presentation only', () => {
    const ranges = parseHideLines('2-3,5')
    expect(formatHideLines(ranges)).toBe('2-3,5')
    expect(countHiddenLines(ranges, 5)).toBe(3)
    expect(countCodeLines(FULL_CODE)).toBe(5)
    expect(lineNumberLabels(3, 10)).toEqual(['10', '11', '12'])
  })

  it('copy and fence export keep exact full bytes under fold/hide presentation', () => {
    const folded = normalizeCodePresentation({
      fold: 'fold',
      hideLines: '2-4',
      wrap: true,
      lineNumbers: true,
    })
    expect(folded.fold).toBe('fold')
    expect(folded.hideLines).toBe('2-4')

    const copied = codeBytesForCopy(FULL_CODE)
    expect(copied).toBe(FULL_CODE)
    expect(copied).toContain('const token = "abc"')

    const md = renderCodeFenceMarkdown('ts', FULL_CODE)
    expect(md).toBe(['```ts', FULL_CODE, '```'].join('\n'))
    expect(md).toContain('const token = "abc"')
    expect(md).toContain('return `hi ${name}`')
    // Mutant control: dropping folded lines from export must fail this oracle.
    expect(md.split('\n').length).toBe(FULL_CODE.split('\n').length + 2)
  })

  it('rejects unsafe HTML/event-handler mark payloads and arbitrary CSS tokens', () => {
    expect(rejectsUnsafeMarkPayload('onclick=alert(1)')).toBe(true)
    expect(rejectsUnsafeMarkPayload('<script>alert(1)</script>')).toBe(true)
    expect(rejectsUnsafeMarkPayload('javascript:alert(1)')).toBe(true)
    expect(rejectsUnsafeMarkPayload('token-range:1-2')).toBe(false)
    expect(isUnsafeHtmlAttrName('onclick')).toBe(true)
    expect(isUnsafeHtmlAttrName('onError')).toBe(true)
    expect(isUnsafeHtmlAttrName('style')).toBe(true)
    expect(isUnsafeHtmlAttrName('data-fold')).toBe(false)
    expect(sanitizePresentationColorToken('accent')).toBe('accent')
    expect(sanitizePresentationColorToken('--success')).toBe('success')
    expect(sanitizePresentationColorToken('expression(alert(1))')).toBeNull()
    expect(sanitizePresentationColorToken('url(https://evil.test)')).toBeNull()
  })

  it('forbids describing hide/fold as secret redaction in UI copy', () => {
    expect(containsForbiddenRedactionLabel('Fold code')).toBe(false)
    expect(containsForbiddenRedactionLabel('Hidden lines are presentation only')).toBe(false)
    expect(containsForbiddenRedactionLabel('Скрытые строки — только оформление')).toBe(false)
    expect(containsForbiddenRedactionLabel('secret redaction')).toBe(true)
    expect(containsForbiddenRedactionLabel('removed by redaction')).toBe(true)
    expect(containsForbiddenRedactionLabel('редакция секретов')).toBe(true)
  })
})

describe('tiptap codeBlock markdown export under presentation', () => {
  it('ordinary getMarkdown keeps full fenced body when fold/hide attrs are set', () => {
    const source = ['```ts', FULL_CODE, '```'].join('\n')
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        tiptapCodeBlock,
        Markdown,
      ],
      content: source,
      contentType: 'markdown',
    })

    // Presentation attrs are TipTap chrome — set after parse; must not alter bytes.
    editor.commands.command(({ tr, state, dispatch }) => {
      let pos: number | null = null
      state.doc.descendants((node, nodePos) => {
        if (node.type.name === 'codeBlock' && pos == null) pos = nodePos
        return pos == null
      })
      if (pos == null) return false
      const node = state.doc.nodeAt(pos)
      if (!node) return false
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        wrap: true,
        fold: 'fold',
        lineNumbers: true,
        lineStart: 3,
        hideLines: '2-4',
      })
      dispatch?.(tr)
      return true
    })

    const json = editor.getJSON()
    const block = (json.content ?? []).find((n: { type?: string }) => n.type === 'codeBlock') as {
      attrs?: Record<string, unknown>
      content?: Array<{ text?: string }>
    } | undefined

    expect(block?.attrs?.fold).toBe('fold')
    expect(block?.attrs?.hideLines).toBe('2-4')
    expect(block?.attrs?.wrap).toBe(true)
    expect(block?.attrs?.lineNumbers).toBe(true)
    expect(block?.attrs?.lineStart).toBe(3)
    expect(block?.content?.[0]?.text).toBe(FULL_CODE)

    const md = editor.getMarkdown()
    expect(md).toContain('```ts')
    expect(md).toContain(FULL_CODE)
    expect(md).toContain('const token = "abc"')
    expect(codeBytesForCopy(block?.content?.[0]?.text ?? '')).toBe(FULL_CODE)

    editor.destroy()
  })

  it('locale-facing presentation strings are not framed as redaction', () => {
    // Mirror the RU/EN keys shipped with this slice — keep the oracle local so
    // tests do not depend on i18n runtime init.
    const strings = [
      'Wrap lines',
      'Unwrap lines',
      'Fold code',
      'Semi-fold code',
      'Unfold code',
      'Line numbers',
      'Folding only changes the view — copy and export keep the full code.',
      'Hidden lines ({{count}}) are view presentation only.',
      'Перенос строк',
      'Без переноса строк',
      'Свернуть код',
      'Частично свернуть код',
      'Развернуть код',
      'Номера строк',
      'Свёртка меняет только вид — копирование и экспорт сохраняют полный код.',
      'Скрытые строки ({{count}}) — только оформление вида.',
    ]

    for (const s of strings) {
      expect(containsForbiddenRedactionLabel(s)).toBe(false)
    }

    expect(containsForbiddenRedactionLabel('Hidden lines removed by redaction')).toBe(true)
    expect(containsForbiddenRedactionLabel('secret redaction')).toBe(true)
    expect(containsForbiddenRedactionLabel('редакция секретов')).toBe(true)
  })
})
