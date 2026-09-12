/**
 * Magic-word workflow registry (Rox issue 23).
 *
 * Typed WorkflowSpecs — not hidden prompt macros. Composer resolves trigger
 * phrases, shows cost/skills/stop before run, and confirms high-cost/high-trust.
 */
import { parseWorkflowSpec, type WorkflowSpec } from '../tasks/schema.ts'

export type CostClass = 'low' | 'medium' | 'high'
export type TrustClass = 'normal' | 'high'

export type MagicWorkflowId =
  | 'ultrathink'
  | 'ultragoal'
  | 'ultrawork'
  | 'agisota'
  | 'board-room'
  | 'ultragrill'
  | 'trustrust'
  | 'orchestrate-workflowz'

export type MagicWorkflow = {
  id: MagicWorkflowId
  /** Case-insensitive phrases matched as whole words / phrases. */
  triggers: readonly string[]
  agents: readonly string[]
  evidenceGate: string
  concurrency: number
  stopCondition: string
  costClass: CostClass
  trustClass: TrustClass
  skills: readonly string[]
  spec: WorkflowSpec
}

export type MagicWorkflowArtifactKind = 'cancellation' | 'continuation' | 'summary'

export type MagicWorkflowArtifact = {
  kind: MagicWorkflowArtifactKind
  workflowId: MagicWorkflowId
  createdAt: number
  body: string
}

function mustParse(raw: unknown, label: string): WorkflowSpec {
  const parsed = parseWorkflowSpec(raw)
  if (!parsed.success) {
    throw new Error(`Invalid WorkflowSpec for ${label}: ${parsed.error.message}`)
  }
  return parsed.data
}

function sessionSpec(opts: {
  id: MagicWorkflowId
  title: string
  goal: string
  acceptance: string
  runner?: 'conduct' | 'orchestrate'
  skills?: string[]
  concurrency: number
  tokenBudget?: number
  nodes: Array<{ id: string; prompt: string; depends_on?: string[] }>
}): WorkflowSpec {
  const last = opts.nodes[opts.nodes.length - 1]!.id
  return mustParse(
    {
      id: opts.id,
      title: opts.title,
      goal: opts.goal,
      acceptance_criteria: opts.acceptance,
      runner: opts.runner ?? 'conduct',
      skills: opts.skills,
      max_parallel: opts.concurrency,
      token_budget: opts.tokenBudget,
      nodes: opts.nodes,
      outputs: {
        summary: `\${nodes.${last}.output}`,
        continuation: `\${nodes.${last}.output}`,
      },
    },
    opts.id,
  )
}

