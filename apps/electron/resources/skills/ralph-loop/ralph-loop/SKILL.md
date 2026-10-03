---
name: ralph-loop
description: "Iterative goal-driven execution loop skill for Codex and CodeX. Use when the user wants the agent to keep going until a task is done, work in cycles, repeatedly plan act check fix, continue until complete, self-review each round, or avoid stopping after a single pass. Good for coding tasks, debugging, test-fix loops, backlog burn-down, research with checkpoints, and multi-step delivery. Triggers on phrases like 'loop until done', 'keep iterating', 'continue working', 'work through this step by step', 'repeat until passing', 'run a plan and check each round', 'don't stop at analysis'."
---

# Codex Ralph Loop Skill

IRON LAW: EVERY LOOP MUST EITHER PRODUCE A REAL DELTA, A VERIFIED RESULT, OR A CLEAR REASON TO STOP. NO EMPTY PROGRESS CLAIMS.

Red Flags (return to Step 1 if any appear):
- Saying "still working" without a changed file, command result, finding, or decision.
- Repeating the same failed action without a new hypothesis.
- Making edits before defining what "done" looks like.
- Continuing after the task is complete just to look busy.

## Workflow

Copy this checklist and check off items as you complete them:

```text
Codex Ralph Loop Skill Progress:

- [ ] Step 1: Define the finish line REQUIRED
  - [ ] 1.1 Restate the user goal in one sentence
  - [ ] 1.2 Identify deliverable, verification, and constraints
  - [ ] 1.3 Find the first blocking unknown
- [ ] Step 2: Set loop boundaries REQUIRED
  - [ ] 2.1 Choose the next smallest meaningful action
  - [ ] 2.2 Set stop conditions and escalation points
  - [ ] 2.3 Decide whether planning is needed
- [ ] Step 3: Run the loop
  - [ ] 3.1 Execute one meaningful step
  - [ ] 3.2 Verify the outcome
  - [ ] 3.3 Record what changed
  - [ ] 3.4 Decide continue, escalate, or stop
- [ ] Step 4: Close the loop REQUIRED
  - [ ] 4.1 Deliver outcome and evidence
  - [ ] 4.2 State remaining risks or blockers
```

## Step 1: Define The Finish Line REQUIRED

Start by answering these questions:
- What exact result is the user expecting at the end of this turn?
- What counts as proof that the result is correct?
- What constraint matters most here: correctness, speed, safety, style, or minimal change?
- What is the first thing you do not yet know that could block progress?

If the request is implementation-oriented, assume the user wants action, not a speculative plan. Only pause for clarification when a wrong assumption would create meaningful risk.

For larger tasks, create a short plan only after you understand the finish line. Keep one step in progress at a time.

## Step 2: Set Loop Boundaries REQUIRED

Before each cycle, decide:
- What is the next smallest action that could materially move the task forward?
- What output should that action produce: file change, test result, console evidence, finding, or decision?
- What condition would tell you to stop the loop?
- What condition would require user confirmation?

Use a confirmation gate before:
- Destructive changes.
- Choices with non-obvious product or architecture tradeoffs.
- Expensive generation or broad refactors the user did not ask for.

Do not create fake ceremony. If the next step is obvious and safe, take it.

## Step 3: Run The Loop

Each loop should be short and concrete.

### 3.1 Execute One Meaningful Step

Choose exactly one primary objective for the current cycle:
- Gather missing context.
- Make a bounded change.
- Run a verification command.
- Inspect the result of the previous step.

Ask:
- What is the fastest action that could falsify my current assumption?
- If this step succeeds, what new fact will I know?
- If this step fails, what branch will I take next?

### 3.2 Verify The Outcome

After each action, check:
- Did the action change the world in a useful way?
- Did it move the task closer to the finish line?
- Did it introduce a new risk?
- Is the result verified or only inferred?

Prefer direct verification over confidence language.

### 3.3 Record What Changed

Summarize the loop in one compact update:
- Action taken.
- Result observed.
- Next step.

Do not repeat full history every round. Only carry forward what matters now.

If you need examples of loop summaries or stop decisions, load [references/loop-patterns.md](references/loop-patterns.md).

### 3.4 Decide Continue, Escalate, Or Stop

Continue when:
- There is a clear next step and the task is not done.
- New evidence points to a better bounded action.

Escalate when:
- Two reasonable paths have different hidden costs.
- The task conflicts with existing user changes.
- The next action is destructive or broad.

Stop when:
- The requested outcome is delivered.
- Verification is sufficient for this task.
- The remaining gap is blocked by missing user input, missing credentials, or an external dependency you cannot resolve locally.

## Step 4: Close The Loop REQUIRED

When the loop ends, deliver:
- What was completed.
- How you verified it.
- What remains, if anything.
- Any concrete follow-up the user should know about.

Be concise. Do not write a changelog unless the task genuinely needs one.

## Anti-Patterns

Do not:
- Announce progress without evidence.
- Re-run the same command after a failure without a new reason.
- Over-plan small tasks that should just be executed.
- Expand scope because "while I was here" ideas appeared.
- Keep iterating after the user's request is already satisfied.
- Confuse activity with momentum.

## Pre-Delivery Checklist

- [ ] The finish line was defined before major work began.
- [ ] Each cycle produced a concrete artifact, result, or stop decision.
- [ ] Verification was run when the task required it, or the lack of verification was stated plainly.
- [ ] No hidden scope expansion was introduced.
- [ ] Final response states outcome first, then proof, then remaining risk.
