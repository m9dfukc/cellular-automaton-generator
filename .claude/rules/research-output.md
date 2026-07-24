---
description: "Convention for research/analysis document location — write under docs/research/, never docs/ root or project root"
---

# Research Output Location

When producing research documents, reference compilations, or analysis output:

- **Always write to `docs/research/`** — never `docs/` root, `.tmp/`, or project root
- **Not for brainstorm session summaries** — those go to `docs/brainstorming/YYYY-MM-DD-<topic>.md` (see the `brainstorm` skill), not here
- Convention is flat, topic-prefixed kebab-case filenames — `docs/research/` has no subdirectories today; add one only if a single topic outgrows a handful of files
- Use kebab-case filenames prefixed with the topic: `thi-ng-blog-research.md`, `mask-coordinate-system.md`
- `docs/legacy-audit.md` predates this convention and stays at `docs/` root — don't move it, but don't add new root-level analysis docs alongside it
- Before finishing, confirm the new file is actually under `docs/research/` with a kebab-case name (`ls docs/research/`) — misplaced files break consumers like the `evolve-ground-truth` skill (reads `docs/research/**/*.md`) and rules such as `hand-tuning-discipline` that cite specific research docs by path
