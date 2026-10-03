import { Extension } from '@tiptap/core'

const TASK_LIST_CLASS = 'contains-task-list'
const TASK_ITEM_CLASS = 'task-list-item'

/**
 * markdown-it-task-lists marks a whole list when any direct item is a task.
 * The legacy taskList adapter then turns that list into a taskItem-only node.
 * Split contiguous runs before that adapter so ProseMirror need not repair
 * ordinary list items by inserting empty tasks. Move items, including their
 * nested lists and checkbox inputs, rather than recreating their contents.
 */
export function normalizeLegacyMixedTaskLists(element: HTMLElement): void {
  // Descendants first: a moved parent still contains its already fixed lists.
  const lists = Array.from(element.querySelectorAll<HTMLElement>(
    `ul.${TASK_LIST_CLASS}, ol.${TASK_LIST_CLASS}`,
  )).reverse()

  for (const list of lists) {
    const children = Array.from(list.childNodes)
    // markdown-it produces only LI and whitespace here. Leave other HTML alone.
    if (children.some(child => child.nodeType === 1
      ? (child as HTMLElement).tagName.toLowerCase() !== 'li'
      : child.nodeType !== 3 || /\S/.test(child.textContent ?? ''))) continue

    const items = Array.from(list.children) as HTMLElement[]
    const isTask = (item: HTMLElement) => item.classList.contains(TASK_ITEM_CLASS)
    const taskCount = items.filter(isTask).length

    if (taskCount === 0) {
      list.classList.remove(TASK_LIST_CLASS)
      if (list.getAttribute('data-type') === 'taskList') list.removeAttribute('data-type')
      continue
    }

    const ordered = list.tagName.toLowerCase() === 'ol'
    if (!ordered && taskCount === items.length) continue

    const parent = list.parentNode
    if (!parent) continue
    const parsedStart = Number(list.getAttribute('start') ?? 1)
    const start = Number.isSafeInteger(parsedStart) ? parsedStart : 1
    let itemOffset = 0
    let previousTask: boolean | undefined
    let run: HTMLElement | undefined
    const leadingWhitespace: Node[] = []

    for (const child of children) {
      if (child.nodeType !== 1) {
        if (run) run.appendChild(child)
        else leadingWhitespace.push(child)
        continue
      }

      const task = isTask(child as HTMLElement)
      if (!run || previousTask !== task) {
        // TaskList's HTML schema accepts UL only, including for ordered tasks.
        run = ordered && task
          ? list.ownerDocument.createElement('ul')
          : list.cloneNode(false) as HTMLElement
        if (ordered && task) {
          for (const attribute of Array.from(list.attributes)) {
            run.setAttribute(attribute.name, attribute.value)
          }
          for (const attribute of ['start', 'reversed', 'type']) run.removeAttribute(attribute)
        }
        // An HTML ID identifies the first segment; never duplicate it.
        if (itemOffset > 0) run.removeAttribute('id')
        if (task) run.classList.add(TASK_LIST_CLASS)
        else {
          run.classList.remove(TASK_LIST_CLASS)
          if (run.getAttribute('data-type') === 'taskList') run.removeAttribute('data-type')
          if (ordered) run.setAttribute('start', String(start + itemOffset))
        }
        parent.insertBefore(run, list)
        for (const whitespace of leadingWhitespace.splice(0)) run.appendChild(whitespace)
        previousTask = task
      }

      run.appendChild(child)
      itemOffset++
    }
    parent.removeChild(list)
  }
}

/** Legacy parser hook; default TaskList/TaskItem adapters have priority 100. */
export const LegacyMixedTaskLists = Extension.create({
  name: 'legacyMixedTaskLists',
  priority: 110,
  addStorage() {
    return {
      markdown: {
        parse: { updateDOM: normalizeLegacyMixedTaskLists },
      },
    }
  },
})
