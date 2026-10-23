/**
 * TipTap action-button block (LSX-WP-033 narrow slice).
 *
 * Declarative typed ActionSpec only. Imported fences render inert until
 * reviewed. This client slice never executes JS/shell/network side effects.
 */
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import * as React from 'react'
import i18n from 'i18next'
import {
  ACTION_FENCE_LANGUAGES,
  beginClientActionAttempt,
  createClientActionUiState,
  normalizeActionSpec,
  parseActionFenceBody,
  presentationStateForSpec,
  renderActionBasicExport,
  renderActionFenceMarkdown,
  sanitizeActionLabel,
  serializeActionSpec,
  settleClientActionAttempt,
  type ActionSpec,
  type ClientActionUiState,
} from '@rox/core/docs'
import { fenceCodeAttribute, serializeLegacyFence } from './legacy-fence'

const ACTION_LANGUAGES = ACTION_FENCE_LANGUAGES

function translate(key: string, fallback: string): string {
  const raw = i18n.t(key, { defaultValue: fallback }) as unknown
  const value = typeof raw === 'string' ? raw : String(raw ?? '')
  return value.length > 0 && value !== key ? value : fallback
}


/**
 * On ingest: always store language `rox-action`. Keep inbound lang only as
 * `sourceLanguage` inside the serialized spec/JSON (never force imported just
 * because attrs.language !== rox-action after canonicalize).
 */
function ingestActionAttrs(code: string, inboundLang: string): { code: string; language: string } {
  const lang = (inboundLang || 'rox-action').trim().toLowerCase() || 'rox-action'
  const result = parseActionFenceBody(code, {
    language: lang,
    imported: lang !== 'rox-action',
  })
  const spec = result.ok ? result.spec : result.inertSpec
  const withSource: ActionSpec =
    lang !== 'rox-action' && !spec.sourceLanguage
      ? { ...spec, sourceLanguage: lang }
      : spec
  return {
    code: serializeActionSpec(withSource).replace(/\n$/, ''),
    language: 'rox-action',
  }
}

function promoteActionFencedBlocks(element: HTMLElement): void {
  for (const pre of Array.from(element.querySelectorAll('pre'))) {
    const codeEl = pre.querySelector('code')
    const lang = (codeEl?.className.match(/language-([\w+-]+)/i)?.[1] ?? '').toLowerCase()
    if (!ACTION_LANGUAGES.has(lang)) continue
    const ingested = ingestActionAttrs(codeEl?.textContent ?? '', lang || 'rox-action')
    const block = element.ownerDocument.createElement('div')
    block.setAttribute('data-type', 'action-button')
    block.setAttribute('data-code', ingested.code)
    block.setAttribute('data-language', ingested.language)
    pre.replaceWith(block)
  }
}

function parseSpecFromCode(code: string, language?: string): ActionSpec {
  // After ingest, attrs.language is always rox-action; imported/sourceLanguage
  // live in the JSON body — do not re-derive imported from language.
  const result = parseActionFenceBody(code, {
    language: language || 'rox-action',
  })
  return result.ok ? result.spec : result.inertSpec
}

function defaultSlashSpec(): ActionSpec {
  // Unreviewed/inert until ActionBuilder exists — no fake command id.
  return {
    kind: 'command',
    label: translate('notes.actionButton.defaultLabel', 'Action'),
    reviewState: 'unreviewed',
    failurePolicy: 'stopOnError',
    rejectedUnsafe: false,
  }
}

export function createActionButtonContent(spec?: Partial<ActionSpec>): JSONContent {
  const base = defaultSlashSpec()
  // Route Partial through normalize → serialize so insert/slash match fence ingest
  // (rejectedUnsafe/sourceLanguage + validated formula/inputs).
  const result = normalizeActionSpec({
    ...base,
    ...spec,
    label: sanitizeActionLabel(spec?.label ?? base.label) || base.label,
    reviewState: spec?.reviewState ?? 'unreviewed',
    failurePolicy: spec?.failurePolicy ?? 'stopOnError',
    kind: spec?.kind ?? 'command',
  })
  const normalized = result.ok ? result.spec : result.inertSpec
  return {
    type: 'actionButton',
    attrs: {
      code: serializeActionSpec(normalized).replace(/\n$/, ''),
      language: 'rox-action',
    },
  }
}

