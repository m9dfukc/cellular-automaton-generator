import { $compile } from "@thi.ng/rdom";
import { fromAtom, fromDOMEvent, fromRAF } from "@thi.ng/rstream";
import { gestureStream } from "@thi.ng/rstream-gestures";
import { dedupe, map } from "@thi.ng/transducers";
import { equiv } from "@thi.ng/equiv";
import { CA } from "./ca.js";
import { CHECK_INTERVAL, scanEntropy } from "./entropy.js";
import { type AppState, DEFAULTS, db, entropy$, fps$, gen$ } from "./state.js";

const COLS = 600;
const ROWS = 600;

// Reference-direction arrows for the readout (0 = top-left, the original rule).
const DIR_ARROWS = ["↖", "↑", "↗", "←", "→", "↙", "↓", "↘"] as const;

// Curated rule pool for Randomize. Filtered from all 32 reachable rules by
// spatial complexity: dropped the flooded seed-rasters (survival 4–5, edge
// density < 3 %, near-frozen) and the 1-D banded rules (orthogonal reference
// directions, edge anisotropy 0.6–0.98). What remains is the eight 2-D woven
// lattices — the diagonal reference directions at survival 6–7.
const KEEPER_RULES: ReadonlyArray<readonly [refDir: number, survival: number]> =
    [
        [0, 6], // ↖
        [0, 7],
        [2, 6], // ↗
        [2, 7],
        [5, 6], // ↙
        [5, 7],
        [7, 6], // ↘
        [7, 7],
    ];

// --- hot reload ------------------------------------------------------------
// This module is the HMR boundary for the whole sketch: editing anything it
// imports re-executes *this* file, rebuilding the CA from scratch. Without a
// snapshot every edit would drop the sketch back to generation 0, so the state
// worth keeping crosses the reload here and the old instance is torn down at
// the bottom of the file.
//
// The snapshot is plain data by design — a reload may have replaced the CA
// class or the atom itself, so handing the live instances over would carry
// stale code into the new module.
//
// Vite drops every `import.meta.hot` branch from production builds.

interface Snapshot {
    state: AppState;
    grid: Uint8Array;
    generation: number;
}

const snapshot: Snapshot | undefined = import.meta.hot?.data.snapshot;

// --- engine + canvas -------------------------------------------------------

// Merged over the live state rather than assigned, so a field added to
// AppState since the snapshot was taken still arrives with its default. The
// trade-off: a restored session keeps its old values, so edits to DEFAULTS
// only show up after a Reset or a hard reload.
if (snapshot) db.swap((s) => ({ ...s, ...snapshot.state }));

const init = db.deref();
const ca = new CA({
    cols: COLS,
    rows: ROWS,
    dist: init.dist,
    stripes: init.stripes,
    refDir: init.refDir,
    survival: init.survival,
});

const canvas = document.createElement("canvas");
canvas.width = COLS;
canvas.height = ROWS;
canvas.className = "ca-canvas";
const ctx = canvas.getContext("2d", { alpha: false })!;
ctx.imageSmoothingEnabled = false;
// replaceChildren rather than appendChild: init owns the stage, so a hot
// reload can't stack a second canvas under the first. Teardown alone can't
// guarantee that — a module that throws midway never reaches its dispose hook,
// leaving its canvas behind for every later reload to append beneath.
document.getElementById("stage")!.replaceChildren(canvas);

// `dirty` forces one render while paused (after an edit / reseed / clear).
let dirty = true;
const markDirty = () => {
    dirty = true;
};

/** Re-seed the grid from the current seed parameters (rule untouched). */
const reseed = () => {
    ca.reconfigure(db.deref().dist, db.deref().stripes);
    gen$.next(0);
    markDirty();
};

/** Clear the stage only — keeps the current rule + seed parameters. */
const wipe = () => {
    ca.clear();
    gen$.next(0);
    markDirty();
};

/**
 * Randomize the *algorithm* only — a new rule takes over the current buffer,
 * so whatever is on screen keeps evolving under it (no reseed). Drawn from the
 * curated {@link KEEPER_RULES} pool (the eight 2-D lattices), and guaranteed to
 * differ from the current rule, so every roll visibly does something good.
 */
