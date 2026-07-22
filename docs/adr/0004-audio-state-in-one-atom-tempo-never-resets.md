# Audio state lives in the one atom; the tempo grid never resets

All audio/tempo config lives in the existing single `db` atom (no separate audio atom — fragmenting state would break the established one-atom reactive pattern). High-frequency readouts (level meter, waveform-strip snapshots) stay *outside* the atom as rstream streams, exactly like `gen$`/`fps$`.

The Reset boundary splits the audio state:

- **In `DEFAULTS` (Reset restores):** nothing new. Reset stays "back to the original sketch" — rule, seed, entropy settings.
- **Out of `DEFAULTS` (Reset never touches), like `brush`/`tool`:** the entire **tempo grid** (BPM + both subdivisions), plus audio on/off, volume, region size/position, and any later mode.

The notable move: the old `speed` slider **leaves `DEFAULTS` entirely**. Tempo replaces it (ADR 0001), and the whole tempo grid is treated as *instrument* state, not *simulation* state — so none of it resets. Rationale: rate is now a musical, performed quantity; a performer would not want Reset to jump their tempo. Resetting only part of the tempo (e.g. BPM stays, subdivision snaps back) would be an incoherent half-reset, so it is all-or-nothing, and the choice is nothing.

This deviates from the original sketch, whose Reset restored `speed` to 1 — recorded here because a reader comparing to the `.pde` or to pre-audio `DEFAULTS` would otherwise wonder why rate stopped resetting.

Invariant (not a decision, restated for the implementer): every new reaction on `db` uses `dedupe(equiv)`, per CLAUDE.md.
