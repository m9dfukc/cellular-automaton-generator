# Native Port Feasibility — Max for Live (RNBO) and VCV Rack

> Research doc · 2026-07-23 · primary-source feasibility study
> Companion to [`audio-synthesis.md`](./audio-synthesis.md) (aesthetic + architecture) and
> [`audio-libraries.md`](./audio-libraries.md) (web DSP library survey). Core files read:
> `src/ca.ts` (CA kernel), `src/audio/processor.js` (worklet DSP), `src/audio/engine.ts` (host glue).

## Scope

This is a **feasibility study, not a design spec.** The question is: how much of the *interesting*
part — the cellular-automaton kernel plus the sonification DSP — can be reused if the browser
instrument is ported to (1) a **Max for Live** device via **RNBO**, and (2) a **VCV Rack** module?
Interfaces, parameters, and UX *will* differ per target; the goal is to assess reuse, per-platform
constraints, and effort, then rank the targets and name the first de-risking prototype. Every
non-obvious claim is cited inline. The maintainer holds a Max/RNBO license.

---

## A. Portable core vs. platform-specific shell

The project already separates cleanly along the exact line a native port needs.

**Portable (platform-agnostic logic + DSP):**

- **The CA kernel** (`src/ca.ts`) — pure integer/typed-array logic: two `Uint8Array` grids,
  double-buffered swap, four precomputed neighbour-index maps, an 8-neighbour sum, and the rule
  `b = cur===1 && sum<surv ? ref : cur===ref ? 1 : cur`. Zero framework dependency **except**
  `@thi.ng/pixel`'s `IntBuffer`, which is used **only for rendering** (the `px[]` writes in `step()`
  / `render()`). Strip the pixel writes and the kernel is portable C/C++/rnboscript almost verbatim.
- **The sonification DSP** (`src/audio/processor.js`) — a per-sample chain: raster-scan region →
  wavetable → phasor read → one-pole DC blocker → `tanh` soft-clip → 10 ms gain ramp, plus a
  stereo-width phasor offset and a 2-stage Schroeder allpass diffuser. This is ordinary sample-loop
  DSP with no Web-Audio-specific math; it maps to any per-sample callback.
- **The sonification *mapping*** (region→table, alive→`+g`/dead→`−g`, pitch = `sampleRate/len`) and
  the planned race/audio-clock modes from `audio-synthesis.md` §2 — all platform-agnostic.

**NOT portable — must be rebuilt per platform:**

- **Canvas rendering** (`@thi.ng/pixel` → `putImageData`) — replace with each platform's drawing API.
- **DOM / `@thi.ng/rdom` UI + `@thi.ng/atom`/`rstream` reactive state layer** — no equivalent on
  either native target; each has its own parameter/GUI model.
- **AudioWorklet host glue** (`engine.ts`: `AudioContext`, Blob-URL worklet load, `postMessage`
  transferables, `DynamicsCompressor` limiter) — entirely browser-specific.

So the reusable "interesting part" is: **one integer kernel + one sample-loop DSP graph.** Everything
around it (rendering, UI, host, transport) is shell that is rewritten per target regardless. That is
the premise the "write the core once" thesis (§D) rests on.

A caveat already flagged in the code: `processor.js` today is a **pure wavetable player** — ADR 0005
retired the autonomous "sounding CA," so the CA does **not** currently run in the audio thread
(header comment, `processor.js:6-8`). The audio-clock-CA mode (`audio-synthesis.md` §2C) is *designed*
but not yet built. For a native port this is favourable: on both targets the natural design *is* the
CA running in the audio callback, which the browser build deferred.

---

## B. Max for Live via RNBO

### Export targets & toolchain

