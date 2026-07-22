# Paused is a frozen drone; the autonomous sounding CA is cut

Supersedes the autonomous half of ADR 0003 and amends ADR 0002. During the POC
build the intent for Pause was corrected: pausing should hold a **static drone
of the current buffer**, not detach a second CA that keeps evolving at audio
rate. The worklet therefore holds **no CA** — it is a pure **wavetable player**
that loops whatever Region table the main thread last handed it.

- **Running = live mirror** (unchanged). The Visual CA drives; the RAF loop
  mirrors the Region into the worklet every generation, so the loop morphs. The
  audible morph rate is the Visual subdivision × BPM (ADR 0001).
- **Paused = frozen drone.** No updates arrive, so the last table just loops.
  The picture holds still and the sound is a steady drone of that frame.
- **Step (`n`, paused) = re-seed the drone.** Each Step advances the frozen
  Visual frame and pushes it once, so the drone jumps to the new frame.

Why this over ADR 0003's "Paused = autonomous audio-clock CA":

- The autonomous CA introduced the **sounding subdivision** knob, whose effect
  was unreachable while running (ADR 0003 made live and autonomous mutually
  exclusive) — a headline control you could only hear after pausing, which read
  as broken.
- The keeper rules settle into quasi-static weaves (research §3), so an
  autonomous CA mostly converges to a **standing tone** anyway — the same drone,
  reached through much more machinery.
- A drone of the current buffer is what the instrument metaphor actually wanted:
  freeze the image, hold its sound.

Consequences:

- The **sounding subdivision** field, slider, and the `N = sampleRate·60 /
  (bpm·subdivision)` derivation are removed. The Visual subdivision remains and
  now doubles as the live morph rate.
- The worklet no longer steps a CA, so the copied **pixel-free CA core**
  (handoff Risk 2) is moot — deleted from `processor.js`. The worklet is
  `processor.js` = table + read phasor + DC-block → soft-clip → gain.
- The main→worklet **message protocol shrinks to `seed` + `volume`** (no rule,
  tempo, `N`, or mode). Rule/seed/region/age still shape the sound — but only
  through the frames the Visual CA produces (CONTEXT "no separate audio pool").
- **Lost:** the small-`N` "the rule becomes the oscillator" aliasing character
  (ADR 0002). If wanted later it returns as the parked **L2 mode** (worklet
  self-steps *while* the visual runs, periodically re-synced) — a new decision,
  not a revival of the Pause binding.

Retained from ADR 0002: the raster-scan wavetable and **Region size = pitch**
(table length = Region cell count) and the DSP chain. Retained from ADR
0001/0004: master BPM + Visual subdivision drive the Visual CA (hence the live
morph), and the whole tempo/audio grid stays out of `DEFAULTS` (Reset-immune).
