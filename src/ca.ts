import { ABGR8888, intBuffer, type IntBuffer } from "@thi.ng/pixel";

/**
 * Cellular-automaton engine — a faithful port of the original Processing
 * sketch (`sketch_10_ca_experiment_optimized.pde`), rebuilt around flat
 * typed arrays for speed.
 *
 * Design notes
 * ------------
 * - State lives in two flat `Uint8Array`s (`grid` / `buffer`) instead of a
 *   `int[rows][cols]`. Double-buffered: each generation we write the next
 *   state into `buffer` and then swap references — no allocation, no copy.
 * - The mixed edge behaviour of the original is preserved exactly:
 *     left / top  -> CLAMP   (edge cell uses itself as neighbour)
 *     right / bot -> WRAP    (edge cell wraps to index 0)
 *   These are baked into four precomputed index maps so the inner loop is
 *   branch-free at the borders.
 * - Pixels are written straight into an `ABGR8888` {@link IntBuffer} whose
 *   backing `Uint32Array` maps 1:1 onto canvas `ImageData` — `blitCanvas`
 *   is then a single `putImageData`.
 * - `step()` fuses the generation update and the pixel write into one pass
 *   over the grid (the common case, speed = 1). `process()` advances without
 *   drawing, for running multiple generations per displayed frame.
 */

// ABGR8888 packed colours (little-endian: 0xAABBGGRR).
const WHITE = 0xffffffff; // empty cell
const BLACK = 0xff000000; // live cell
const BLUE = 0xffff0000; //  live cell whose left neighbour is also live -> (R0,G0,B255)

export interface CAConfig {
    cols: number;
    rows: number;
    /** "distProbability" in the original — spacing of the seed grid lines. */
    dist: number;
    /** "stripesB" in the original — horizontal-only seeding when true. */
    stripes: boolean;
    /**
     * Reference-neighbour direction (0..7) used by the rule, both as the
     * replacement value for a dying cell and in the growth test `cur === ref`.
     * The original sketch hard-codes the top-LEFT neighbour (index 0).
     */
    refDir?: number;
    /**
     * Survival threshold: a live cell with a neighbour-sum below this value is
     * overwritten by its reference neighbour. The original uses 6.
     */
    survival?: number;
}

// Reference-direction lookup: rowKind 0=top 1=mid 2=bottom, colKind 0=left 1=mid 2=right.
// Index 0 == top-left == the original sketch's hard-coded reference.
const DIR_ROW = [0, 0, 0, 1, 1, 2, 2, 2] as const; // tl t tr l r bl b br
const DIR_COL = [0, 1, 2, 0, 2, 0, 1, 2] as const;

export class CA {
    readonly cols: number;
    readonly rows: number;
    readonly size: number;

    grid: Uint8Array;
    buffer: Uint8Array;

    readonly img: IntBuffer;
    private readonly px: Uint32Array;

    // Precomputed neighbour index maps (edge rules baked in).
    private readonly colL: Int32Array; // left column index (clamped)
    private readonly colR: Int32Array; // right column index (wrapped)
    private readonly rowT: Int32Array; // top row *base offset* (clamped)
    private readonly rowB: Int32Array; // bottom row base offset (wrapped)

    // Reference-neighbour maps, rebuilt whenever the rule direction changes.
    private refRow!: Int32Array; // chosen row base offset per i
    private refCol!: Int32Array; // chosen column index per j

    dist: number;
    stripes: boolean;
    refDir: number;
    survival: number;
    generation = 0;

