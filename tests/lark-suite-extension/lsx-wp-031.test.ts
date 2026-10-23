import { describe, expect, test } from 'bun:test'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import {
  assertBasicExportRevealsChildren,
  expandContainersForBasicMarkdown,
  isOpaqueFenceDroppingChildren,
  listRetainedUnknownContainers,
  serializeContainerAsOpaqueFence,
} from '../../packages/core/src/docs/container-codec.ts'
import { RoxTabsBlock, RoxTabBlock } from '../../packages/ui/src/components/markdown/extensions/TabsBlock.tsx'
import { RoxColumnsBlock, RoxColumnBlock } from '../../packages/ui/src/components/markdown/extensions/ColumnsBlock.tsx'

const nestedSource = [
  '# Doc',
  '',
  ':::rox-tabs',
  '',
  ':::rox-tab {title="Plan"}',
  '',
  '- [ ] nested task ^task-plan',
  '',
  ':::',
  '',
  ':::rox-tab {title="Notes"}',
  '',
  'Comment-ready prose ^note-body',
  '',
  ':::',
  '',
  ':::',
  '',
  ':::rox-columns {widths="50% 50%"}',
  '',
  ':::rox-column',
  '',
  'Left column ^col-left',
  '',
  ':::',
  '',
  ':::rox-column',
  '',
  'Right column ^col-right',
  '',
  ':::',
  '',
  ':::',
  '',
  ':::rox-future-widget {mode="preview"}',
  '',
  'Future retained body ^future-id',
  '',
  ':::',
].join('\n')

describe('LSX-WP-031 semantic tabs/columns and basic Markdown fallback', () => {
  test('TipTap round-trip keeps nested child text and block anchors for tabs', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        RoxTabsBlock,
        RoxTabBlock,
        RoxColumnsBlock,
        RoxColumnBlock,
        Markdown,
      ],
      content: nestedSource,
      contentType: 'markdown',
    })
    const markdown = editor.getMarkdown()
    expect(markdown).toContain(':::rox-tabs')
    expect(markdown).toContain('nested task')
    expect(markdown).toContain('^task-plan')
    expect(markdown).toContain('^note-body')
    expect(markdown).toContain('Left column')
    expect(markdown).toContain('^col-left')
    editor.destroy()
  })

  test('basic Markdown expands all tabs and columns; unknown containers stay readable', () => {
    const basic = expandContainersForBasicMarkdown(nestedSource)
    assertBasicExportRevealsChildren(basic, [
      '### Plan',
      'nested task',
      '^task-plan',
      '### Notes',
      'Comment-ready prose',
      '^note-body',
      '### Column 1',
      'Left column',
      '^col-left',
      'Right column',
      '^col-right',
    ])
    // Expanded export must not keep the semantic fence for known containers.
    expect(basic).not.toContain(':::rox-tabs')
    expect(basic).not.toContain(':::rox-columns')
    // Unknown future container retained/readable with child text.
    expect(listRetainedUnknownContainers(nestedSource)).toContain('rox-future-widget')
    expect(basic).toContain(':::rox-future-widget')
    expect(basic).toContain('Future retained body')
    expect(basic).toContain('^future-id')
  })

  test('negative control rejects opaque fence serialization that drops children', () => {
    const mutant = serializeContainerAsOpaqueFence(
      { kind: 'tabs', titles: ['Plan', 'Notes'] },
      '- [ ] nested task ^task-plan\nComment-ready prose ^note-body',
    )
    expect(isOpaqueFenceDroppingChildren(mutant, ['nested task', '^task-plan', 'Comment-ready prose'])).toBe(true)
    expect(() => assertBasicExportRevealsChildren(mutant, ['nested task', '^task-plan'])).toThrow(/reveal child content|Opaque fence/)
  })

  test('columns nested inside tabs expand recursively in basic Markdown', () => {
    const nestedInside = [
      ':::rox-tabs',
      '',
      ':::rox-tab {title="Layout"}',
      '',
      ':::rox-columns {widths="50% 50%"}',
      '',
      ':::rox-column',
      '',
      'Inner left ^inner-left',
      '',
      ':::',
      '',
      ':::rox-column',
      '',
      'Inner right ^inner-right',
      '',
      ':::',
      '',
      ':::',
      '',
      ':::',
      '',
      ':::rox-tab {title="Other"}',
      '',
      'Sibling pane',
      '',
      ':::',
      '',
      ':::',
    ].join('\n')
    const basic = expandContainersForBasicMarkdown(nestedInside)
    assertBasicExportRevealsChildren(basic, [
      '### Layout',
      '### Column 1',
      'Inner left',
      '^inner-left',
      '### Column 2',
      'Inner right',
      '^inner-right',
      '### Other',
      'Sibling pane',
    ])
    expect(basic).not.toContain(':::rox-tabs')
    expect(basic).not.toContain(':::rox-columns')
  })

})
