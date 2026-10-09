#!/usr/bin/env bun
/**
 * Generates apps/electron/resources/docs/openui.md — the OpenUI Lang reference
 * the agent reads (`DOC_REFS.openui`) before its first interactive answer.
 *
 * The component signatures, syntax rules and examples come straight from the
 * installed `@openuidev/react-ui` genui library via `openuiChatLibrary.prompt()`,
 * so the doc always matches the renderer that ships with ROX. Only the
 * surrounding intro and the ROX-specific preamble/rules are hand-written here.
 *
 *   bun scripts/openui/generate-doc.ts           # write
 *   bun scripts/openui/generate-doc.ts --check   # exit 1 if stale
 *
 * Deterministic: same library in, same bytes out (no timestamps, no absolute
 * paths). UTF-8 with a trailing newline.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..')
export const OPENUI_DOC_PATH = join(REPO_ROOT, 'apps/electron/resources/docs/openui.md')

// Disable lang-core telemetry before the library is loaded (the package would
// otherwise try to phone home from a desktop renderer).
process.env.OPENUI_TELEMETRY_DISABLED = '1'

// Dynamic import is required, not stylistic: static imports are hoisted and
// would load genui-lib before the telemetry flag above is set.
const { openuiChatLibrary, openuiChatPromptOptions } = await import('@openuidev/react-ui/genui-lib')

/**
 * Hand-written intro that replaces the vendor framing ("the entire response
 * must be openui-lang") with the ROX contract: normal Markdown prose plus at
 * most one optional interactive block.
 */
const PREAMBLE = [
  'ROX renders assistant answers as normal Markdown prose.',
  'When an answer benefits from an interactive element, include at most one fenced ```openui code block holding a complete, self-contained openui-lang program; ROX renders that block as an interactive component (chart, table, form or card) directly in the chat.',
  'Keep the surrounding prose readable on its own, so the answer still makes sense when the block is not rendered.',
  'Keep programs compact: around 60 statements at most.',
].join(' ')

const ADDITIONAL_RULES = [
  'Emit at most one ```openui block per answer, and only when the answer benefits from an interactive element.',
  'Write normal Markdown prose outside the block; that prose must stand on its own without the block.',
  'Skip the block when plain Markdown (or a small Markdown table) already answers the question.',
  'Never call Query() or Mutation(): ROX renders programs without tool providers, so those calls cannot resolve.',
  'If the latest user message ends with a JSON object, treat it as the values submitted from a form inside the previous interactive block: a flat map from form field names to the submitted values.',
  'Never invent image or asset URLs; use only URLs that already appeared in the conversation or in tool results.',
]

const INTRO = `# OpenUI Guide

ROX renders at most one interactive OpenUI block inside an assistant answer: charts, tables, forms and cards that users can read and use directly in the chat. The model writes the block as OpenUI Lang in a single fenced \`\`\`openui code block, and the desktop client parses and renders it locally with no network round trip.

This guide is the component and syntax reference for authoring those programs. It is generated from the installed \`@openuidev/react-ui\` library, so the signatures below always match the renderer that ships with ROX. Everything after the intro is the system-prompt reference handed to the model.`

/**
 * Build the full doc: hand-written intro followed by the library prompt.
 * Pure and synchronous — the library is resolved once at module load.
 */
export function generateDoc(): string {
  const prompt = openuiChatLibrary.prompt({
    ...openuiChatPromptOptions,
    preamble: PREAMBLE,
    additionalRules: ADDITIONAL_RULES,
  })
  return `${INTRO}\n\n${prompt}\n`
}

async function main(): Promise<void> {
  const content = generateDoc()
  if (process.argv.includes('--check')) {
    const current = (() => {
      try {
        return readFileSync(OPENUI_DOC_PATH, 'utf8')
      } catch {
        return null
      }
    })()
    if (current !== content) {
      console.error('openui.md is stale — run: bun scripts/openui/generate-doc.ts')
      process.exit(1)
    }
    console.log(`openui.md up to date (${Buffer.byteLength(content, 'utf8')} bytes)`)
    return
  }

  writeFileSync(OPENUI_DOC_PATH, content, 'utf8')
  console.log(`wrote ${OPENUI_DOC_PATH} (${Buffer.byteLength(content, 'utf8')} bytes)`)
}

if (import.meta.main) await main()