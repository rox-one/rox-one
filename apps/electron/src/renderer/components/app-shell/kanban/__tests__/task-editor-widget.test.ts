/**
 * TaskEditor board-widget wiring (wave 3, rows b2.3/b2.5).
 *
 * The kanban card detail (the TaskEditor the board opens for a card session) is
 * the real consumer of `WidgetCard`. This suite pins the wiring so a refactor
 * cannot silently unhook the widget surface: the card is mounted for the task
 * slug, only in edit mode (a create draft has no stable slug to address a board
 * revision by), and it must not smuggle the widget into create mode.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const EDITOR = readFileSync(join(__dirname, '..', 'TaskEditor.tsx'), 'utf8')

describe('TaskEditor board widget consumer', () => {
  it('imports the board WidgetCard from the shared board components', () => {
    expect(EDITOR).toContain("import { WidgetCard } from '@/components/board/WidgetCard'")
  })

  it('mounts WidgetCard for the task slug, gated to edit mode', () => {
    expect(EDITOR).toContain('{isEdit && editSlug ? (')
    expect(EDITOR).toContain('widgetId={editSlug}')
    expect(EDITOR).toContain("t('board.widget.sectionTitle')")
  })

  it('does not mount a board widget in create mode', () => {
    expect(EDITOR).not.toContain('widgetId={target.taskSlug}')
    expect(EDITOR).not.toContain('widgetId={title}')
  })
})