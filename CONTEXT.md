# Context — CA Applet

As of 2026-07-24. The working context for this codebase, so work can continue in VS Code / Claude Code without back-and-forth.

---

## What this is

Port of an old Processing sketch (`sketch_10_ca_experiment_optimized.pde`, a modified Game of Life, 600×600) to TypeScript + thi.ng/umbrella. Runs as a Vite app; `build:single` produces a self-contained HTML (~56 kB, ~20 kB gzip, zero external requests).

---

## Architecture — the one important decision

**Declarative thi.ng shell on the outside, imperative typed-array kernel on the hot path.** Per-pixel work can't be done declaratively at 600×600 @ 60 fps; that wasn't faked. The boundary runs exactly along the `CA` class: raw and fast inside, rstream/rdom/atom outside.

```
src/
  ca.ts       CA engine (the fast core, no thi.ng reactivity except @thi.ng/pixel)
  state.ts    defAtom<AppState> (config) + gen$/fps$ (high-freq streams, deliberately NOT in the atom)
  app.ts      RAF loop, reactions, input, rdom UI
  main.ts     entry
  style.css   dark instrument HUD
test/
  verify.ts   bit-exact diff against a naive int[][] reference port of the .pde
  bench.ts    kernel benchmark
```

### `CA` (src/ca.ts)

Flat `Uint8Array` grid + buffer, double-buffered with an O(1) reference swap. Edge index maps are precomputed (`colL`/`colR`/`rowT`/`rowB`, Int32Array; `rowT`/`rowB` are row _base offsets_, not indices). Framebuffer via `@thi.ng/pixel` `intBuffer(cols, rows, ABGR8888)` → `.data` is a Uint32Array, `.blitCanvas(ctx)` = one `putImageData`.

Public API:

| Member                                     | Purpose                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `grid: Uint8Array`, `size`, `cols`, `rows` | State                                                    |
| `img`                                      | IntBuffer (ABGR8888)                                     |
| `generation: number`                       | Counter                                                  |
| `dist`, `stripes`, `refDir`, `survival`    | Params                                                   |
| `populate()`                               | Write seed pattern                                       |
| `clear()`                                  | Empty                                                    |
| `step()`                                   | **fused**: 1 generation + pre-step pixels in one pass    |
| `process()`                                | generation only (for sub-steps)                          |
| `render()`                                 | pixels only (for pause/edit)                             |
| `paint(gx, gy, size, value)`               | square brush, centred, clipped                           |
| `toggle(gx, gy)`                           | single cell (now only used by the test)                  |
| `reconfigure(dist, stripes)`               | reseed                                                   |
| `setRule(refDir, survival)`                | rule in place, **no** reseed                             |
| `blit(ctx)`                                | canvas                                                   |

Colors (ABGR8888, little-endian = 0xAABBGGRR): `WHITE=0xffffffff`, `BLACK=0xff000000`, `BLUE=0xffff0000` (= RGB 0,0,255).

### Rule parametrization

The original hard-coded the reference neighbour (top-left) and the survival threshold (`sum < 6`). Both are now parameters:

- `refDir: 0..7` — reference neighbour. Order: `["↖","↑","↗","←","→","↙","↓","↘"]`. **0 = ↖ = the original.**
- `survival: 1..8` — threshold. **6 = the original.**

Rule: `next = (cur === 1 && sum < survival) ? ref : (cur === ref) ? 1 : cur`

The defaults (↖, 6) are **bit-identical** to the original — `yarn test` proves it (grid _and_ pixels, several configs, many generations).

### Quirks from the original (deliberately preserved, do not touch)

1. **Mixed edge behaviour:** left/top **clamp**, right/bottom **wrap**. Looks like a bug, but it's the original — and it visibly shapes the pattern.
2. **Colouring from the pre-step grid:** `draw()` renders first, then processes. Frame N shows S_N. That's why `step()` is fused.
3. Blue only when `i>0 && j>0 && grid[i][j-1]===1` (left neighbour alive), otherwise black; a dead cell = white.

Canonical names for these three cell states (used by the artwork-fabrication docs): **white = dead**, **blue = stable** (alive, left neighbour alive), **black = frontier** (alive, left neighbour dead — the growth edges where the rule is actively working). See `docs/research/artwork-fabrication-candidates.md`.