const randomize = () => {
    const cur = db.deref();
    let pick: readonly [number, number];
    do {
        pick = KEEPER_RULES[(Math.random() * KEEPER_RULES.length) | 0];
    } while (pick[0] === cur.refDir && pick[1] === cur.survival);
    db.swap((s) => ({ ...s, refDir: pick[0], survival: pick[1] }));
};

/** Reset everything to the original-sketch defaults, then reseed. */
const reset = () => {
    db.swap((s) => ({ ...s, ...DEFAULTS }));
    reseed();
};

/**
 * Advance a single generation while paused, then draw it. No-op while running
 * (the RAF loop already drives frames). Pausing reconciles the canvas to the
 * true current grid (see the reaction below), so `ca.generation` is exactly
 * what's on screen and each call moves the display forward by exactly one.
 */
const stepForward = () => {
    if (db.deref().running) return;
    ca.process(); // advance the grid one generation (no draw)
    ca.render(); // colour the new current grid (same formula as step())
    ca.blit(ctx);
    displayGen = ca.generation;
    gen$.next(ca.generation);
};

/**
 * FNV-1a over the framebuffer — a short content tag for the filename, so two
 * frames caught at the same generation under different rules don't collide.
 * Hashes the pixels, not the grid: while running, `step()` draws the pre-step
 * frame and leaves `grid` a generation ahead of the canvas, so only the
 * framebuffer is guaranteed to match the PNG.
 */
const frameHash = () => {
    const px = ca.img.data;
    let h = 0x811c9dc5;
    for (let i = 0; i < px.length; i++) h = Math.imul(h ^ px[i], 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0").slice(0, 6);
};

/** Download the current canvas frame as a PNG (captures exactly what's shown). */
const downloadPNG = () => {
    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ca-experiment-gen${displayGen}-${frameHash()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }, "image/png");
};

// --- the loop --------------------------------------------------------------
// One RAF stream drives everything. The per-pixel work stays imperative (it
// has to, for speed); the surrounding architecture is declarative.
//
// `speed` is generations-per-frame and may be fractional: an accumulator lets
// speed < 1 run as true slow motion (advance only every Nth frame).

let lastT = 0;
let frames = 0;
let acc = 0;
let stepAcc = 0;
let displayGen = 0; // generation currently shown on the canvas
let lastScanGen = 0; // generation of the last entropy scan (POC)

const rafSub = fromRAF({ timestamp: true, t0: true }).subscribe({
    next(t) {
        const dt = t - lastT;
        lastT = t;
        const st = db.deref();

        if (st.running) {
            stepAcc += st.speed;
            const steps = stepAcc | 0; // whole generations due this frame
            if (steps > 0) {
                stepAcc -= steps;
                const shown = ca.generation; // gen of the pre-step frame we draw
                ca.step(); // advance #1 + draw pre-step state (fused, 1 pass)
                for (let k = 1; k < steps; k++) ca.process(); // extra sub-steps
                ca.blit(ctx);
                displayGen = shown;
                gen$.next(shown);
            }
            // steps === 0 -> slow motion: hold the last frame, advance nothing

            // POC: periodically scan patches for noise, re-seed the noisy ones.
            if (st.autoReseed) {
                if (ca.generation < lastScanGen) lastScanGen = 0; // counter was reset
                if (ca.generation - lastScanGen >= CHECK_INTERVAL) {
                    lastScanGen = ca.generation;
                    const { noisy, max } = scanEntropy(
                        ca.grid,
                        ca.cols,
                        ca.rows,
                        st.entropyThreshold,
                    );
                    entropy$.next(max);
                    if (noisy.length) {
                        for (const p of noisy)
                            ca.populateRect(p.x0, p.y0, p.w, p.h);
                        console.log(
                            `[entropy] gen ${ca.generation}: re-seeded ${noisy.length} patch(es), max entropy ${max.toFixed(3)}`,
                        );
                    }
                }
            }
        } else if (dirty) {
            ca.render();
            ca.blit(ctx);
            dirty = false;
            displayGen = ca.generation;
            gen$.next(ca.generation);
        }

        frames++;
        acc += dt;
        if (acc >= 250) {
            fps$.next((frames * 1000) / acc);
            frames = 0;
            acc = 0;
        }
    },
});

