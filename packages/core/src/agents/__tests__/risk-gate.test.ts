/**
 * W1-11 (#1508) — CI gate: every catalogue command carries a risk class
 * (TECH-SPEC §13.2 step 5, PLAN §3 W1-11 "every command has a `riskClass`").
 *
 * The gate is deliberately about *coverage plus the dangerous directions*:
 * a table entry that no catalogue command uses is stale (it hides a rename),
 * and a destructive command that resolves below `privileged` is the failure
 * that would actually let an agent delete something without a human decision.
 */

import { describe, expect, it } from 'bun:test'
import { COMMAND_CATALOGUE } from '../../commands/catalogue/index.ts'
import type { CommandDefinition } from '../../commands/registry.ts'
import {
  COMMAND_RISK,
  EXPLICITLY_CLASSIFIED_COMMANDS,
  MODULE_RISK_DEFAULT,
  RISK_CLASSES,
  isExplicitlyClassified,
  isRiskClass,
  maxRiskClass,
  riskClassFor,
  unclassifiedCommandTypes,
} from '../risk.ts'

const catalogueTypes = COMMAND_CATALOGUE.map(definition => definition.type)

/** Representative payloads so the payload-dependent classifiers take both branches. */
const SAMPLE_PAYLOADS: readonly unknown[] = [
  {},
  { members: [{ id: 'p1' }] },
  { attendees: [{ email: 'a@example.com' }] },
  { visibility: 'public' },
  { visibility: 'private' },
  undefined,
]

const RISK_CONTEXT = { workspaceId: 'ws-1', actor: { principalId: 'agent-1', kind: 'agent' as const } }

describe('W1-11 risk-class gate', () => {
  it('every catalogue entry has a riskClass function', () => {
    const missing = COMMAND_CATALOGUE.filter(definition => typeof definition.riskClass !== 'function').map(definition => definition.type)
    expect(missing).toEqual([])
  })

  it.each<string>(catalogueTypes)('%s resolves a valid class for every sample payload', type => {
    const definition = COMMAND_CATALOGUE.find(candidate => candidate.type === type) as CommandDefinition<unknown>
    for (const payload of SAMPLE_PAYLOADS) {
      const resolved = definition.riskClass(payload, RISK_CONTEXT)
      expect(isRiskClass(resolved)).toBe(true)
      expect(RISK_CLASSES).toContain(resolved)
    }
  })

  it('the explicit table only names declared commands', () => {
    const known = new Set<string>(catalogueTypes)
    expect(EXPLICITLY_CLASSIFIED_COMMANDS.filter(type => !known.has(type))).toEqual([])
  })

  it('the fallback list stays explainable (module default or a structural rule)', () => {
    const unclassified = unclassifiedCommandTypes(COMMAND_CATALOGUE)
    const unexplained = unclassified.filter(type => {
      const definition = COMMAND_CATALOGUE.find(candidate => candidate.type === type) as CommandDefinition<unknown>
      return definition.verb !== 'read' && definition.verb !== 'destroy' && !(definition.module in MODULE_RISK_DEFAULT)
    })
    expect(unexplained).toEqual([])
  })

  it('a destroy verb is never below privileged', () => {
    for (const definition of COMMAND_CATALOGUE) {
      if (definition.verb !== 'destroy') continue
      for (const payload of SAMPLE_PAYLOADS) {
        expect({ type: definition.type, risk: definition.riskClass(payload, RISK_CONTEXT) })
          .toEqual({ type: definition.type, risk: 'privileged' })
      }
    }
  })

  it('a read verb is routine', () => {
    for (const definition of COMMAND_CATALOGUE) {
      if (definition.verb !== 'read') continue
      expect({ type: definition.type, risk: definition.riskClass({}, RISK_CONTEXT) })
        .toEqual({ type: definition.type, risk: 'routine' })
    }
  })

  it('classifies the team-chat and governance commands from the spec table', () => {
    const resolve = (type: string, payload: unknown) => riskClassFor(type, type.split('.')[0] ?? '', 'write')(payload, RISK_CONTEXT)
    expect(resolve('im.create_chat', { members: [{ id: 'p1' }] })).toBe('consequential')
    expect(resolve('im.create_chat', {})).toBe('routine')
    expect(resolve('im.set_visibility', { visibility: 'public' })).toBe('privileged')
    expect(resolve('im.set_visibility', { visibility: 'private' })).toBe('consequential')
    expect(resolve('people.invite', {})).toBe('privileged')
    expect(resolve('identity.merge_placeholder', {})).toBe('privileged')
    expect(resolve('im.join_chat', {})).toBe('routine')
    expect(resolve('agents.pause', {})).toBe('privileged')
  })

  it('keeps MAX-risk combination monotonic', () => {
    expect(maxRiskClass('routine', 'consequential')).toBe('consequential')
    expect(maxRiskClass('privileged', 'routine')).toBe('privileged')
    expect(maxRiskClass('consequential', 'consequential')).toBe('consequential')
  })

  it('reports explicit coverage for the commands this package owns', () => {
    const owned = ['im.create_chat', 'im.join_chat', 'im.leave_chat', 'im.set_visibility', 'im.browse_public_chats',
      'workspaces.create', 'people.invite', 'identity.ensure_placeholder', 'identity.activate_placeholder',
      'identity.merge_placeholder', 'agents.provision_personal_agent', 'agents.invoke', 'agents.decide_approval', 'agents.pause']
    expect(owned.filter(type => !isExplicitlyClassified(type))).toEqual([])
    expect(Object.keys(COMMAND_RISK).length).toBeGreaterThan(150)
  })
})