export function insertActionButtonContent(
  editor: {
    chain: () => {
      focus: () => any
      insertContentAt: (pos: number, payload: JSONContent) => any
      run: () => any
    }
    state: { selection: { from: number } }
  },
  insertPos?: number,
  spec?: Partial<ActionSpec>,
): void {
  const targetPos = insertPos ?? editor.state.selection.from
  editor.chain().focus().insertContentAt(targetPos, createActionButtonContent(spec)).run()
}

/** Import copy only when sourceLanguage is set and !== rox-action (not rejectedUnsafe alone). */
export function isImportedAction(spec: ActionSpec): boolean {
  const source = typeof spec.sourceLanguage === 'string' ? spec.sourceLanguage.trim().toLowerCase() : ''
  return Boolean(source && source !== 'rox-action')
}

function statusCopy(presentation: ClientActionUiState['presentation'], spec: ActionSpec): string {
  switch (presentation) {
    case 'inert':
      return isImportedAction(spec)
        ? translate(
            'notes.actionButton.inertHint',
            'Imported action is inert until reviewed — not executed.',
          )
        : translate(
            'notes.actionButton.draftInertHint',
            'Draft action is inert until reviewed — not executed.',
          )
    case 'pending':
      return translate('notes.actionButton.pendingHint', 'Pending (no side effects in this editor).')
    case 'offline':
      return translate('notes.actionButton.offlineHint', 'Offline — action unavailable.')
    case 'failure':
      return translate('notes.actionButton.failureHint', 'Action failed.')
    case 'success':
      return translate('notes.actionButton.successHint', 'Action completed.')
    default:
      return translate('notes.actionButton.defaultHint', 'Declarative action (execution gated).')
  }
}


/** Activate is allowed only while the editor is editable and the button is not inert/pending. */
export function isActionButtonActivateAllowed(options: {
  isEditable: boolean
  inert: boolean
  pending: boolean
}): boolean {
  return options.isEditable && !options.inert && !options.pending
}

function ActionButtonNodeView({
  node,
  editor,
  getPos,
}: {
  node: { attrs: { code?: string; language?: string } }
  editor: { isEditable: boolean; chain: () => any }
  getPos: (() => number | undefined) | boolean
}) {
  const code = String(node.attrs.code ?? '')
  const language = String(node.attrs.language ?? 'rox-action')
  const spec = React.useMemo(() => parseSpecFromCode(code, language), [code, language])
  const [ui, setUi] = React.useState<ClientActionUiState>(() => createClientActionUiState(spec))
  const specRef = React.useRef(spec)
  specRef.current = spec

  React.useEffect(() => {
    setUi(createClientActionUiState(spec))
  }, [spec])

  const label = sanitizeActionLabel(spec.label) || translate('notes.actionButton.defaultLabel', 'Action')
  const presentation = ui.presentation
  const inert = presentation === 'inert' || presentationStateForSpec(spec) === 'inert'
  const pending = presentation === 'pending'
  const activateAllowed = isActionButtonActivateAllowed({
    isEditable: editor.isEditable,
    inert,
    pending,
  })

  const onActivate = React.useCallback(() => {
    // Read-only: disable + no-op (no pending pulse) — same gate as Tabs/Columns.
    if (!editor.isEditable) return
    setUi((prev) => {
      const result = beginClientActionAttempt(specRef.current, prev)
      if (!result.accepted) return result.ui
      const acceptedAttemptId = result.ui.attemptId
      // Presentation-only pending pulse — never invent success / never execute.
      // Only settle if this attempt is still current (mid-flight attrs reset desyncs otherwise).
      queueMicrotask(() => {
        setUi((current) =>
          settleClientActionAttempt(specRef.current, current, 'default', {
            expectedAttemptId: acceptedAttemptId,
          }),
        )
      })
      return result.ui
    })
  }, [editor.isEditable])

  const selectNode = React.useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return
    editor.chain().focus().setNodeSelection(pos).run()
  }, [editor, getPos])

  return (
    <NodeViewWrapper
      contentEditable={false}
      className="tiptap-action-button-block"
      data-type="action-button"
      data-presentation={presentation}
      data-kind={spec.kind}
      data-review-state={spec.reviewState}
      data-rejected-unsafe={spec.rejectedUnsafe ? 'true' : 'false'}
      data-drag-handle
      onMouseDownCapture={(event: React.MouseEvent) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement | null
        if (target?.closest('button')) return
        event.preventDefault()
        event.stopPropagation()
        selectNode()
      }}
    >
      <div className="tiptap-action-button-chrome">
        <button
          type="button"
          className="tiptap-action-button-surface"
          data-presentation={presentation}
          aria-disabled={!activateAllowed ? true : undefined}
          disabled={!activateAllowed}
          title={statusCopy(presentation, spec)}
          aria-label={label}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!editor.isEditable) return
            onActivate()
          }}
        >
          <span className="tiptap-action-button-label">{label}</span>
          <span className="tiptap-action-button-kind" aria-hidden="true">
            {spec.kind}
          </span>
        </button>
        <p className="tiptap-action-button-status" data-presentation={presentation}>
          {statusCopy(presentation, spec)}
        </p>
      </div>
    </NodeViewWrapper>
  )
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    actionButton: {
      insertActionButton: (spec?: Partial<ActionSpec>) => ReturnType
    }
  }
}

