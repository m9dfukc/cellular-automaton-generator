# CA · experiment 10 — audio-synthesis POC

> **Experimental proof of concept, not a finished feature.** This is the
> `poc-audio-synthesis` branch: the [web port of the CA sketch](https://github.com/m9dfukc/cellular-automaton-generator/blob/main/README.md)
> with an added audio engine that *sonifies the automaton*. Expect sharp edges,
> loud transients, and design decisions still in flux.
>
> For the **regular app** — the plain cellular automaton with rule controls,
> drawing, PNG export, and the full backstory — see the
> **[main branch README](https://github.com/m9dfukc/cellular-automaton-generator/blob/main/README.md)**.

**[🔊 Run the Audio POC live](https://m9dfukc.github.io/cellular-automaton-generator/poc/)** — press `a` for sound, size the region to set pitch. **Turn your speakers down first.**

**[▶︎ Regular app (main)](https://m9dfukc.github.io/cellular-automaton-generator/)** — the base automaton without audio.

<img src="docs/assets/application.webp" width="820"
     alt="The applet running in the browser: a dark instrument HUD on the left, a blue/black/white cellular-automaton pattern filling the canvas on the right" />

## What the POC does

The POC sonifies the automaton: a rectangular **region** of the grid is
raster-scanned into a wavetable (alive → +, dead → −) that a read phasor loops,
so **you literally hear the pattern as a waveform**. Region size sets the pitch;
the CA's evolution morphs the timbre. Two coupled instances share one master
tempo, so the image advances on the beat.

Everything about the underlying automaton — the modified Game of Life rule, the
bit-exact typed-array kernel, the mixed clamp/wrap edge behaviour — is unchanged
from the base app. Only the instrument layer and the control panel differ here.

## Run

```bash
yarn install
yarn dev          # http://localhost:5173

yarn build        # normal chunked dist/
yarn build:single # one self-contained dist/index.html (no external requests)
yarn test         # verifies the engine is bit-exact vs the original sketch
```

## Audio quick start

1. Press **`a`** (or the **Audio** button) to start sound — a browser gesture is
   required to open the audio context, so it only starts on that keypress/click.
2. Use the **Region size (pitch)** presets (16 / 32 / 64 / 128) to pick a pitch;
   smaller region = shorter wavetable = higher note. The region defaults to
   **32**.
3. **Run** (`space`) to hear the sound morph as the CA evolves; **pause** to
   freeze it into a steady drone of the current frame.

## Controls

The panel is slimmed down relative to the main app — this is an instrument, not
the full editor.

| Control                | What it does                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Run / pause            | `space` or the Run button                                                              |
| Step one frame         | `n` or Step ▶ — advance a single generation (only while paused)                        |
| Randomize rule         | `r` or Randomize — random rule, keeps the current buffer so it keeps evolving          |
| Reset                  | `x` or Reset — restore the original rule + defaults, then reseed                       |
| Seed                   | `s` or Seed — lay down the first-frame seed pattern, keeping the current rule          |
| Clear stage            | `c` or Clear — empty the grid completely                                               |
| Erase cells            | drag (or click) on the canvas — **erase is the only draw mode** in the POC             |
| Pencil size            | slider, 1–48 cells (square brush, strokes interpolated)                                |
| Seed spacing           | slider, 2–300 (`distProbability`)                                                      |
| Auto re-seed threshold | slider, 0.50–1.00 — noise level at which patches re-seed; **1.00 = off** (the default) |

### Audio controls

| Control             | What it does                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `a` / Audio button  | Toggle sound on/off (starts/stops the audio context)                                           |
| Volume              | Output level, in dB                                                                            |
| Tempo (BPM)         | Master tempo — drives how fast the CA steps                                                    |
| Visual subdivision  | Steps per beat = the live **morph rate** of the timbre                                         |
| Region size (pitch) | Preset squares 16–128 cells; **Alt-drag** moves the region, **Shift-drag** boxes it to any W×H |
| Width / Diffusion   | Stereo width and allpass decorrelation of the two channels                                     |
| Wave strip          | Live view of the current wavetable / output waveform                                           |

The **rule** readout shows the active algorithm as `<reference-direction arrow> <survival-threshold>` (e.g. `↖ 6`, the original). Randomize draws from a curated pool of 8 rules and never repeats the current rule; Reset returns to `↖ 6`.

### Differences from the main app's menu

- **No Download PNG button** — still-image export lives in the main app.
- **Erase is the default (and only) draw mode** — the Draw/Erase toggle is gone;
  dragging the canvas erases cells.
- **Horizontal seeding** (`stripesB`) is hidden — the code and its reaction are
  intact (the GUI toggle is just commented out), it simply has no button here.
- **Auto re-seed** is a single slider instead of a toggle + slider. The old
  on/off checkbox is gone; the threshold *is* the switch — **1.00 = off** (the
  entropy ceiling is 1, so nothing ever qualifies and the scan is skipped) and
  lowering it re-seeds progressively noisier patches. Default is 1.00.

## How run / pause / step behave with audio on

- **Running = live mirror.** The visual CA drives and the region is mirrored into
  the audio engine every generation, so the sound morphs at the tempo grid's rate.
- **Paused = frozen drone.** No new frames arrive, so the last wavetable just
  loops — a steady drone of the frozen picture.
- **Step (`n`, while paused) = re-seed the drone.** Each step advances the frozen
  frame once and pushes it, so the drone jumps to the new frame — scrub it by hand.

Rule (`r` randomize) and tempo are always live, so they are audible without a
re-capture. Design rationale for all of this lives in `docs/adr/0001`–`0005`.

## Auto re-seed (experimental)

Left alone, some rules eventually chew their weave into featureless pixel noise.
The **Auto re-seed threshold** fights that: every 30 generations the grid is
split into 75×75-cell patches and each is scored by the Shannon entropy of its
2×2 block patterns, normalised to 0..1 (1 = all 16 patterns equally likely).
Lattices reuse a handful of patterns and score low; noise approaches 1. Patches
at or above the threshold get re-seeded in place, so the pattern regenerates
locally instead of decaying. At the default of **1.00 the scan is off**; drop the
slider to arm it. The `entropy` readout shows the highest patch score from the
last scan — useful for finding a threshold by eye, though it only moves while the
scan is armed (threshold < 1).

## Layout

```
src/
  ca.ts        typed-array engine (kernel, double buffer, framebuffer)  ← the fast core
  entropy.ts   patch entropy scan — noise detection behind auto re-seed
  state.ts     reactive atom + readout streams
  app.ts       loop, gestures, keyboard, reactions, declarative rdom UI
  audio/
    engine.ts    audio-context host, worklet wiring, seed/param plumbing
    processor.js AudioWorklet: wavetable read phasor + stereo diffuser
  main.ts      entry
  style.css    instrument HUD
test/
  verify.ts    bit-exact correctness check vs the original sketch
  bench.ts     kernel benchmark
```

For the base architecture, performance notes, thi.ng package list, and the
original-sketch mapping, see the
**[main branch README](https://github.com/m9dfukc/cellular-automaton-generator/blob/main/README.md)**.

## License

Both the source code and the images are released under
**[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**
(Attribution — NonCommercial — ShareAlike): use, remix, and share them — credit the
source, don't sell them, and keep derivatives under the same terms.
