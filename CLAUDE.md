# cellular-automaton-generator

Web port of an old Processing cellular-automaton sketch — TypeScript + thi.ng/umbrella, declarative shell, typed-array core.

## Commands

```bash
yarn dev            # Vite dev server
yarn build          # tsc --noEmit + vite build
yarn build:single   # single-file build (inlined bundle)
yarn preview        # preview production build
yarn test           # bundle + run test/verify.ts
```

Use `yarn`, not `npm`.

## Testing is the human's job — never test on your own

**Do not run, drive, or observe the app to verify behaviour.** No launching the
dev server, no `yarn preview`, no browser automation (Puppeteer/Playwright), no
headless runtime checks, no installing tools to do any of that. The maintainer
does **all** interactive, visual, audio, and browser testing manually — hand
those checks to them with clear steps, don't perform them.

Still yours (non-interactive static gates, always run before handing off):
`yarn test` (bit-exact invariant), `yarn build` / `yarn build:single`,
`tsc --noEmit`. These are not "testing the app" — they must stay green.

## Invariants — don't break these

- **The default rule (`↖ 6`) is bit-exact to the original Processing sketch.** `yarn test` diffs grid + pixel output against a reference port; it must stay green and the default behaviour must never change.
- **The original's quirks are intentional, not bugs.** Mixed edge handling (left/top clamp, right/bottom wrap) and colouring from the pre-step grid are faithful to the `.pde` — don't "fix" them.
- **New rstream reactions on the config atom must use `dedupe(equiv)`.** `dedupe()` defaults to reference equality, so a reaction mapping to a fresh array fires on every unrelated atom change (this once caused a reseed-to-frame-1 bug). Use `equiv` from `@thi.ng/equiv`.

Deeper context (architecture boundary, reactive setup, curated rule-pool methodology, deploy notes) lives in `CONTEXT.md`.

## Agent skills

This repo is developed with Matt Pocock's Claude Code skill suite — the
idea→ship flow (`/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement`),
plus `/code-review`, `/triage`, `/diagnosing-bugs` and others. `/ask-matt`
navigates them. The skills live in `.claude/skills/` and are **intentionally
gitignored**: they're portable, per-machine tooling, not part of this repo.
Install them with `/setup-matt-pocock-skills`. Only the repo-specific config is
versioned — `.claude/rules/`, `.claude/settings.json`, and the `docs/agents/`
docs below.

### Issue tracker

Issues are tracked in GitHub Issues (`gh` CLI), repo `m9dfukc/cellular-automaton-generator`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary — the five canonical role names used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.

## Language

Conversations may be in German. All generated artifacts — research docs, code comments, commit messages, PR descriptions — must be in English.