RNBO exports one patch to five targets, all via a **remote Cloud Compiler**: **Audio Plugin**
(`.vst3` / `.component` AU), **Max External**, **Raspberry Pi** (device), **Web Export** (JavaScript
+ WASM), and **C++ Source Code** (`rnbo_source.cpp`, "any platform with a C++11 compliant compiler")
([Export Targets Overview](https://rnbo.cycling74.com/learn/export-targets-overview)). For a Max for
Live device you don't use a separate target — you place a `rnbo~` object inside a Max audio-effect or
instrument patch and save it as an `.amxd`; RNBO *is* the Max-native path. The maintainer's RNBO
license already covers authoring and export ([Purchasing RNBO](https://support.cycling74.com/hc/en-us/articles/10542305345043-Purchasing-RNBO)).

### Custom per-sample DSP — feasible

RNBO expresses custom DSP in **`codebox~`** using **rnboscript**, "a JavaScript-like scripting
language … especially useful in situations involving complex logic, lots of math, or branching and
looping" ([Getting Started with Codebox](https://rnbo.cycling74.com/learn/getting-started-with-codebox)).
It supports `var`/`let`/`const`, `function`, and `if…else`, `for`, `while`
([codebox reference](https://rnbo.cycling74.com/codebox)). State that persists across sample calls
uses the **`@state`** decorator; tunable parameters use **`@param`** with min/max
([Understanding Storage](https://rnbo.cycling74.com/learn/understanding-storage-let-const-state-param)).

Mapping the existing worklet chain:

- DC blocker, `tanh` soft-clip, one-pole gain ramp, phasor read, Schroeder allpass — all trivial
  in `codebox~` (arithmetic + `@state` for the filter/delay memory). The allpass delay lines are the
  one thing better done with RNBO's native `delay`/`buffer~` than a raw `@state` ring, but either works.
- The **SVF-with-nonlinear-feedback / foldback** filters from `audio-libraries.md` are basic
  difference equations — directly expressible. (Alternatively `gen~` has these as objects.)
- The **read/write race mode** (`audio-synthesis.md` §2B) is two phasors on one buffer — RNBO's
  `poke`/`peek` do exactly this with configurable out-of-range wrap ([poke reference](https://rnbo.cycling74.com/objects/ref/poke)).

**Verdict: the DSP ports cleanly.**

### The CA kernel in RNBO — the crux

This is where feasibility is genuinely in question, and the answer is **yes, with real constraints.**

- **Array/grid storage:** rnboscript has a `list` object ("very similar to a JavaScript array",
  a subset of JS Array methods) and, more importantly for a fixed grid, **buffers**. `codebox~` can
  create sized/named/anonymous buffers and read/write with `peek`/`poke`; crucially "reading and
  writing in buffers does bound checking, so you cannot read or write out of bounds"
  ([codebox reference](https://rnbo.cycling74.com/codebox)). A 64×64 region = 4096 cells fits a
  buffer easily. The two grids (grid + double-buffer) = two `data`/`buffer~` objects.
- **`data` vs `buffer~`:** use **`data`** — it does not share memory with Max and supports
  `@external 0`, which "hides the buffer from the external world in the exported code," i.e. an
  internal scratch grid ([Using Buffers](https://rnbo.cycling74.com/learn/using-buffers)).
- **Arbitrary loops over the array:** `for`/`while` are supported, so the whole
  double-loop-over-rows/cols step is expressible. `@state` counters drive per-sample stepping
  (step every N samples → the audio-clock-CA mode).

**Constraints that shape (not block) the port:**

1. **Buffer-size expressions are limited** — "the only two supported operators in size expressions
   are `samplerate()` and `vectorsize()`," or you allocate a fixed named buffer (the docs' example
   is size 44100). A 4096-cell grid is a fine fixed size; a *runtime-resizable* region (the browser's
   32/64/128 switch) is awkward — you'd allocate max size and use a sub-range
   ([codebox reference](https://rnbo.cycling74.com/codebox)).
2. **"Large buffers can take time to allocate and may interrupt audio"** — allocate once, never
   per-step ([Using Buffers](https://rnbo.cycling74.com/learn/using-buffers)). The kernel already
   double-buffers with no per-step allocation, so this matches.
3. **Current limitation: you cannot pass a buffer/data to a rnboscript *function* as an argument**
   (compile error; ticket open) — the workaround is to select buffers by index inside the function
   ([RNBO forum: passing a buffer to a function](https://cycling74.com/forums/rnbo-codebox-passing-a-buffer-or-data-to-a-function)).
   Means the CA step is written as one inline `codebox~` body over globally-referenced grids rather
   than a tidy `step(gridA, gridB)` helper — an ergonomic tax, not a blocker.
4. **`let` resets every call; persistent counters need `@state`** — a known footgun, already
   documented ([Understanding Storage](https://rnbo.cycling74.com/learn/understanding-storage-let-const-state-param)).

Net: the integer CA **can** run inside `codebox~`. It's less pleasant than TypeScript (index-based
buffer juggling, size-expression limits) but nothing in the kernel is inexpressible.

### The parallel web path — strategically relevant, but rejected earlier

RNBO's Web Export emits JSON + WASM run by the **`@rnbo/js`** runtime (`createDevice({context,
patcher})`, each device becomes an AudioWorkletNode)
([Loading a RNBO Device in the Browser](https://rnbo.cycling74.com/learn/loading-a-rnbo-device-in-the-browser-js)).
In principle authoring the DSP once in RNBO could feed **both** the M4L device and a web build.
**But this collides head-on with two settled constraints of *this* project:**

- **The single-file `file://` build is incompatible with RNBO web export.** Cycling '74 states
  plainly: "if you just double-click a `.html` file … your RNBO device will fail to load. For
  security reasons, the browser will not enable WebAssembly or AudioWorklets for any page loaded with
  a `file://` URL" ([Loading a RNBO Device in the Browser](https://rnbo.cycling74.com/learn/loading-a-rnbo-device-in-the-browser-js)).
  The project's *entire* web audio design (`audio-synthesis.md` §4) exists specifically to run from
  `file://` and header-less GitHub Pages via Blob-URL worklets and non-SAB transferables. RNBO web
  export cannot meet that bar.
- **Licensing/cloud-compiler friction** was already the stated reason `audio-libraries.md` rejected
  RNBO for the web app. Exported code falls under the *Cycling '74 License for Max-Generated Code*:
  free for non-commercial/educational/creative use, with an automatic commercial grant only under
  $200k revenue/funding ([RNBO Export Licensing FAQ](https://support.cycling74.com/hc/en-us/articles/10730637742483-RNBO-Export-Licensing-FAQ)).
  Every export round-trips through the **Cloud Compiler** ([Export Targets Overview](https://rnbo.cycling74.com/learn/export-targets-overview)).
  (The RNBO *Engine* itself is MIT — but the generated-code terms are what bind a shipped artifact.)

So the "author once, ship to M4L + web" story is **real for a *served* web app but dead for this
repo's single-file constraint.** Treat RNBO as the *M4L path*, not a web-unification path. The
existing hand-written worklet stays the web engine.

### Alternative: hand-written Max external / `gen~`

A C external against the **Max SDK** ([github.com/Cycling74/max-sdk](https://github.com/Cycling74/max-sdk),
permissively licensed) gives total control and could share the C core (§D), but you write all the
Max object plumbing (inlets/outlets, attributes, `perform` routine, buffer access) by hand — clearly
more effort than `codebox~` for the same result, and it isn't a M4L-native artifact without extra
packaging. `gen~` is a middle path (visual DSP + a codebox) but has the same array-handling story as
RNBO codebox with less scripting ergonomics. **RNBO is the lowest-effort Max/M4L route.**

### M4L verdict

**Feasible, moderate effort.** DSP ports cleanly; the CA kernel ports with buffer-index awkwardness
and a resize constraint. The maintainer already owns the license and the CA-in-audio-thread design
is a better fit here than in the browser. The web-unification dream is blocked by the single-file
constraint — decouple it from the decision.

---

## C. VCV Rack module

### Language, SDK, license

Rack modules are **C++11** built against the **Rack SDK**: set `RACK_DIR`, build with `make`;
`helper.py` scaffolds a plugin and generates module boilerplate from an SVG panel
([Plugin Development Tutorial](https://vcvrack.com/manual/PluginDevelopmentTutorial)). Licensing:
GPLv3+ is **recommended, not mandatory** — Rack itself is GPLv3, and VCV offers a **Non-Commercial
Plugin License Exception** ("license your plugin under any terms of your choice, as long as it is
offered free of charge", incl. closed-source freeware) and **commercial royalty licensing** on
request. Hard rule: "if you copy significant portions of Rack's code into your own plugin, you must
license it under GPLv3." All VCV Library submissions must follow the **Plugin Ethics Guidelines**
([Plugin Licensing](https://vcvrack.com/manual/PluginLicensing)).

### DSP model — maps almost 1:1 to the worklet

A module implements `process(const ProcessArgs& args)`, "called every audio frame (e.g. 44,100 times
per second)", with `args.sampleTime`; I/O via `inputs[...].getVoltage()`,
`outputs[...].setVoltage(v)`, `params[...].getValue()`, audio at ±5 V
([Plugin Development Tutorial](https://vcvrack.com/manual/PluginDevelopmentTutorial)). This is the
**same per-sample model** as the AudioWorklet's `process()` inner loop — the sonification DSP
(`processor.js`) transcribes directly, one worklet sample-iteration = one `process()` call. The only
adjustment is scaling `±CELL_AMP` output to the ±5 V convention.

### CA kernel in C++ — trivial

`src/ca.ts` is already flat typed arrays and integer math; porting `Uint8Array`→`uint8_t[]`,
`Int32Array`→`int32_t[]` is mechanical. No framework, no allocation in the hot path, no language gap.
This is the **lowest-friction kernel port of the three targets** — C++ is the kernel's natural home.

### Visual grid — native custom widget

The grid renders in a custom `Widget`/`ModuleWidget` by overriding `draw(const DrawArgs& args)` and
drawing to `args.vg` (a **NanoVG** `NVGcontext*`); expensive renders can be cached in a
`FramebufferWidget`, and glowing/over-panel elements use `drawLayer()`
([Widget](https://vcvrack.com/docs-v2/structrack_1_1widget_1_1Widget) ·
[ModuleWidget](https://vcvrack.com/docs-v2/structrack_1_1app_1_1ModuleWidget) ·
[FramebufferWidget](https://vcvrack.com/docs-v2/structrack_1_1widget_1_1FramebufferWidget)). NanoVG
gives filled rects per cell — straightforward for a 64×64 grid, and `FramebufferWidget` caching
handles the redraw cost.

### CV/gate integration — the platform-native angle

This is where VCV *diverges* from the browser and becomes interesting on its own terms (design space,
not spec): CA **births → gate/trigger outputs**, **live-density → CV out**, **edge-density → a second
CV**, region-scan **clock in** to advance generations, **CV in** to modulate the rule (`refDir`/
`survival`) or seed. None of this exists in the browser instrument — it's the VCV-specific interface,
and it's arguably a stronger fit for the binary-event Ikeda aesthetic (`audio-synthesis.md` §2D) than
the web UI is. Note only; out of scope to design here.

### Distribution

Via the **VCV Library** (free, must meet Ethics Guidelines; GPLv3+ or the non-commercial exception),
or commercially through VCV's royalty licensing / own channel
([Plugin Licensing](https://vcvrack.com/manual/PluginLicensing)).

### VCV verdict

**Most feasible on the DSP/kernel axis, highest shell-rebuild cost.** The kernel and per-sample DSP
port with the least impedance of any target; the cost is writing a C++ plugin from scratch (build
setup, widget drawing, CV/gate I/O design) and learning the Rack SDK. No license the maintainer
already owns; GPLv3+ is the path of least resistance for Library distribution.

---

## D. Cross-cutting — "write the core once"

### Can the CA kernel + DSP be authored once and wrapped three ways?

**Partially — and the honest verdict is: share a C/C++ core between the two *native* targets, but not
with the web build.**

| Target | Core language | Can consume a portable C/C++ core? |
| --- | --- | --- |
| Web (done) | TS in an AudioWorklet, `file://` single-file | Only via hand-built WASM (Emscripten) — but that breaks the `file://`/no-SAB/single-file design, the same wall RNBO web export hits. In practice the **TS core stays the web core.** |
| M4L / RNBO | rnboscript (`codebox~`) → codegen'd **C++11** | RNBO authors in codebox, not arbitrary C++. You *could* export RNBO's C++ and hand-edit, but that fights the tool. Realistically the kernel is **re-expressed in codebox**, not shared as C. |
| VCV Rack | **C++11** | **Yes, directly** — a plain `ca.hpp`/`dsp.hpp` compiles straight in. |

So there is **no single language all three share.** Three genuine authorings of the kernel exist:
TypeScript (web, done), rnboscript (RNBO), C++ (VCV). The DSP graph is the same story. This sounds
worse than it is, because **the kernel is ~80 lines of arithmetic and the DSP chain ~50** — the cost
of re-expressing them is low, and each re-expression is a near-mechanical transliteration of the
same well-specified logic (the `.ts` is effectively the reference implementation, exactly as it is
already the bit-exact reference for the original `.pde`).

**Opinionated conclusion:** don't chase a single shared binary core. Chase a shared **specification**
— the TS kernel is already that reference. Where a *binary* core genuinely pays off is **C++ shared
between a hand-written Max external and the VCV module** (both are C++, both could `#include` the same
`ca.hpp`). But that trades RNBO's ergonomics for hand-written Max plumbing, so it only makes sense if
you commit to VCV *and* reject RNBO for M4L. Given the maintainer owns RNBO, the pragmatic split is:
**TS core for web · codebox for M4L · C++ core for VCV (reusable if a C Max external is ever wanted).**

### Effort ranking (lowest-effort next step first)

1. **M4L via RNBO** — *lowest effort, given the owned license.* No new toolchain to buy or learn from
   zero (maintainer has Max/RNBO), DSP ports cleanly, CA fits in `codebox~` with known workarounds.
   The friction is codebox array ergonomics, not feasibility.
2. **VCV Rack** — *low kernel effort, higher total.* The kernel/DSP port is the easiest of all, but
   you build a C++ plugin, the Rack SDK toolchain, NanoVG grid drawing, and a CV/gate interface from
   scratch. More total new surface than RNBO, but every piece is well-documented and unblocked.
3. **Web** — already done; the single-file worklet is the reference the other two transliterate from.

### What to prototype first to de-risk

**The single highest-uncertainty claim is "the integer CA can step meaningfully inside RNBO
`codebox~`."** Everything else (DSP in codebox, DSP in VCV, kernel in C++, NanoVG grid) is
low-risk and well-trodden. So the de-risking prototype is a **minimal `codebox~` patch that holds a
64×64 grid in two `data` buffers, runs one CA generation per trigger (or every N samples), and reads
the result out** — proving: (a) buffer read/write bound-checking doesn't fight the neighbour-index
math, (b) the buffer-can't-be-a-function-arg limitation is livable as one inline body, and (c) the
step is cheap enough at audio rate. If that steps correctly, the M4L port is essentially assured and
the DSP is the easy part. Do this before committing to either native target.

---

## Sources

- RNBO Export Targets Overview (Audio Plugin, Max External, Raspberry Pi, Web, C++; Cloud Compiler) — https://rnbo.cycling74.com/learn/export-targets-overview
- RNBO C++ Source Code target (C++11) — https://rnbo.cycling74.com/learn/the-cpp-source-code-target-overview
- RNBO Web Export target — https://rnbo.cycling74.com/learn/exporting-to-the-web-export-target
- Getting Started with Codebox (rnboscript, branching/looping) — https://rnbo.cycling74.com/learn/getting-started-with-codebox
- Codebox & Codebox~ Reference (control flow, `list`, buffers, size-expr limits, bound checking) — https://rnbo.cycling74.com/codebox
- Understanding Storage in Codebox (`let`/`const`/`@state`/`@param`, counter footgun) — https://rnbo.cycling74.com/learn/understanding-storage-let-const-state-param
- Using Buffers (`buffer~` vs `data`, `@external 0`, large-buffer allocation warning) — https://rnbo.cycling74.com/learn/using-buffers
- `poke` reference (out-of-range wrap/fold/clip modes) — https://rnbo.cycling74.com/objects/ref/poke
- RNBO forum: passing a buffer/data to a codebox~ function (current limitation + index workaround) — https://cycling74.com/forums/rnbo-codebox-passing-a-buffer-or-data-to-a-function
- Loading a RNBO Device in the Browser (`@rnbo/js` `createDevice`, WASM+AudioWorklet, `file://` fails) — https://rnbo.cycling74.com/learn/loading-a-rnbo-device-in-the-browser-js
- RNBO Export Licensing FAQ (Cycling '74 License for Max-Generated Code; <$200k commercial grant) — https://support.cycling74.com/hc/en-us/articles/10730637742483-RNBO-Export-Licensing-FAQ
- Purchasing RNBO (add-on to Max, license required to save) — https://support.cycling74.com/hc/en-us/articles/10542305345043-Purchasing-RNBO
- Max SDK (C externals, permissive license) — https://github.com/Cycling74/max-sdk
- VCV Rack Plugin Development Tutorial (C++11, Rack SDK, `helper.py`, `process(ProcessArgs&)`, ±5V) — https://vcvrack.com/manual/PluginDevelopmentTutorial
- VCV Rack Plugin Licensing (GPLv3+ recommended, non-commercial exception, commercial royalty, Ethics) — https://vcvrack.com/manual/PluginLicensing
- VCV Rack API — `Widget::draw(const DrawArgs&)` / NanoVG `NVGcontext* vg` — https://vcvrack.com/docs-v2/structrack_1_1widget_1_1Widget
- VCV Rack API — `ModuleWidget` — https://vcvrack.com/docs-v2/structrack_1_1app_1_1ModuleWidget
- VCV Rack API — `FramebufferWidget` (render caching) — https://vcvrack.com/docs-v2/structrack_1_1widget_1_1FramebufferWidget
</content>
</invoke>
