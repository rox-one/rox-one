/**
 * Control for official-markdown-instance.test.ts (#1505): measures the parity
 * corpus with main's setup (`@tiptap/markdown` on the global `marked`). Run in
 * a child process (`bun official-global-control.ts on|off`) so the global
 * registrations never leak into the test process or other test files.
 */
import { Markdown } from '@tiptap/markdown'
import { PARITY_CORPUS, measure, type Flag } from './official-parity-fixture'

const flag = (process.argv[2] === 'on' ? 'on' : 'off') as Flag
const markdown = Markdown.configure({ markedOptions: { gfm: true } })
process.stdout.write(JSON.stringify(PARITY_CORPUS.map((source) => measure(flag, markdown, source))))