export const MAGIC_WORKFLOWS: readonly MagicWorkflow[] = [
  {
    id: 'ultrathink',
    triggers: ['ultrathink'],
    agents: ['planner'],
    evidenceGate: 'Reasoning is written down before any action.',
    concurrency: 1,
    stopCondition: 'Reasoning card is complete or the user cancels.',
    costClass: 'low',
    trustClass: 'normal',
    skills: ['ultrathink'],
    spec: sessionSpec({
      id: 'ultrathink',
      title: 'Ultrathink',
      goal: 'Think through the request before acting.',
      acceptance: 'A written reasoning trace exists.',
      concurrency: 1,
      skills: ['ultrathink'],
      nodes: [{ id: 'reason', prompt: 'Think through the user request. Record assumptions and a plan. Do not take irreversible actions.' }],
    }),
  },
  {
    id: 'ultragoal',
    triggers: ['ultragoal'],
    agents: ['planner', 'critic'],
    evidenceGate: 'Measurable acceptance criteria exist and a critic has reviewed them.',
    concurrency: 2,
    stopCondition: 'Criteria accepted, or three planner/critic iterations complete.',
    costClass: 'high',
    trustClass: 'high',
    skills: ['planning'],
    spec: sessionSpec({
      id: 'ultragoal',
      title: 'Ultragoal',
      goal: 'Turn the request into a measurable goal with acceptance criteria.',
      acceptance: 'Acceptance criteria are written and critic-reviewed.',
      concurrency: 2,
      tokenBudget: 80_000,
      skills: ['planning'],
      nodes: [
        { id: 'plan', prompt: 'Decompose the user request into a goal, constraints, and measurable acceptance criteria.' },
        { id: 'critique', depends_on: ['plan'], prompt: 'Review ${nodes.plan.output}. Reject vague criteria. Return an accepted or revised rubric.' },
      ],
    }),
  },
  {
    id: 'ultrawork',
    triggers: ['ultrawork'],
    agents: ['implementer'],
    evidenceGate: 'The stated goal is executed and tests or checks are reported.',
    concurrency: 1,
    stopCondition: 'Goal complete, blocked on evidence, or cancelled.',
    costClass: 'medium',
    trustClass: 'normal',
    skills: ['implementation'],
    spec: sessionSpec({
      id: 'ultrawork',
      title: 'Ultrawork',
      goal: 'Execute the current goal to completion with reported checks.',
      acceptance: 'Work is done or a concrete blocker is recorded.',
      concurrency: 1,
      tokenBudget: 40_000,
      skills: ['implementation'],
      nodes: [{ id: 'execute', prompt: 'Execute the user goal. Report checks that passed and any remaining blockers.' }],
    }),
  },
  {
    id: 'agisota',
    triggers: ['agisota'],
    agents: ['reviewer', 'defender'],
    evidenceGate: 'An independent counter-argument exists for every major claim.',
    concurrency: 2,
    stopCondition: 'Adversarial review complete or the user cancels.',
    costClass: 'medium',
    trustClass: 'high',
    skills: ['review'],
    spec: sessionSpec({
      id: 'agisota',
      title: 'Agisota',
      goal: 'Adversarially review the request and produce a defended verdict.',
      acceptance: 'Each major claim has a counter-argument and a response.',
      concurrency: 2,
      tokenBudget: 50_000,
      skills: ['review'],
      nodes: [
        { id: 'attack', prompt: 'Attack the user plan. List weakest claims and missing evidence.' },
        { id: 'defend', depends_on: ['attack'], prompt: 'Answer ${nodes.attack.output}. Keep only claims that survive.' },
      ],
    }),
  },
  {
    id: 'board-room',
    triggers: ['board-room', 'boardroom'],
    agents: ['chair', 'advocate', 'skeptic'],
    evidenceGate: 'A written decision records the vote and dissent.',
    concurrency: 3,
    stopCondition: 'Chair publishes a decision, or the debate hits the replica cap.',
    costClass: 'medium',
    trustClass: 'normal',
    skills: ['debate'],
    spec: sessionSpec({
      id: 'board-room',
      title: 'Board room',
      goal: 'Run a three-seat debate and publish a decision.',
      acceptance: 'A decision document includes advocate, skeptic, and chair positions.',
      concurrency: 3,
      tokenBudget: 60_000,
      skills: ['debate'],
      nodes: [
        { id: 'advocate', prompt: 'Argue for the strongest version of the user proposal.' },
        { id: 'skeptic', prompt: 'Argue against the user proposal. Demand evidence.' },
        { id: 'chair', depends_on: ['advocate', 'skeptic'], prompt: 'Decide using ${nodes.advocate.output} and ${nodes.skeptic.output}. Record dissent.' },
      ],
    }),
  },
  {
    id: 'ultragrill',
    triggers: ['ultragrill'],
    agents: ['interrogator'],
    evidenceGate: 'Every open question has a sourced answer or an explicit unknown.',
    concurrency: 1,
    stopCondition: 'Question list is empty, or five grill rounds complete.',
    costClass: 'high',
    trustClass: 'normal',
    skills: ['interrogation'],
    spec: sessionSpec({
      id: 'ultragrill',
      title: 'Ultragrill',
      goal: 'Interrogate the request until unanswered questions are sourced or marked unknown.',
      acceptance: 'No unanswered question remains without a source or unknown label.',
      concurrency: 1,
      tokenBudget: 70_000,
      skills: ['interrogation'],
      nodes: [{ id: 'grill', prompt: 'Ask the hardest questions about the request. Answer each with a source or mark it unknown. Stop when the list is empty.' }],
    }),
  },
  {
    id: 'trustrust',
    triggers: ['trustrust'],
    agents: ['auditor'],
    evidenceGate: 'Every claim has provenance or is removed.',
    concurrency: 1,
    stopCondition: 'Audit complete, or a claim cannot be proven and is dropped.',
    costClass: 'medium',
    trustClass: 'high',
    skills: ['audit'],
    spec: sessionSpec({
      id: 'trustrust',
      title: 'Trustrust',
      goal: 'Verify claims against evidence and drop anything unproven.',
      acceptance: 'Provenance exists for every remaining claim.',
      concurrency: 1,
      tokenBudget: 40_000,
      skills: ['audit'],
      nodes: [{ id: 'audit', prompt: 'List claims in the request. Attach provenance or drop the claim. Do not invent sources.' }],
    }),
  },
  {
    id: 'orchestrate-workflowz',
    triggers: ['orchestrate workflowz'],
    agents: ['conductor'],
    evidenceGate: 'The DAG finishes, is cancelled, or hits the token budget.',
    concurrency: 2,
    stopCondition: 'Orchestrator done, cancelled, or token budget exhausted.',
    costClass: 'high',
    trustClass: 'high',
    skills: ['orchestrate'],
    spec: sessionSpec({
      id: 'orchestrate-workflowz',
      title: 'Orchestrate workflowz',
      goal: 'Run the request as an orchestrated DAG with a summary artifact.',
      acceptance: 'A summary artifact exists and every node is done, cancelled, or failed with a reason.',
      runner: 'orchestrate',
      concurrency: 2,
      tokenBudget: 100_000,
      skills: ['orchestrate'],
      nodes: [
        { id: 'dispatch', prompt: 'Plan a small DAG for the user request. Spawn only the nodes required.' },
        { id: 'summarize', depends_on: ['dispatch'], prompt: 'Write a summary artifact from ${nodes.dispatch.output}. Include cancellation and continuation notes.' },
      ],
    }),
  },
]

