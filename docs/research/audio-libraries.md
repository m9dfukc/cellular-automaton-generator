# Audio Libraries for the Web Audio Synthesis Extension

> Research doc · 2026-07-23 · primary-source survey
> Companion to [`audio-synthesis.md`](./audio-synthesis.md) (the aesthetic + architecture brainstorm) and the `poc-audio-synthesis` branch (`src/audio/engine.ts`, `src/audio/processor.js` — an existing Blob-loaded AudioWorklet wavetable player).

## Question

Which JS/TS (reluctantly WASM) audio libraries are worth adopting for a glitch/noise Web Audio engine (Ikeda / Raster-Noton aesthetic), covering: high-quality **reverb**, a highly-resonant **saturating filter** (Dietrich Pank "Aliasing Synth" spirit), **distortion/waveshaping**, what **`@thi.ng/umbrella`** already offers, and **antialiasing/oversampling**? And the meta-question: **build it ourselves as small worklet DSP, or pull in a library?**

## Hard constraints (these gate viability — every candidate is judged against them)

1. **Single-file build** (`build:single`) inlines everything into one HTML that must run from `file://` and GitHub Pages with **no custom headers**. Worklet modules are loaded via Blob/`data:` URL (already done in `engine.ts`), not a separate file URL.
2. **No `SharedArrayBuffer`** — no cross-origin isolation (COOP/COEP) available. Any lib requiring SAB is out.
3. **Bundle size matters** — WASM libs are suspected "too much bloat." Report real sizes.
4. **Already on `@thi.ng/umbrella`** (Apache-2.0, ESM, tree-shakeable). Prefer typed, tree-shakeable ESM.
5. **DSP must run *inside* an AudioWorklet** (audio thread, sample-by-sample), not merely as a graph of native nodes. A lib that only wires up `BiquadFilterNode`/`ConvolverNode` on the main-thread graph is **less** useful than one whose primitives run per-sample in a worklet.

A structural note that colours everything below: the existing worklet (`processor.js`) is **plain JS loaded verbatim via Vite `?raw` + Blob URL**. Anything that is to run *inside* it must either (a) already be plain JS, or (b) be bundled into the processor source at build time. TS/ESM libraries (`@thi.ng/dsp`, Tone.js internals) are usable inside the worklet only via route (b) — an extra build step to inline a worklet-specific bundle. Native-node libraries and WASM-worklet libraries sidestep this but each has its own cost.

---

## 1. Reverb

Native `ConvolverNode` exists but needs an impulse response and runs on the **main-thread graph**, not in our worklet. The realistic options split into "algorithmic worklet DSP" vs. "native convolution."

