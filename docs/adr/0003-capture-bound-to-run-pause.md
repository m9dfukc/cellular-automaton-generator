# Grid capture is bound to Run/Pause, not a dedicated control

The live↔one-shot distinction (ADR context: who drives the Sounding grid) is bound to the existing **Run/Pause** state rather than a new toggle, and the Capture gesture is bound to **Pause** rather than a new button:

- **Running = live mirror.** The Visual CA drives; the worklet mirrors the Region every generation. Sound morphs at draw rate, fully congruent — you hear exactly what you see.
- **Paused = autonomous.** Pause *is* the Capture: the Sounding CA detaches and evolves **freely at audio rate**, seeded from the frozen frame. The picture holds still while the sound keeps living. This is the audio-clock CA (the POC's core, ADR 0002) — it runs precisely in the paused state.
- **Step (`n`, paused only) = re-seed.** Each Step advances the frozen Visual frame *and* re-seeds the worklet from it — you scrub the seed by hand.

Rule (`refDir`/`survival`) and the master tempo (ADR 0001) are always live: the sounding voice reflects the current rule and tempo without a re-capture. So "Randomize" (`r`) is audible.

Why this over a dedicated live/one-shot toggle + separate Capture button: it collapses three controls into two that already exist, with a legible metaphor (moving-together vs. still-image-living-sound). It preserves the audio-clock CA (binding the modes to a naive "pause = frozen drone" reading would have deleted it).

Accepted costs:
- Congruence and autonomy become **mutually exclusive** — you cannot watch the Visual CA run while the sound diverges autonomously. Minor expressive loss for a clarity gain.
- Run/Pause is **overloaded** when audio is on: pausing now also detaches the sounding voice. Acceptable because the metaphor (freeze the image, the sound lives on) is intuitive and audio-off behaviour is unchanged.

If an "L2" hybrid (visual running *and* worklet stepping autonomously, periodically re-synced) later proves musically interesting, it is a separate third mode, not an overload of this binding.
