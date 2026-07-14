import { defAtom } from "@thi.ng/atom";
import { reactive } from "@thi.ng/rstream";

/** Serializable config — everything the UI controls. Drives the engine. */
export interface AppState {
    running: boolean;
    /** seed line spacing ("distProbability") */
    dist: number;
    /** horizontal-only seeding ("stripesB") */
    stripes: boolean;
    /** generations advanced per displayed frame (fractional = slow motion) */
    speed: number;
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
}

/**
 * Original-sketch defaults — also what "Reset" restores. Deliberately excludes
 * the editing tool (`brush` / `tool`), which is orthogonal to the simulation.
 */
export const DEFAULTS: Pick<
    AppState,
    | "dist"
    | "stripes"
    | "speed"
    | "refDir"
    | "survival"
    | "autoReseed"
    | "entropyThreshold"
> = {
    dist: 100,
    stripes: false,
    speed: 1,
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
});

// High-frequency readouts are kept *out* of the config atom so 60 Hz updates
// never trigger config-derived reactions.
export const gen$ = reactive(0);
export const fps$ = reactive(0);
/** max patch entropy from the latest scan (0 until the first scan runs) */
export const entropy$ = reactive(0);
