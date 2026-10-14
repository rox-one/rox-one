/**
 * #1574 — `notes:listTasks`: checkbox tasks per note, extracted on the server so
 * the Notes page does not read every note body to build its task list.
 */

/** Max note ids per `notes:listTasks` call (client chunks larger sets). */
export const NOTE_TASKS_MAX_IDS = 200

export interface NoteTaskLine {
  /** 1-based line in the note's markdown. */
  line: number
  text: string
  checked: boolean
}

export interface NoteTasksEntry {
  id: string
  title: string
  updatedAt: number
  tasks: NoteTaskLine[]
}

const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/

/** `- [ ] text` / `* [x] text` lines, the same grammar the Notes page has always used. */
export function extractNoteTaskLines(content: string): NoteTaskLine[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = TASK_LINE.exec(line)
    if (!match) return []
    return [{ line: index + 1, text: match[2]!.trim(), checked: match[1]!.toLowerCase() === 'x' }]
  })
}
