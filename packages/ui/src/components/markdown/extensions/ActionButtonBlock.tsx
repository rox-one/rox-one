/**
 * TipTap action-button block (LSX-WP-033 narrow slice).
 *
 * Declarative typed ActionSpec only. Imported fences render inert until
 * reviewed. This client slice never executes JS/shell/network side effects.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import * as React from 'react'
import i18n from 'i18next'
import {
  ACTION_FENCE_LANGUAGES,
  beginClientActionAttempt,
  createClientActionUiState,
  parseActionFenceBody,
  presentationStateForSpec,
  renderActionBasicExport,
  renderActionFenceMarkdown,
  sanitizeActionLabel,
  settleClientActionAttempt,
  type ActionSpec,
  type ClientActionUiState,
} from '../../../../../core/src/docs/action-spec' // worktree-safe; same module as @rox/core/docs
import { fenceCodeAttribute, serializeLegacyFence } from './legacy-fence'

const ACTION_LANGUAGES = ACTION_FENCE_LANGUAGES

function translate(key: string, fallback: string): string {
  const raw = i18n.t(key, { defaultValue: fallback }) as unknown
  const value = typeof raw === 'string' ? raw : String(raw ?? '')
  return value.length > 0 && value !== key ? value : fallback
}


function promoteActionFencedBlocks(element: HTMLElement): void {
  for (const pre of Array.from(element.querySelectorAll('pre'))) {
    const codeEl = pre.querySelector('code')
    const lang = (codeEl?.className.match(/language-([\w+-]+)/i)?.[1] ?? '').toLowerCase()
    if (!ACTION_LANGUAGES.has(lang)) continue
    const block = element.ownerDocument.createElement('div')
    block.setAttribute('data-type', 'action-button')
    block.setAttribute('data-code', codeEl?.textContent ?? '')
    block.setAttribute('data-language', lang || 'rox-action')
    pre.replaceWith(block)
  }
}

function parseSpecFromCode(code: string, language?: string): ActionSpec {
  const result = parseActionFenceBody(code, {
    language: language || 'rox-action',
    imported: language !== undefined && language !== 'rox-action',
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

export function createActionButtonContent(spec?: Partial<ActionSpec>): {
  type: 'actionButton'
  attrs: { code: string; language: string }
} {
  const base = defaultSlashSpec()
  const merged: ActionSpec = {
    ...base,
    ...spec,
    label: sanitizeActionLabel(spec?.label ?? base.label) || base.label,
    reviewState: spec?.reviewState ?? 'unreviewed',
    rejectedUnsafe: spec?.rejectedUnsafe === true,
    failurePolicy: spec?.failurePolicy ?? 'stopOnError',
    kind: spec?.kind ?? 'command',
  }
  return {
    type: 'actionButton',
    attrs: {
      code: JSON.stringify(
        {
          kind: merged.kind,
          label: merged.label,
          reviewState: merged.reviewState,
          failurePolicy: merged.failurePolicy,
          ...(merged.commandId ? { commandId: merged.commandId } : {}),
          ...(merged.entityRef ? { entityRef: merged.entityRef } : {}),
          ...(merged.templateId ? { templateId: merged.templateId } : {}),
          ...(merged.blockKind ? { blockKind: merged.blockKind } : {}),
          ...(merged.formula ? { formula: merged.formula } : {}),
          ...(merged.workflowRef ? { workflowRef: merged.workflowRef } : {}),
          ...(merged.inputs ? { inputs: merged.inputs } : {}),
        },
        null,
        2,
      ),
      language: 'rox-action',
    },
  }
}

export function insertActionButtonContent(
  editor: {
    chain: () => {
      focus: () => any
      insertContentAt: (pos: number, payload: unknown) => any
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

function statusCopy(presentation: ClientActionUiState['presentation']): string {
  switch (presentation) {
    case 'inert':
      return translate(
        'notes.actionButton.inertHint',
        'Imported action is inert until reviewed — not executed.',
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
      const result = beginClientActionAttempt(spec, prev)
      if (!result.accepted) return result.ui
      // Presentation-only pending pulse — never invent success / never execute.
      queueMicrotask(() => {
        setUi((current) => settleClientActionAttempt(spec, current, 'default'))
      })
      return result.ui
    })
  }, [spec, editor.isEditable])

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
          title={statusCopy(presentation)}
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
          {statusCopy(presentation)}
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
        getAttrs: (el: HTMLElement) => ({
          code: el.getAttribute('data-code') ?? '',
          language: el.getAttribute('data-language') ?? 'rox-action',
        }),
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
    return helpers.createNode('actionButton', {
      code: token.text ?? '',
      language: lang || 'rox-action',
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