| Option | Type | Runs where | Notes |
| --- | --- | --- | --- |
| **Tone.js `Reverb`** | Convolution | Native graph (`ConvolverNode`) | Renders a decaying-noise IR in an `OfflineAudioContext`, sets it as `ConvolverNode.buffer`. Confirmed in source: `this._convolver = this.context.createConvolver()` and the offline noise→gain-envelope render. **Not worklet DSP.** [src](https://github.com/Tonejs/Tone.js/blob/dev/Tone/effect/Reverb.ts) |
| **Tone.js `Freeverb` / `JCReverb`** | Schroeder comb/allpass | AudioWorklet (recent Tone) | Tone's own docs warn Freeverb "is now implemented with an AudioWorkletNode which may result in performance degradation on some platforms; consider Reverb instead." Worklet DSP, but you inherit Tone's whole module graph. [src](https://tonejs.github.io/docs/14.7.77/Freeverb) |
| **khoin/DattorroReverbNode** | Dattorro plate/tank | **AudioWorklet, pure JS** | Standalone `AudioWorkletProcessor` implementing Dattorro's figure-eight topology, cubic-interpolated, samplerate-independent, `decayRate` param. **License: Unlicense (public domain).** No WASM, no deps. [repo](https://github.com/khoin/DattorroReverbNode) · [license](https://github.com/khoin/DattorroReverbNode/blob/master/LICENSE) |
| **@ondas/dattorro-reverb** | Dattorro (TS wrapper) | AudioWorklet | npm TS wrapper around khoin's DSP; `reverb.getParam("decay").setValue(...)`. [npm](https://www.npmjs.com/package/@ondas/dattorro-reverb) |
| **khoin/progenitorReverb** | Dattorro "Progenitor" | AudioWorklet | More advanced variant; knobs match Dattorro's optimization paper; can blow up (has a "Panic!" reset). [repo](https://github.com/khoin/progenitorReverb) |
| **mmckegg/freeverb** | Schroeder Freeverb | Native graph | Extracted from Tone.js; plain-JS node graph, main-thread, not a worklet. [repo](https://github.com/mmckegg/freeverb) |
| **Faust `reverbs.lib`** (via faustwasm) | Every algorithm | AudioWorklet (WASM) | See §"Faust" below — `mono/stereo_freeverb`, `zita_rev1`, `dattorro_rev`, `jpverb`, `greyhole`, `fdnrev0`, `jcrev`, `satrev`, `springreverb`, `vital_rev`. [reverbs.lib](https://faustlibraries.grame.fr/libs/reverbs/) |

**Verdict for reverb:** the single best *drop-in worklet reverb with zero WASM and public-domain licensing* is **khoin's Dattorro node** (or its TS wrapper). It gives the "plate/tank" character that suits glitch material, is a standalone processor (fits the Blob-worklet loading model already in `engine.ts`), and adds no bundle weight beyond a few KB of JS. If a *variety* of high-quality reverbs (zita FDN, greyhole, spring) is wanted, that is Faust's territory.

---

## 2. Filters — the resonant, saturating "SaturationFilter"

The maintainer wants a high-resonance filter driven into saturation/self-oscillation (Aliasing-Synth spirit). Native `BiquadFilterNode` is disqualifying here: it has a `Q` but **no nonlinearity**, cannot self-oscillate into saturation, and runs on the native graph, not in the worklet.

| Source | Filter primitives | Saturation built-in? | Worklet DSP? |
| --- | --- | --- | --- |
| **`@thi.ng/dsp`** | `svfLP/HP/BP/Notch/Peak/Allpass` (state-variable, resonant Q), `biquad*`, `onepoleLP`, `allpass`, `dcBlock` | No (filter and shaper are separate blocks — you wire `waveShaper`/`foldback` into the feedback path yourself) | Yes, if bundled into the worklet (composable per-sample `IGen`/`IProc`). [dsp README](https://github.com/thi-ng/umbrella/blob/develop/packages/dsp/README.md) |
| **Faust `filters.lib`** | `svf` (LP/BP/HP/notch/peak/AP/bell/shelf), `svf_morph`, `SVFTPT`, `resonlp/hp/bp`, `tf2` | No (pair with a shaper) | Yes (WASM worklet). [filters.lib](https://faustlibraries.grame.fr/libs/filters/) |
| **Faust `vaeffects.lib`** | `moog_vcf`, `moog_vcf_2b(t)`, `moogLadder` (Q≈25), `diodeLadder` (Q≈20), `korg35LPF/HPF`, `sallenKey2ndOrder`, **`oberheim`** | **`oberheim` = SVF *with built-in soft-clipping* (`cubicnl`)** — a resonant filter that self-oscillates *and* saturates, out of the box. `moog_vcf`/ladders self-oscillate at high resonance. | Yes (WASM worklet). [vaeffects.lib](https://faustlibraries.grame.fr/libs/vaeffects/) |
| Native `BiquadFilterNode` | LP/HP/BP/notch/peak/shelf, `Q`, `detune` | No | No (native graph only) |

**Key finding:** Faust's **`oberheim`** filter is *precisely* the "resonant filter driven into saturation" the maintainer describes — a state-variable topology with an integral soft-clip nonlinearity — and `moog_vcf`/`moogLadder`/`diodeLadder`/`korg35` give the classic self-oscillating ladder characters. There is no equivalent *ready-made* saturating filter in the JS ecosystem; `@thi.ng/dsp` gives the *ingredients* (`svfLP` + `waveshapeTan`/`foldback` in the loop) but you assemble the nonlinear feedback yourself.

**Verdict for the SaturationFilter:** this is small, opinionated DSP with a *feel* the maintainer wants to dial in by ear. Two credible routes: (a) **hand-build** an SVF-with-nonlinear-feedback in the existing plain-JS worklet using `@thi.ng/dsp`'s `svfLP` + `foldback`/`waveshapeTan` as reference math (tightest control, zero new runtime deps, ~30 lines); or (b) **Faust `oberheim`/`moog_vcf`** AOT-compiled to a KB-scale wasm if you want a physically-modelled ladder without writing the difference equations. Given the Aliasing-Synth ethos ("the errors *are* the sound," fine hand-tuning of drift), route (a) is the better fit — see the recommendation.

---

## 3. Distortion / saturation / waveshaping

| Source | Provides | Worklet DSP? |
| --- | --- | --- |
| **`@thi.ng/dsp`** | `waveShaper` with `waveshapeTan`, `waveshapeSigmoid`, `waveshapeSin`; `foldback` (recursive amplitude folding) | Yes (bundle into worklet). [dsp README](https://github.com/thi-ng/umbrella/blob/develop/packages/dsp/README.md) |
| **existing `processor.js`** | already uses `Math.tanh()` soft-clip + one-pole DC blocker per sample | Yes (it *is* the worklet) |
| **Native `WaveShaperNode`** | arbitrary transfer curve, `oversample: "none"/"2x"/"4x"` | No — native graph only; the `oversample` option antialiases the *native* node, not worklet DSP. [MDN WaveShaperNode](https://developer.mozilla.org/en-US/docs/Web/API/WaveShaperNode) |
| **Tone.js `Distortion`/`Chebyshev`/`BitCrusher`** | waveshaping distortion, Chebyshev, bitcrush (BitCrusher is worklet in recent Tone) | Mixed (some native, BitCrusher worklet) |
| **Faust libs** | `misceffects.lib` / `compressors.lib` shapers, `cubicnl`, foldback; wave-shaping throughout | Yes (WASM worklet) |

**Verdict for distortion:** trivially hand-built and *already present* in `processor.js` (`tanh`). `foldback` and bitcrush are each a handful of lines. **No library needed** — `@thi.ng/dsp`'s `waveshape*`/`foldback` are useful as *reference implementations* to copy, not as a runtime dependency inside the worklet.

---

## 4. `@thi.ng/umbrella` audio capabilities

This is the decisive finding, because thi.ng is **already a dependency** (Apache-2.0, ESM, tree-shakeable — the project ships `@thi.ng/atom`, `@thi.ng/pixel`, `@thi.ng/rdom`, `@thi.ng/rstream`, `@thi.ng/transducers`).

**`@thi.ng/dsp` exists and is substantial** — "composable signal generators, oscillators, filters, FFT, spectrum, windowing & related DSP utils," Apache-2.0, **7.68 KB brotli'd ESM**, tree-shakeable, transducers-compatible. [npm](https://www.npmjs.com/package/@thi.ng/dsp) · [README](https://github.com/thi-ng/umbrella/blob/develop/packages/dsp/README.md)

Design: two interfaces — **`IGen`** (infinite per-sample signal generators) and **`IProc`** (per-sample value processors). This is *exactly* the per-sample model an AudioWorklet needs.

Inventory (from the README):

- **Oscillators:** `sin`, `saw`, `tri`, `rect`, `parabolic`, `squareSin`, `sawAdditive`, `squareAdditive`, `additive`, `dsf`, `wavetable`, `osc`, `modOsc` (FM/AM), `sweep`, `sincos`.
- **Noise:** `whiteNoise`, `pinkNoise`.
- **Envelopes/mod:** `adsr`, `curve`, `line`, `impulse`, `impulseTrain`, `alt`.
- **Filters:** one-pole `onepoleLP`, `dcBlock`, `allpass`; biquad `biquadLP/HP/BP/Notch/Peak/LoShelf/HiShelf`; **state-variable `svfLP/HP/BP/Notch/Peak/Allpass`** (resonant).
- **Waveshaping/distortion:** `waveShaper` (`waveshapeTan/Sigmoid/Sin`), `foldback`.
- **Delay:** `delay` (multi-tap ringbuffer), `feedbackDelay`, `filterDelay` (feedback through an `IProc`).
- **FFT/analysis:** `fft`, `ifft`, `spectrumMag/Pow/Phase`, bin/freq helpers.
- **Windows:** Hann, Hamming, Blackman(-Harris/-Nuttal), Gauss, Bartlett, Welch, Lanczos, etc.
- **Composition:** `pipe`, `serial`, `mapG`, `addG`, `product`, `sum`, `mix`, `multiplex`.

**Companion:** **`@thi.ng/dsp-io-wav`** — `wavByteArray(...)` to emit WAV byte arrays (24/16-bit, mono/multi). Directly relevant to Phase 3's WAV-recording/export goal. [npm](https://www.npmjs.com/package/@thi.ng/dsp-io-wav)

There is **no** `@thi.ng/fft`, `@thi.ng/ramp` (ramp/tween lives elsewhere as `@thi.ng/ramp` for value ramping, not audio), oscillator, filter, or soundfont package — FFT and all filters live *inside* `@thi.ng/dsp`. The two audio packages are `dsp` and `dsp-io-wav`.

**Caveat (constraint 5):** `@thi.ng/dsp` is ESM/TS. To run its blocks *inside* the existing `?raw`-loaded plain-JS worklet you must **bundle a small worklet-specific module** (e.g. an esbuild step producing the processor source with `@thi.ng/dsp` inlined) rather than importing it at runtime. Because it's tree-shakeable and 7.68 KB total, pulling in only `svfLP`, `foldback`, `dcBlock`, `feedbackDelay` costs very little. Alternatively, treat the README's algorithms as reference math and transcribe the two or three you need — the current `processor.js` already hand-writes its DC blocker and allpass diffuser in exactly this style.

**Verdict for thi.ng:** it is the natural first-choice "library," because it's already a dependency, shares the project's license and ESM idioms, is tiny, and its `IGen`/`IProc` per-sample model matches the worklet. It does **not** ship a finished reverb algorithm (no comb/FDN preset) — only the building blocks (`allpass`, `feedbackDelay`, `filterDelay`) from which a Schroeder/FDN reverb is assembled.

---

## 5. Antialiasing / oversampling / sample-rate

Driving resonant filters and waveshapers into saturation generates aliasing. Native `WaveShaperNode.oversample` ("2x"/"4x") only antialiases the **native node**, not worklet DSP.

- **Inside a worklet you oversample by hand:** upsample the block (zero-stuff + polyphase/half-band FIR, or simple 2×/4× linear+filter), run the nonlinear stage, decimate. No JS library packages this as a turnkey worklet primitive; you write ~40 lines. `@thi.ng/dsp`'s `window*` + `fft` help design/analyse the anti-alias filter but don't provide a ready oversampler.
- **Band-limited oscillators:** no dedicated polyBLEP/BLIT/minBLEP package surfaced as a maintained primary source; `@thi.ng/dsp`'s `sawAdditive`/`squareAdditive`/`additive`/`dsf` are **additive (inherently band-limited)** oscillators — an alternative to BLEP for alias-free classic waveforms. [dsp README](https://github.com/thi-ng/umbrella/blob/develop/packages/dsp/README.md)
- **Faust** ships oversampled/anti-aliased building blocks and its VA filters are designed for it; a Faust-compiled saturating chain handles aliasing internally. [faustlibraries](https://faustlibraries.grame.fr/)
- **Sample-rate:** the aesthetic *wants* aliasing (the Aliasing-Synth race mode intentionally aliases). Oversampling is only needed for the parts you want *clean* (e.g. a sub-sine, a tonal filter sweep). Selective, not global.

**Verdict for antialiasing:** mostly hand-rolled and *deliberately partial* — this project *cultivates* aliasing as an aesthetic, so a blanket oversampling library would fight the concept. Use `@thi.ng/dsp`'s additive oscillators where you want clean tones; hand-write a 2× oversampler only around a nonlinear stage you specifically want tamed.

---

## Candidate matrix

| Library | Worklet-capable DSP | License | Size | TS | Maintained | Single-file-OK |
| --- | --- | --- | --- | --- | --- | --- |
| **`@thi.ng/dsp`** | Yes (per-sample `IGen`/`IProc`; bundle into worklet) | Apache-2.0 | **7.68 KB brotli** | Yes (native) | Yes (active umbrella, v4.7.x) | Yes (already a dep, pure ESM) |
| **`@thi.ng/dsp-io-wav`** | N/A (WAV encode, main thread) | Apache-2.0 | tiny | Yes | Yes | Yes |
| **khoin/DattorroReverbNode** | Yes (standalone JS processor) | **Unlicense (PD)** | few KB JS | No (plain JS) | Low activity, self-contained | Yes (Blob-worklet, no WASM) |
| **@ondas/dattorro-reverb** | Yes | ISC/MIT-ish (wraps PD) | few KB | Yes | Low | Yes |
| **Tone.js (Reverb)** | No — `ConvolverNode`, native graph | MIT | Large (tree-shakeable per class) | Yes | Yes (active) | Convolver yes; whole-lib heavy |
| **Tone.js (Freeverb/JCReverb/BitCrusher)** | Yes (worklet) | MIT | Large | Yes | Yes | Loads worklets via Blob — feasible but heavy |
| **Elementary Audio** (`@elemaudio/web-renderer`) | Yes (engine runs in worklet) | **MIT (v2+)** | ships a **WASM engine** (size not published; expect 100s KB) | Yes | Yes (active) | **Risky** — WASM engine + worklet under `file://`; unverified, likely needs bundler gymnastics |
| **Faust** (`@grame/faustwasm`, AOT) | Yes (WASM AudioWorklet) | Faust libs permissive; you own generated DSP | **Precompiled `dsp-module.wasm` = KB–low-tens-of-KB** (compiler multi-MB but *not shipped* with AOT) | Yes (typed) | Yes (active, GRAME) | Feasible with AOT `faust2wasm`; wasm must be inlined (base64) into single file |
| **RNBO** (Cycling '74) | Yes (WASM worklet) | **Dual C74/GPLv3 + revenue registration** | WASM (cloud-compiled) | Yes | Yes (commercial) | Possible but licensing + cloud-compiler friction |
| **genish.js** | Yes (compiles per-sample to worklet; **pure JS, no WASM**) | MIT | small JS | Not documented | Older / low activity | Yes (no WASM) |
| **mmckegg/freeverb** | No (native node graph) | MIT | small | No | Stale | Native only |
| **dsp.js (legacy)** | Class-based, main-thread oriented | MIT | small | No | Unmaintained | Not worklet-idiomatic |

Notes on the WASM candidates vs. constraint 3:
- **Faust's** feared "bloat" is a misconception for our use: the multi-MB `libfaust-wasm.wasm` is the *compiler*, which you only need at author time. `node scripts/faust2wasm.js effect.dsp out/` emits a standalone `dsp-module.wasm` (KB–tens-of-KB) + `index.js`; shipping that needs **only `index.js`, not the compiler**. [faustwasm](https://github.com/grame-cncm/faustwasm) So a Faust saturating-filter+reverb chain is a small wasm, base64-inlined into the single HTML. Real byte counts weren't published in primary docs — measure by running `faust2wasm` on the target `.dsp`.
- **Elementary** ships a general WASM engine you *drive* with a JS graph DSL; you don't write raw sample loops, and its size/`file://` behaviour isn't documented as single-file-friendly. Powerful, but a heavier commitment than this project needs.
- **RNBO's** license (dual C74-proprietary/GPLv3 + a >$200k-revenue *registration* clause) is a poor fit for an open, permissively-licensed single-file art tool, and it depends on a cloud compiler. [RNBO licensing FAQ](https://support.cycling74.com/hc/en-us/articles/10730637742483-RNBO-Export-Licensing-FAQ) · [RNBO web export](https://rnbo.cycling74.com/learn/exporting-to-the-web-export-target)

---

## Recommendation

**Build it yourself for the identity effects; pull in exactly two small, license-clean things for the rest.**

The Aliasing-Synth race mode, the resonant SaturationFilter, and the distortion/DC/clip chain are *the instrument's character*. They are (a) small, (b) tuned by ear, and (c) already partly written in `processor.js`. Handing them to a library trades the fine control the aesthetic demands (drift around 1.0, "the errors are the sound") for a black box. **Hand-build these in the existing plain-JS worklet.** Use `@thi.ng/dsp` as the *source of truth for the math* — its `svfLP` (resonant SVF), `foldback`, `waveshapeTan`, `feedbackDelay`, `allpass`, `dcBlock` are the reference implementations to transcribe or bundle.

Concretely:

1. **Adopt `@thi.ng/dsp` (Apache-2.0, 7.68 KB, already-in-ecosystem).** Either bundle the handful of needed blocks into a worklet-specific esbuild step, or transcribe them. It shares the project's license, ESM idioms, and per-sample `IGen`/`IProc` model — the lowest-friction "library" available. Also adopt **`@thi.ng/dsp-io-wav`** for the Phase-3 WAV export (matches the existing download-PNG pattern).

2. **SaturationFilter = hand-built SVF-with-nonlinear-feedback** in the worklet: `@thi.ng/dsp` `svfLP` for the resonant core, `foldback`/`tanh` in the feedback path for saturation and self-oscillation. ~30 lines, no new runtime dep, total control over the drift/resonance feel. (If a physically-modelled ladder is later wanted, Faust's `oberheim` — an SVF *with* built-in soft-clip — or `moog_vcf`/`diodeLadder` is the fallback, AOT-compiled to a KB wasm.)

3. **Reverb = the one thing worth taking off the shelf.** Algorithmic reverb (comb/allpass/FDN/plate tuning) is genuinely fiddly and *not* part of the instrument's identity. Drop in **khoin's Dattorro AudioWorklet** (Unlicense / public domain, pure JS, no WASM, self-contained processor that fits the existing Blob-worklet loading exactly) or its TS wrapper `@ondas/dattorro-reverb`. This gives a high-quality plate/tank reverb for a few KB and zero licensing entanglement. Only escalate to **Faust `reverbs.lib`** (zita FDN, greyhole, spring, jpverb) if you specifically want a *palette* of reverb algorithms — then AOT-compile the chosen `.dsp` with `faust2wasm` and inline the small wasm.

4. **Distortion / bitcrush / foldback: hand-built, already started.** `processor.js` has `tanh` + DC blocker today; `foldback` and bitcrush are a few lines each (copy `@thi.ng/dsp`'s `foldback`). No library.

5. **Antialiasing: selective and hand-rolled.** Aliasing is *wanted* in the race mode, so no blanket oversampler. Use `@thi.ng/dsp`'s additive oscillators (`sawAdditive`, `squareAdditive`, `dsf`) where you need a clean tonal voice; hand-write a 2× oversampler only around a nonlinear stage you deliberately want clean.

**Explicitly rejected:**
- **Tone.js** — its flagship `Reverb` is native `ConvolverNode` (main-thread, not worklet), and pulling the library in for a couple of worklet effects is disproportionate bundle weight for a single-file target. Fine as a reference for Freeverb/BitCrusher DSP, not as a dependency.
- **RNBO** — proprietary/GPLv3 dual license + revenue-registration clause + cloud compiler; wrong fit for an open permissive single-file tool.
- **Elementary Audio** — genuinely capable (MIT, worklet engine) but ships a general WASM engine and a graph-DSL you drive rather than raw sample loops; heavier than needed and unverified under `file://` single-file.
- **genish.js** — closest philosophical match (MIT, pure-JS, compiles per-sample to a worklet) but the project *already hand-writes* the per-sample worklet that genish would generate, and it's low-activity with undocumented TS. No reason to add it.

**One-line answer to the maintainer's build-vs-buy question:** hand-build the SaturationFilter, the Aliasing-Synth race mode, and the clip/fold/DC chain as small worklet DSP (using `@thi.ng/dsp` as math/reference and possibly as a bundled 7.68 KB dep); take **reverb** off the shelf via khoin's public-domain Dattorro worklet (or Faust AOT for a reverb *palette*); add `@thi.ng/dsp-io-wav` for WAV export. Faust is the escape hatch — not bloat when AOT-compiled — if a hand-built filter or reverb doesn't reach the quality bar.

---

## Sources

- `@thi.ng/dsp` — [npm](https://www.npmjs.com/package/@thi.ng/dsp) · [README (develop)](https://github.com/thi-ng/umbrella/blob/develop/packages/dsp/README.md)
- `@thi.ng/dsp-io-wav` — [npm](https://www.npmjs.com/package/@thi.ng/dsp-io-wav)
- thi.ng/umbrella packages listing — [github](https://github.com/thi-ng/umbrella/tree/develop/packages)
- Tone.js `Reverb` source (ConvolverNode + offline IR) — [Reverb.ts](https://github.com/Tonejs/Tone.js/blob/dev/Tone/effect/Reverb.ts)
- Tone.js `Freeverb` (now AudioWorkletNode) — [docs](https://tonejs.github.io/docs/14.7.77/Freeverb)
- khoin/DattorroReverbNode (AudioWorklet, Unlicense) — [repo](https://github.com/khoin/DattorroReverbNode) · [LICENSE](https://github.com/khoin/DattorroReverbNode/blob/master/LICENSE) · [demo](https://khoin.github.io/DattorroReverbNode/)
- khoin/progenitorReverb — [repo](https://khoin.github.io/progenitorReverb/)
- @ondas/dattorro-reverb (TS wrapper) — [npm](https://www.npmjs.com/package/@ondas/dattorro-reverb)
- mmckegg/freeverb — [repo](https://github.com/mmckegg/freeverb)
- Faust `reverbs.lib` — [docs](https://faustlibraries.grame.fr/libs/reverbs/)
- Faust `filters.lib` — [docs](https://faustlibraries.grame.fr/libs/filters/)
- Faust `vaeffects.lib` (moog_vcf, moogLadder, diodeLadder, korg35, oberheim=SVF+soft-clip) — [docs](https://faustlibraries.grame.fr/libs/vaeffects/)
- `@grame/faustwasm` (AOT `faust2wasm`, standalone dsp-module.wasm, AudioWorklet, TS) — [repo](https://github.com/grame-cncm/faustwasm) · [npm](https://www.npmjs.com/package/@grame/faustwasm)
- Elementary Audio (MIT v2+, web-renderer worklet engine) — [repo](https://github.com/elemaudio/elementary) · [open-source announcement](https://buttondown.com/elemaudio/archive/elementary-audio-now-open-source/) · [docs](https://www.elementary.audio/)
- RNBO web export + licensing — [web export target](https://rnbo.cycling74.com/learn/exporting-to-the-web-export-target) · [licensing FAQ](https://support.cycling74.com/hc/en-us/articles/10730637742483-RNBO-Export-Licensing-FAQ)
- genish.js — [repo](https://github.com/charlieroberts/genish.js)
- Native `WaveShaperNode` (`oversample`) — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WaveShaperNode)
