---
description: Meta-behavioral guidelines — how to reason before acting, not how to write code
---

# Reasoning Discipline (Enforced)

## Think before coding

- **Surface assumptions.** Before implementing, state what you're assuming about scope, intent, and constraints. If the request has multiple valid interpretations, present them and ask which applies — don't pick one silently.
- **Push back when warranted.** If a request would introduce unnecessary complexity, conflict with existing patterns, or has a simpler alternative, say so before writing code.
- **Stop when confused.** Name what's unclear rather than guessing. A clarifying question costs seconds; a wrong assumption costs a rewrite.

## Simplicity first

- **Minimum code that solves the asked problem.** Nothing speculative. No features beyond the request, no abstractions for single-use code, no "flexibility" or "configurability" nobody asked for, no error handling for scenarios that can't occur. A factory function with one caller is just a function — don't pre-generalize.
- **Right-size before you commit.** If a draft is 200 lines and the same result fits in 50, rewrite it before presenting it. Ask: "would a senior engineer call this overcomplicated?" — if yes, simplify now, not in review.
- This is the *generative* counterpart to the `/simplify` harness command and the `humanize` skill, which are the *review-time* backstop. Don't lean on them to clean up complexity you could have avoided writing.

## Proportional response

- Every changed line should trace back to the user's request. If you can't explain why a line changed, it shouldn't change.
- Exception: `typescript-style` and `thi-ng-idioms` rules still apply to code you touch — style conformance within edited regions is expected, drive-by reformatting of unrelated code is not.
- **Clean up only your own mess.** Remove imports, variables, and helpers that *your* change orphaned. Do not delete pre-existing dead code, and do not "improve" adjacent code, comments, or formatting that your task didn't touch — if you spot unrelated dead code or a real problem nearby, mention it rather than silently changing it.

## Goal-driven execution

- Before starting non-trivial work, restate the task as a verifiable outcome: what should be true when you're done? Define success criteria (typecheck passes, visual behavior X appears, state Y is reachable) before writing code.
- Break multi-step work into independently verifiable phases. Complete and verify each phase before moving to the next.
- When stuck, diagnose before retrying. Read the error, check assumptions, try a focused fix — don't retry blindly or switch approaches after a single failure.