// --- reactions (declarative side effects) ----------------------------------
// NB: dedupe() defaults to reference equality, so the mapped tuples must be
// compared with `equiv` — otherwise every unrelated atom change (pause, speed)
// would re-fire these and reseed the grid.

// Re-seed whenever the seeding parameters change.
const seedSub = fromAtom(db)
    .transform(
        map((s: AppState) => [s.dist, s.stripes] as const),
        dedupe(equiv),
    )
    .subscribe({
        next([dist, stripes]) {
            ca.reconfigure(dist, stripes);
            gen$.next(0);
            markDirty();
        },
    });

// Apply rule changes (reference direction + survival) in place — no reseed.
const ruleSub = fromAtom(db)
    .transform(
        map((s: AppState) => [s.refDir, s.survival] as const),
        dedupe(equiv),
    )
    .subscribe({
        next([refDir, survival]) {
            ca.setRule(refDir, survival);
            markDirty();
        },
    });

// Reconcile the canvas on pause. While running, the fused loop draws the
// *pre-step* frame and leaves the grid one generation ahead of what's shown;
// re-rendering the true current grid here means `ca.generation` matches the
// canvas, so single-frame stepping (`n` / Step ▶) advances from a defined frame.
const pauseSub = fromAtom(db)
    .transform(
        map((s: AppState) => s.running),
        dedupe(equiv),
    )
    .subscribe({
        next(running) {
            if (running) return;
            ca.render();
            ca.blit(ctx);
            dirty = false;
            displayGen = ca.generation;
            gen$.next(ca.generation);
        },
    });

// --- input -----------------------------------------------------------------

// Pointer drawing: brush of the current size, painting (draw) or clearing
// (erase) cells. Consecutive drag points are interpolated so fast strokes
// stay continuous instead of dotted.
let lastGX = -1;
let lastGY = -1;

const stamp = (gx: number, gy: number) => {
    const st = db.deref();
    ca.paint(gx, gy, st.brush, st.tool === "erase" ? 0 : 1);
};

const strokeTo = (gx: number, gy: number) => {
    if (lastGX < 0) {
        stamp(gx, gy);
    } else {
        const dx = gx - lastGX;
        const dy = gy - lastGY;
        const n = Math.max(Math.abs(dx), Math.abs(dy));
        if (n === 0) {
            stamp(gx, gy);
        } else {
            for (let i = 1; i <= n; i++) {
                stamp(
                    lastGX + Math.round((dx * i) / n),
                    lastGY + Math.round((dy * i) / n),
                );
            }
        }
    }
    lastGX = gx;
    lastGY = gy;
    markDirty();
};

const gestureSub = gestureStream(canvas, { local: true }).subscribe({
    next(e) {
        if (e.type === "start" || e.type === "drag") {
            const [px, py] = e.pos;
            const gx = ((px / canvas.clientWidth) * ca.cols) | 0;
            const gy = ((py / canvas.clientHeight) * ca.rows) | 0;
            if (e.type === "start") {
                lastGX = -1; // begin a fresh stroke
            }
            strokeTo(gx, gy);
        } else if (e.type === "end") {
            lastGX = -1;
        }
    },
});

// Keyboard: space = run/pause, n = step (paused), r = randomize, x = reset,
// s = seed, c = clear.
const keySub = fromDOMEvent(window, "keydown").subscribe({
    next(e) {
        const k = (e as KeyboardEvent).key;
        if (k === " ") {
            e.preventDefault();
            db.swapIn(["running"], (x) => !x);
        } else if (k === "n" || k === "N") {
            stepForward();
        } else if (k === "r" || k === "R") {
            randomize();
        } else if (k === "x" || k === "X") {
            reset();
        } else if (k === "s" || k === "S") {
            reseed();
        } else if (k === "c" || k === "C") {
            wipe();
        }
    },
});