    constructor(cfg: CAConfig) {
        const { cols, rows } = cfg;
        this.cols = cols;
        this.rows = rows;
        this.size = cols * rows;
        this.dist = Math.max(1, cfg.dist | 0);
        this.stripes = cfg.stripes;
        this.refDir = (cfg.refDir ?? 0) & 7;
        this.survival = Math.min(8, Math.max(1, (cfg.survival ?? 6) | 0));

        this.grid = new Uint8Array(this.size);
        this.buffer = new Uint8Array(this.size);
        this.img = intBuffer(cols, rows, ABGR8888);
        this.px = this.img.data as Uint32Array;

        this.colL = new Int32Array(cols);
        this.colR = new Int32Array(cols);
        for (let j = 0; j < cols; j++) {
            this.colL[j] = j > 0 ? j - 1 : j; // clamp left
            this.colR[j] = j < cols - 1 ? j + 1 : 0; // wrap right
        }
        this.rowT = new Int32Array(rows);
        this.rowB = new Int32Array(rows);
        for (let i = 0; i < rows; i++) {
            this.rowT[i] = (i > 0 ? i - 1 : i) * cols; // clamp top
            this.rowB[i] = (i < rows - 1 ? i + 1 : 0) * cols; // wrap bottom
        }

        this.refRow = new Int32Array(rows);
        this.refCol = new Int32Array(cols);
        this.buildRefMaps();

        this.populate();
    }

    /** Rebuild the reference-neighbour maps for the current {@link refDir}. */
    private buildRefMaps() {
        const { cols, rows, colL, colR, rowT, rowB, refRow, refCol } = this;
        const rk = DIR_ROW[this.refDir];
        const ck = DIR_COL[this.refDir];
        for (let i = 0; i < rows; i++) {
            refRow[i] = rk === 0 ? rowT[i] : rk === 2 ? rowB[i] : i * cols;
        }
        for (let j = 0; j < cols; j++) {
            refCol[j] = ck === 0 ? colL[j] : ck === 2 ? colR[j] : j;
        }
    }

    /** Seed the grid (original `populate()`), resetting the generation counter. */
    populate() {
        const { grid, cols, rows, dist, stripes } = this;
        for (let i = 0; i < rows; i++) {
            const base = i * cols;
            const iLine = i % dist === 0;
            for (let j = 0; j < cols; j++) {
                grid[base + j] = stripes
                    ? iLine || j === 0
                        ? 0
                        : 1
                    : j % dist === 0 || iLine
                      ? 0
                      : 1;
            }
        }
        this.generation = 0;
    }

    /**
     * Re-apply the seed pattern inside a rectangle only, using the same global
     * coordinate formula as {@link populate} (so seed lines stay aligned across
     * patches). Does NOT reset the generation counter — this is a local
     * intervention into a running simulation, not a restart.
     */
    populateRect(x0: number, y0: number, w: number, h: number) {
        const { grid, cols, rows, dist, stripes } = this;
        const yEnd = Math.min(rows, y0 + h);
        const xEnd = Math.min(cols, x0 + w);
        for (let i = Math.max(0, y0); i < yEnd; i++) {
            const base = i * cols;
            const iLine = i % dist === 0;
            for (let j = Math.max(0, x0); j < xEnd; j++) {
                grid[base + j] = stripes
                    ? iLine || j === 0
                        ? 0
                        : 1
                    : j % dist === 0 || iLine
                      ? 0
                      : 1;
            }
        }
    }

    /** Wipe the grid to all-empty (original `empty()`). */
    clear() {
        this.grid.fill(0);
        this.generation = 0;
    }

    /**
     * Advance one generation AND write the pixels for the *pre-step* state in a
     * single fused pass (matches the original draw-then-process ordering).
     */
    step() {
        const {
            grid: g,
            buffer: b,
            px,
            cols,
            rows,
            colL,
            colR,
            rowT,
            rowB,
            refRow,
            refCol,
        } = this;
        const surv = this.survival;
        for (let i = 0; i < rows; i++) {
            const base = i * cols;
            const rt = rowT[i];
            const rb = rowB[i];
            const rr = refRow[i];
            const interiorRow = i > 0;
            for (let j = 0; j < cols; j++) {
                const cl = colL[j];
                const cr = colR[j];
                const idx = base + j;
                const cur = g[idx];

                // 8-neighbourhood
                const sum =
                    g[base + cl] + // left
                    g[base + cr] + // right
                    g[rt + j] + // top
                    g[rb + j] + // bottom
                    g[rt + cl] + // top-left
                    g[rt + cr] + // top-right
                    g[rb + cl] + // bottom-left
                    g[rb + cr]; // bottom-right

                // reference neighbour for the rule (top-left in the original)
                const ref = g[rr + refCol[j]];

                // modified rules of life
                b[idx] = cur === 1 && sum < surv ? ref : cur === ref ? 1 : cur;

                // colouring, from the current (pre-step) state
                px[idx] =
                    cur === 1
                        ? interiorRow && j > 0 && g[idx - 1] === 1
                            ? BLUE
                            : BLACK
                        : WHITE;
            }
        }
        // O(1) double-buffer swap
        this.grid = b;
        this.buffer = g;
        this.generation++;
    }

