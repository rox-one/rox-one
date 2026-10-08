import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { ReactFlowProvider } from '@xyflow/react'
import { LEARNING_NODE_KINDS, learningNodeLabel, type LearningMapNode } from '../learning-nodes'
import { learningFlowNode } from '../layout/learning-flow'
import { kindLabel } from '../nodes/node-content'
import { LearningNodeCard } from '../nodes/LearningNodeCard'

/**
 * Only `runtimeMap.eventAria` exists here — the shipped locales have no
 * `runtimeMap.kind.*` entry for the PRD §30 learning kinds, so this instance
 * reproduces exactly the case that would surface a raw key.
 */
async function mapI18n(): Promise<I18n> {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', fallbackLng: 'en', initAsync: false, resources: { en: { translation: { runtimeMap: { eventAria: '{{type}} event #{{sequence}}', kind: { run: 'Run' }, unknown: 'No data' } } } } })
  return i18n
}

function learningNode(kind: LearningMapNode['kind']): LearningMapNode {
  return { id: `learning:${kind}:auth-retry`, kind, role: 'durable', label: `Label: ${kind}`, provenance: { candidateId: `cand-${kind}` } }
}

function AriaProbe({ node, index }: { node: LearningMapNode; index: number }) {
  const { t } = useTranslation()
  return <span data-testid="aria">{learningFlowNode(node, index, t, false, 44).ariaLabel}</span>
}

function KindProbe({ kind }: { kind: string }) {
  const { t } = useTranslation()
  return <span>{kindLabel(kind, t)}</span>
}

describe('PRD §30 learning labels in the live map', () => {
  it('names every learning kind with the registry label instead of the raw i18n key', async () => {
    const i18n = await mapI18n()
    for (const kind of LEARNING_NODE_KINDS) {
      const label = renderToStaticMarkup(<I18nextProvider i18n={i18n}><KindProbe kind={kind} /></I18nextProvider>)
      expect(label).toContain(learningNodeLabel(kind))
      expect(label).not.toContain('runtimeMap.kind.')
    }
    expect(renderToStaticMarkup(<I18nextProvider i18n={i18n}><KindProbe kind="run" /></I18nextProvider>)).toContain('Run')
    expect(renderToStaticMarkup(<I18nextProvider i18n={i18n}><KindProbe kind="mystery" /></I18nextProvider>)).toBe('<span>mystery</span>')
  })

  it('gives every learning canvas node an aria label with no raw i18n key', async () => {
    const i18n = await mapI18n()
    for (const [index, kind] of LEARNING_NODE_KINDS.entries()) {
      const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><AriaProbe node={learningNode(kind)} index={index} /></I18nextProvider>)
      expect(html).toContain(`data-testid="aria"`)
      expect(html).toContain(`${learningNodeLabel(kind)} event #${index}`)
      expect(html).not.toContain('runtimeMap.kind.')
    }
  })

  it('renders the real learning card for a chain node that has no RuntimeEvent', async () => {
    const i18n = await mapI18n()
    const card = (node: LearningMapNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}><ReactFlowProvider><LearningNodeCard id={node.id} type="learning" data={{ learning: node }} selected={false} selectable={false} draggable={false} deletable={false} dragging={false} zIndex={0} isConnectable={false} positionAbsoluteX={0} positionAbsoluteY={0} /></ReactFlowProvider></I18nextProvider>)
    for (const kind of LEARNING_NODE_KINDS) {
      const node = learningNode(kind)
      const html = card(node)
      expect(html).toContain('data-testid="runtime-learning-node"')
      expect(html).toContain(`data-learning-kind="${kind}"`)
      expect(html).toContain(node.label)
      expect(html).toContain(learningNodeLabel(kind))
      expect(html).not.toContain('runtimeMap.kind.')
    }
  })
})