// --- declarative UI (rdom + reactive atom/streams) -------------------------

const state$ = fromAtom(db);
const field$ = <T>(f: (s: AppState) => T) =>
    state$.transform(map(f), dedupe(equiv));

const running$ = field$((s) => s.running);
const dist$ = field$((s) => s.dist);
const stripes$ = field$((s) => s.stripes);
const autoReseed$ = field$((s) => s.autoReseed);
const threshold$ = field$((s) => s.entropyThreshold);
const speed$ = field$((s) => s.speed);
const rule$ = field$((s) => `${DIR_ARROWS[s.refDir]} ${s.survival}`);
const brush$ = field$((s) => s.brush);
const drawPressed$ = field$((s) => (s.tool === "draw" ? "true" : "false"));
const erasePressed$ = field$((s) => (s.tool === "erase" ? "true" : "false"));

const runLabel$ = running$.transform(map((r) => (r ? "Pause" : "Run")));
const genText$ = gen$.transform(map((g: number) => g.toLocaleString("en-US")));
const fpsText$ = fps$.transform(map((f: number) => `${Math.round(f)}`));
const speedText$ = speed$.transform(map((s) => `${s.toFixed(1)}×`));
const thresholdText$ = threshold$.transform(map((t) => t.toFixed(2)));
const entropyText$ = entropy$.transform(map((e: number) => e.toFixed(2)));

const num = (e: Event) => (e.target as HTMLInputElement).valueAsNumber;