    /** Advance one generation without touching pixels (extra sub-steps). */
    process() {
        const {
            grid: g,
            buffer: b,
            cols,
            rows,
            colL,
            colR,
            rowT,
            rowB,
            refRow,
            refCol,
        } = this;
        const surv = this.survival;
        for (let i = 0; i < rows; i++) {
            const base = i * cols;
            const rt = rowT[i];
            const rb = rowB[i];
            const rr = refRow[i];
            for (let j = 0; j < cols; j++) {
                const cl = colL[j];
                const cr = colR[j];
                const idx = base + j;
                const cur = g[idx];
                const sum =
                    g[base + cl] +
                    g[base + cr] +
                    g[rt + j] +
                    g[rb + j] +
                    g[rt + cl] +
                    g[rt + cr] +
                    g[rb + cl] +
                    g[rb + cr];
                const ref = g[rr + refCol[j]];
                b[idx] = cur === 1 && sum < surv ? ref : cur === ref ? 1 : cur;
            }
        }
        this.grid = b;
        this.buffer = g;
        this.generation++;
    }

    /** Re-render the current grid to pixels without advancing (paused / edited). */
    render() {
        const { grid: g, px, cols, rows } = this;
        for (let i = 0; i < rows; i++) {
            const base = i * cols;
            const interiorRow = i > 0;
            for (let j = 0; j < cols; j++) {
                const idx = base + j;
                const cur = g[idx];
                px[idx] =
                    cur === 1
                        ? interiorRow && j > 0 && g[idx - 1] === 1
                            ? BLUE
                            : BLACK
                        : WHITE;
            }
        }
    }

    /** Toggle a single cell at integer grid coordinates. */
    toggle(gx: number, gy: number) {
        if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return;
        const idx = gy * this.cols + gx;
        this.grid[idx] = this.grid[idx] ? 0 : 1;
    }

    /**
     * Paint a square brush of side `size` (cells), centred on (gx, gy), setting
     * every covered cell to `value` (1 = draw / alive, 0 = erase / dead).
     * `size = 1` is a single cell. Out-of-bounds cells are skipped.
     */
    paint(gx: number, gy: number, size: number, value: number) {
        const { grid, cols, rows } = this;
        const s = Math.max(1, size | 0);
        const half = (s - 1) >> 1;
        const v = value ? 1 : 0;
        const y0 = gy - half;
        const x0 = gx - half;
        for (let dy = 0; dy < s; dy++) {
            const yy = y0 + dy;
            if (yy < 0 || yy >= rows) continue;
            const base = yy * cols;
            for (let dx = 0; dx < s; dx++) {
                const xx = x0 + dx;
                if (xx < 0 || xx >= cols) continue;
                grid[base + xx] = v;
            }
        }
    }

    /** Re-seed with new parameters. */
    reconfigure(dist: number, stripes: boolean) {
        this.dist = Math.max(1, dist | 0);
        this.stripes = stripes;
        this.populate();
    }

    /**
     * Change the rule (reference direction + survival threshold) in place. Does
     * NOT reseed — the new rule takes effect from the next {@link step}.
     */
    setRule(refDir: number, survival: number) {
        this.refDir = refDir & 7;
        this.survival = Math.min(8, Math.max(1, survival | 0));
        this.buildRefMaps();
    }

    /** Blit the framebuffer to a canvas (single putImageData). */
    blit(ctx: CanvasRenderingContext2D) {
        this.img.blitCanvas(ctx);
    }
}
