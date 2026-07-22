import { defAtom } from "@thi.ng/atom";
import { reactive } from "@thi.ng/rstream";

/** Serializable config — everything the UI controls. Drives the engine. */
export interface AppState {
    running: boolean;
    /** seed line spacing ("distProbability") */
    dist: number;
    /** horizontal-only seeding ("stripesB") */
    stripes: boolean;
    /** rule: reference-neighbour direction 0..7 (0 = top-left, the original) */
    refDir: number;
    /** rule: survival threshold (original = 6) */
    survival: number;
    /** POC: re-seed patches whose local block entropy exceeds the threshold */
    autoReseed: boolean;
    /** normalised patch-entropy threshold (0..1) for the auto reseed */
    entropyThreshold: number;
    /** pencil size in cells (edit tool, not part of the simulation) */
    brush: number;
    /** edit tool: paint live cells ("draw") or clear them ("erase") */
    tool: "draw" | "erase";

    // --- audio extension (all excluded from DEFAULTS — Reset never touches
    // tempo/audio, ADR 0004). This is *instrument* state, not *simulation*
    // state.
    /** master AudioContext running (the `a` key toggles it) */
    audioOn: boolean;
    /** output volume in dB (−18 = §3 conservative default) */
    volume: number;
    /**
     * stereo width (0..1): the right channel reads the same wavetable offset by
     * `width · tableLen/2` samples. 0 = dead-centre mono; 1 = maximal L/R phase
     * decorrelation. Pure phase spread — no pitch change.
     */
    width: number;
    /** master tempo, beats per minute (ADR 0001) */
    bpm: number;
    /**
     * visual CA subdivision — generations per beat. Coarse: down to
     * multi-bar-per-generation slow motion (replaces the old `speed` slider).
     * genPerSec = bpm/60 * visualSubdivision (ADR 0001, Risk 3). While audio is
     * on and running, this also sets the audible morph rate (ADR 0005).
     */
    visualSubdivision: number;
    /**
     * Region width in cells. The row length sets the raster-scan carrier
     * (sampleRate/regionW); regionW·regionH is the table length → loop pitch
     * (ADR 0002). Size buttons set regionW=regionH; Shift-drag sets W×H freely.
     */
    regionW: number;
    /** Region height in cells (see regionW). */
    regionH: number;
    /** Region centre X, normalised 0..1 across the grid (Alt-click/drag moves it) */
    regionX: number;
    /** Region centre Y, normalised 0..1 across the grid */
    regionY: number;
}

/**
 * Original-sketch defaults — also what "Reset" restores. Deliberately excludes
 * the editing tool (`brush` / `tool`), which is orthogonal to the simulation.
 */
export const DEFAULTS: Pick<
    AppState,
    | "dist"
    | "stripes"
    | "refDir"
    | "survival"
    | "autoReseed"
    | "entropyThreshold"
> = {
    dist: 100,
    stripes: false,
    refDir: 0,
    survival: 6,
    autoReseed: false,
    entropyThreshold: 0.9,
};

export const db = defAtom<AppState>({
    ...DEFAULTS,
    running: true,
    brush: 1,
    tool: "draw",
    // Audio/tempo — instrument state, intentionally outside DEFAULTS (ADR 0004).
    audioOn: false,
    volume: -18,
    width: 0.5,
    bpm: 120,
    visualSubdivision: 4,
    regionW: 64,
    regionH: 64,
    regionX: 0.5,
    regionY: 0.5,
});

// High-frequency readouts are kept *out* of the config atom so 60 Hz updates
// never trigger config-derived reactions.
//
// `closeOut: never` because these outlive any single mounting of the UI. A
// stream closes itself once its last subscriber leaves, so unmounting the
// panel would leave them UNSUBSCRIBED — fine for a page that is going away,
// fatal across a hot reload: this module is not re-executed when only `app.ts`
// or its siblings change, so the next UI would resubscribe to a dead stream
// and throw ("operation not allowed in state UNSUBSCRIBED").
export const gen$ = reactive(0, { closeOut: "never" });
export const fps$ = reactive(0, { closeOut: "never" });
/** max patch entropy from the latest scan (0 until the first scan runs) */
export const entropy$ = reactive(0, { closeOut: "never" });

// Audio readouts posted by the worklet (~15 Hz) — kept out of the atom, same
// reasoning as gen$/fps$: 15 Hz churn must not refire config reactions.
/** decimated snapshot of the sounding wavetable, for the waveform strip */
export const wave$ = reactive<Float32Array>(new Float32Array(0), {
    closeOut: "never",
});
/** output level (0..1), for the level meter */
export const level$ = reactive(0, { closeOut: "never" });
