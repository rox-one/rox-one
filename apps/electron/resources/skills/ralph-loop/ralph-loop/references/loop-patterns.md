# Loop Patterns

Use this file only when you need concrete loop wording or decision templates.

## Minimal Loop Update

Use a short progress update between cycles:

```text
Action: inspected failing test output in X.
Result: root cause appears to be Y, not Z.
Next: patch Y and rerun the narrow test.
```

## Execution Cycle Template

Ask these questions in order:
1. What is the next smallest meaningful action?
2. What evidence should this action produce?
3. What would success change?
4. What would failure teach me?
5. After the result, should I continue, escalate, or stop?

## Good Stop Conditions

Stop the loop when one of these is true:
- The requested file or behavior change is complete.
- Verification passed at the right scope for the task.
- The next step requires a user decision with real tradeoffs.
- The next step depends on credentials, permissions, or systems you cannot access.

## Escalation Template

When you need the user, be concrete:

```text
Two paths are possible:
1. Minimal fix in the current design.
2. Slightly larger refactor that reduces repeat bugs.

The first is faster. The second is cleaner but changes more surface area.
```

## Completion Template

Keep the close-out short:

```text
Completed X and verified it with Y.
Remaining risk: Z.
```

## Anti-Loop Failures

If the loop stalls, look for one of these:
- The finish line was never defined.
- The same assumption is being retried without new evidence.
- Verification is broader than needed and slowing progress.
- The task is already done but the agent has not recognized it.
