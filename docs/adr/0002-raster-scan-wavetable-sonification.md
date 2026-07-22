# Sonification maps the region to a live-rewritten raster-scan wavetable

The Sounding CA becomes audio by raster-scanning its region into a **wavetable** — each cell contributes one sample (alive → +g, dead → −g) — which a read phasor loops. The Sounding CA rewrites this table as it evolves, every `N` output samples (`N` derived from the tempo grid, ADR 0001).

Two sonic axes fall out cleanly and orthogonally:

- **Region size sets pitch.** The table length equals the region's cell count, so the loop period — and thus the carrier frequency — is a function of region size (a 64-cell scan → ~750 Hz).
- **Tempo/`N` sets timbre morph.** How fast the table mutates under the read pointer. As `N` approaches the scan length, the CA rewrites the table mid-scan and the read/write race — the aliasing sound — emerges *intrinsically* from the evolving CA.

We chose this over (a) a per-generation reduction to a single sample (an oscillator whose waveform is the aggregate, but the spatial *pattern* is inaudible) and (c) a column-as-frame hybrid. Only the raster-scan makes the CA's actual pattern the waveform — the point of sonifying *this* automaton rather than a noise source — and it reproduces the brainstorming doc's own §2A pitch arithmetic.

Consequence: this partly subsumes the plan's separate "Race mode" — at small `N` the audio-clock CA is already an aliasing synth, so an explicit second read/write phasor pair is an enhancement, not a core requirement. The reduction model (a) is retained only as the material for the later §2D event/sub-oscillator layer.