export const ActionButtonBlock = Node.create({
  name: 'actionButton',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: fenceCodeAttribute,
      language: {
        default: 'rox-action',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-language') ?? 'rox-action',
        renderHTML: (attributes: { language?: string }) =>
          attributes.language ? { 'data-language': attributes.language } : {},
      },
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: (
          state: Parameters<typeof serializeLegacyFence>[0],
          node: { attrs?: { code?: string; language?: string } },
        ) => {
          const language = String(node.attrs?.language ?? 'rox-action')
          const spec = parseSpecFromCode(String(node.attrs?.code ?? ''), language)
          state.write(renderActionFenceMarkdown(spec, language))
          state.closeBlock(node)
        },
        parse: {
          updateDOM: (element: HTMLElement) => {
            promoteActionFencedBlocks(element)
          },
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="action-button"]',
        getAttrs: (el: HTMLElement) => {
          const inboundLang = el.getAttribute('data-language') ?? 'rox-action'
          const inboundCode = el.getAttribute('data-code') ?? ''
          // Legacy HTML may still carry inbound fence langs — canonicalize on parse.
          if (inboundLang.trim().toLowerCase() === 'rox-action') {
            return { code: inboundCode, language: 'rox-action' }
          }
          return ingestActionAttrs(inboundCode, inboundLang)
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'action-button', class: 'tiptap-action-button-block' })]
  },

  renderText({ node }) {
    const language = String(node.attrs.language ?? 'rox-action')
    const spec = parseSpecFromCode(String(node.attrs.code ?? ''), language)
    return renderActionBasicExport(spec)
  },

  markdownTokenName: 'code',

  parseMarkdown: (token: any, helpers: any) => {
    const lang = String(token.lang ?? '').toLowerCase()
    if (!ACTION_LANGUAGES.has(lang)) return []
    const ingested = ingestActionAttrs(String(token.text ?? ''), lang || 'rox-action')
    return helpers.createNode('actionButton', {
      code: ingested.code,
      language: ingested.language,
    })
  },

  renderMarkdown: (node: any) => {
    const language = String(node.attrs?.language ?? 'rox-action')
    const spec = parseSpecFromCode(String(node.attrs?.code ?? ''), language)
    return renderActionFenceMarkdown(spec, language)
  },

  addCommands() {
    return {
      insertActionButton:
        (spec) =>
        ({ commands }) =>
          commands.insertContent(createActionButtonContent(spec)),
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ActionButtonNodeView as any, {
      className: 'tiptap-action-button-view',
    })
  },
})

export { renderActionBasicExport, parseSpecFromCode }