const BY_ID = new Map(MAGIC_WORKFLOWS.map((workflow) => [workflow.id, workflow]))

export function getMagicWorkflow(id: MagicWorkflowId): MagicWorkflow {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown magic workflow: ${id}`)
  return found
}

export function needsConfirmation(workflow: MagicWorkflow): boolean {
  return workflow.costClass === 'high' || workflow.trustClass === 'high'
}

/** Longest trigger first so "orchestrate workflowz" wins over overlapping fragments. */
const TRIGGER_INDEX = MAGIC_WORKFLOWS
  .flatMap((workflow) => workflow.triggers.map((trigger) => ({ trigger, workflow })))
  .sort((a, b) => b.trigger.length - a.trigger.length)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function resolveMagicWords(text: string): MagicWorkflow[] {
  const haystack = text.replace(/\s+/g, ' ').trim()
  if (!haystack) return []
  const seen = new Set<MagicWorkflowId>()
  const matched: MagicWorkflow[] = []
  for (const { trigger, workflow } of TRIGGER_INDEX) {
    if (seen.has(workflow.id)) continue
    const flexible = new RegExp(`(?:^|\\s)${escapeRegExp(trigger).replace(/\\s+/g, '\\s+')}(?=\\s|$)`, 'i')
    if (!flexible.test(haystack)) continue
    seen.add(workflow.id)
    matched.push(workflow)
  }
  return matched
}

export function buildCancellationArtifact(
  workflowId: MagicWorkflowId,
  reason: string,
  now = Date.now(),
): MagicWorkflowArtifact {
  return { kind: 'cancellation', workflowId, createdAt: now, body: reason.trim() }
}

export function buildContinuationArtifact(
  workflowId: MagicWorkflowId,
  nextStep: string,
  now = Date.now(),
): MagicWorkflowArtifact {
  return { kind: 'continuation', workflowId, createdAt: now, body: nextStep.trim() }
}

export function buildSummaryArtifact(
  workflowId: MagicWorkflowId,
  body: string,
  now = Date.now(),
): MagicWorkflowArtifact {
  return { kind: 'summary', workflowId, createdAt: now, body: body.trim() }
}
