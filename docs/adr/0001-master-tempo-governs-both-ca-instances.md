# A single master tempo governs both CA instances

The audio extension runs two CA instances — the **visual CA** (draw-rate bounded, rAF) and the **sounding CA** (audio-clock, in the worklet). Rather than clocking them independently, both derive their step rate from one master **tempo grid**: a shared BPM plus a **per-CA subdivision**. The sounding CA steps at a fine subdivision (down to audio-rate — small `N`); the visual CA's step accumulator is quantized to the same grid at a coarser subdivision, so the image advances on the beat. This visual beat-locking is in from the start (live mode's morph lands on the beat), not deferred.

We chose this over independent clocks (visual on rAF, sounding on the audio clock, congruent only at capture — the original brainstorming plan's §4) because a shared tempo is what makes the two-instance split intentional rather than two unsynced processes, and it delivers the audio-visual coupling the reference tools (tonemata et al.) treat as the core concept. The visual CA cannot run audio-fast — it stays draw-rate bounded — but quantizing its steps to the grid is free and buys eye/ear coherence without requiring sample-level congruence.

This replaces the plan's §5 "Rate" knob (a raw ±3-octave playback multiplier) with a musical BPM + subdivision control; the worklet's "samples per generation" is a derived value (`N = sampleRate × 60 / (BPM × subdivision)`), not a user-facing one.

Consequences:

- The existing `speed` slider (0.1–8 gen/frame, with 0.1 as slow-motion) is **replaced** by the tempo grid. The RAF-loop accumulator advances on tempo-grid ticks, not raw `speed`.
- The **visual subdivision must range down to very slow** — multiple bars per generation — to preserve the old 0.1 slow-motion feel, while the **sounding subdivision must range up to audio-rate** for small `N`. One BPM, two wide-range subdivisions.