---

## Reactive setup (pitfalls)

**`dedupe()` defaults to reference equality.** This was a real bug: the reseed reaction mapped to a _new_ `[dist, stripes]` array, so it fired on _every_ atom change (pause, speed…) → `populate()` → jump back to frame 1. Fix: `dedupe(equiv)` from `@thi.ng/equiv`. **Applies to every new reaction.**

**`gen$`/`fps$` live outside the atom** — otherwise 60 Hz updates would trigger config reactions.

**Speed is fractional** (0.1–8): an accumulator in the RAF loop, `stepAcc += speed`, advance only when `>= 1`. 0.1 = true slow motion.

**rdom:** raw hiccup arrays (no hiccup-html, typing friction). Event attribs lowercase (`onclick`/`oninput`/`onchange`). Embedded `ISubscribable` streams bind reactively as text/attrib.

---

## Actions & semantics (deliberately cut this way)

| Action        | Key     | Behaviour                                                       |
| ------------- | ------- | --------------------------------------------------------------- |
| Run/Pause     | `space` | freezes exactly the running image                              |
| **Randomize** | `r`     | new random rule, **buffer keeps running** (no reseed!)         |
| **Reset**     | `x`     | original rule + defaults, then reseed                          |
| **Seed**      | `s`     | new seed pattern, **current rule stays**                       |
| **Clear**     | `c`     | empty the stage completely (to draw yourself)                  |
| Download PNG  | —       | `canvas.toBlob` → `ca-experiment-gen<N>.png`                   |
| Draw/Erase    | —       | brush 1–48, mode instead of toggle; drag points interpolated   |

`brush`/`tool` are **not** in `DEFAULTS` — Reset affects the simulation, not the drawing tool.

---

## Curated rule pool (`KEEPER_RULES` in app.ts)

Of the 32 reachable rules (8 directions × survival 4–7) all 32 were rendered and measured. Result:

- **survival 4–5 → flood/seed rasters.** Edge density < 3 %, activity 0–2 % (frozen at s4). Visually: almost fully blue. Out.
- **orthogonal directions (↑↓←→) at s6/7 → bands/lines.** Edge anisotropy 0.6–0.98. Out (by definition "under-complex").
- **diagonals (↖↗↙↘) × survival 6–7 → 2-D weave.** Edge density 12–16 %, anisotropy ~0.00, activity 18–22 %. **These are the 8 keepers.**

Randomize draws only from these 8 and never the current rule twice.

**Methodological warning for later analyses:** gzip compressibility as a complexity measure **does not work here** — the nice plaids are periodic and compress almost as well as the flood; the measure would have wrongly discarded the keepers as "simple". What agrees with the eye: **edge density + anisotropy + activity**.

---

## Verification

- `yarn test` — bit-exact diff against a naive `int[][]` reference port (grid + pixels, 5 configs incl. odd dimensions). **Must stay green; the default rule must never change.**
- `yarn build` — `tsc --noEmit && vite build`
- `yarn build:single` — self-contained HTML
- Benchmark: fused `step()` ~4.1 ms/gen at 600×600 (~240 gen/s)

**Interactive, visual, and browser behaviour is not verified here by tooling** — no Puppeteer, no headless runs, no browser automation, no dev-server driving. The maintainer does all interactive/visual/audio testing manually; agents run only the static gates above (`yarn test`, `yarn build`, `tsc --noEmit`). See CLAUDE.md → "Testing is the human's job".

---

## GitHub / Pages

- `.gitignore` is included; the lockfile (`yarn.lock`) should be committed.
- For Pages: set `base: "/<repo-name>/"` in `vite.config.ts`, otherwise asset paths break under `user.github.io/repo/`. Irrelevant for the **single-file** build (everything inline), relevant for the normal build.
- Deploy recommendation: an Actions workflow builds and deploys; `dist/` stays ignored.

---

## Next step

Audio synthesis is a **separate proof of concept** on the `poc-audio-synthesis` branch (deployed at `/poc/`), not part of main's roadmap. Its research, ADRs, and design vocabulary live on that branch.

Smaller open items on main, if desired:

- optionally extend the Randomize pool to 16 (bring the bands back as their own style).
- post-step colouring as an option (one-liner in `step()`, looks different on some seeds).