const panel = [
    "div.panel",
    {},
    [
        "div.brand",
        {},
        ["span.brand-mark", {}],
        ["span.brand-text", {}, "Cellular Automaton"],
        ["span.brand-sub", {}, "experiment 10"],
    ],

    [
        "div.controls",
        {},
        [
            "button.btn.btn-primary",
            { onclick: () => db.swapIn(["running"], (x) => !x) },
            runLabel$,
        ],
        [
            "button.btn.btn-wide",
            {
                onclick: stepForward,
                disabled: running$,
                title: "Advance one generation (n) — available while paused",
            },
            "Step ▶",
        ],
        ["button.btn", { onclick: randomize }, "Randomize"],
        ["button.btn", { onclick: reset }, "Reset"],
        ["button.btn", { onclick: reseed }, "Seed"],
        ["button.btn", { onclick: wipe }, "Clear"],
        ["button.btn.btn-wide", { onclick: downloadPNG }, "Download PNG"],
    ],

    [
        "div.field",
        {},
        [
            "div.field-head",
            {},
            ["span.field-label", {}, "Seed spacing"],
            ["span.field-value", {}, dist$],
        ],
        [
            "input.slider",
            {
                type: "range",
                min: 2,
                max: 300,
                step: 1,
                value: dist$,
                oninput: (e: Event) => db.resetIn(["dist"], num(e)),
            },
        ],
    ],

    [
        "div.field",
        {},
        [
            "div.field-head",
            {},
            ["span.field-label", {}, "Speed"],
            ["span.field-value", {}, speedText$],
        ],
        [
            "input.slider",
            {
                type: "range",
                min: 0.1,
                max: 8,
                step: 0.1,
                value: speed$,
                oninput: (e: Event) => db.resetIn(["speed"], num(e)),
            },
        ],
    ],

    [
        "div.field",
        {},
        [
            "div.field-head",
            {},
            ["span.field-label", {}, "Pencil"],
            ["span.field-value", {}, brush$],
        ],
        [
            "input.slider",
            {
                type: "range",
                min: 1,
                max: 48,
                step: 1,
                value: brush$,
                oninput: (e: Event) => db.resetIn(["brush"], num(e)),
            },
        ],
        [
            "div.seg",
            {},
            [
                "button.seg-btn",
                {
                    type: "button",
                    "aria-pressed": drawPressed$,
                    onclick: () => db.resetIn(["tool"], "draw"),
                },
                "Draw",
            ],
            [
                "button.seg-btn",
                {
                    type: "button",
                    "aria-pressed": erasePressed$,
                    onclick: () => db.resetIn(["tool"], "erase"),
                },
                "Erase",
            ],
        ],
    ],

    [
        "label.toggle",
        {},
        [
            "input",
            {
                type: "checkbox",
                checked: stripes$,
                onchange: (e: Event) =>
                    db.resetIn(
                        ["stripes"],
                        (e.target as HTMLInputElement).checked,
                    ),
            },
        ],
        ["span", {}, "Horizontal seeding"],
    ],

    [
        "label.toggle",
        {},
        [
            "input",
            {
                type: "checkbox",
                checked: autoReseed$,
                onchange: (e: Event) =>
                    db.resetIn(
                        ["autoReseed"],
                        (e.target as HTMLInputElement).checked,
                    ),
            },
        ],
        ["span", {}, "Auto re-seed noisy patches"],
    ],

    [
        "div.field",
        {},
        [
            "div.field-head",
            {},
            ["span.field-label", {}, "Noise threshold"],
            ["span.field-value", {}, thresholdText$],
        ],
        [
            "input.slider",
            {
                type: "range",
                min: 0.5,
                max: 1,
                step: 0.01,
                value: threshold$,
                oninput: (e: Event) => db.resetIn(["entropyThreshold"], num(e)),
            },
        ],
    ],

    [
        "div.readout",
        {},
        [
            "div.stat",
            {},
            ["span.stat-label", {}, "generation"],
            ["span.stat-value", {}, genText$],
        ],
        [
            "div.stat",
            {},
            ["span.stat-label", {}, "rule"],
            ["span.stat-value", {}, rule$],
        ],
        [
            "div.stat",
            {},
            ["span.stat-label", {}, "fps"],
            ["span.stat-value", {}, fpsText$],
        ],
        [
            "div.stat",
            {},
            ["span.stat-label", {}, "entropy"],
            ["span.stat-value", {}, entropyText$],
        ],
    ],

    // keyboard shortcuts are wrapped in .hint-keys so the mobile layout can
    // hide them (no keyboard on touch) while keeping "drag to draw"
    [
        "div.hint",
        {},
        [
            "span.hint-keys",
            {},
            ["kbd", {}, "space"],
            " run/pause · ",
            ["kbd", {}, "n"],
            " step · ",
            ["kbd", {}, "r"],
            " randomize · ",
            ["kbd", {}, "x"],
            " reset · ",
            ["kbd", {}, "s"],
            " seed · ",
            ["kbd", {}, "c"],
            " clear · ",
        ],
        "drag to draw",
    ],
];

const ui = $compile(panel);
ui.mount(document.getElementById("controls")!);

// --- hot reload: restore + teardown ----------------------------------------

// The grid restore has to come last. `fromAtom` emits its current value on
// subscribe, so wiring the reactions above already fired the seed reaction and
// repopulated the grid — a grid restored any earlier would be overwritten.
// Skipped when COLS/ROWS were edited, since the old grid no longer fits.
if (snapshot && snapshot.grid.length === ca.size) {
    ca.grid.set(snapshot.grid);
    ca.generation = snapshot.generation;
    gen$.next(snapshot.generation);
    markDirty();
}

if (import.meta.hot) {
    import.meta.hot.accept();
    // Vite awaits this before importing the replacement module, and rdom's
    // unmount is async — so awaiting it keeps the old panel from lingering
    // alongside the new one.
    import.meta.hot.dispose(async (data) => {
        data.snapshot = {
            state: db.deref(),
            grid: ca.grid.slice(),
            generation: ca.generation,
        } satisfies Snapshot;
        // Unsubscribing a leaf cascades up to each root stream's cleanup
        // (removeWatch / cancelAnimationFrame / removeEventListener). Leaving
        // any attached would leak a second RAF loop into the next module —
        // two loops stepping one engine looks like the sketch doubling speed.
        for (const sub of [
            rafSub,
            seedSub,
            ruleSub,
            pauseSub,
            gestureSub,
            keySub,
        ])
            sub.unsubscribe();
        await ui.unmount();
    });
}
