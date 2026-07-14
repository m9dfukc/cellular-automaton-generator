/**
 * Local entropy detection (POC) — spot grid regions that have dissolved into
 * pixel noise so they can be re-seeded.
 *
 * Measure: Shannon entropy of the distribution of overlapping 2×2 block
 * patterns inside each patch, normalised to [0,1] (max = 4 bits, all 16
 * patterns uniform). The woven lattices reuse a handful of block patterns and
 * score low; chaotic noise exercises nearly all 16 and approaches 1. Note this
 * sidesteps the gzip-compressibility trap from the rule-pool analysis: it is a
 * local distribution measure, not a global sequence-compression one.
 */

export interface PatchStats {
    /** patch rect in grid cells */
    x0: number;
    y0: number;
    w: number;
    h: number;
    /** normalised block entropy 0..1 */
    entropy: number;
}

export interface EntropyScan {
    /** patches at/above the threshold, i.e. candidates for re-seeding */
    noisy: PatchStats[];
    /** highest patch entropy seen — for calibrating the threshold by eye */
    max: number;
}

/** Patch side length in cells (600/75 → an 8×8 patch grid). */
export const PATCH_SIZE = 75;

/** Generations between scans — noise onset is slow, no need to check per frame. */
export const CHECK_INTERVAL = 30;

const LOG2 = Math.log(2);

// Reused histogram of the 16 possible 2×2 block patterns.
const hist = new Uint32Array(16);

export const scanEntropy = (
    grid: Uint8Array,
    cols: number,
    rows: number,
    threshold: number,
    patch = PATCH_SIZE,
): EntropyScan => {
    const noisy: PatchStats[] = [];
    let max = 0;
    for (let py = 0; py < rows; py += patch) {
        const h = Math.min(patch, rows - py);
        for (let px = 0; px < cols; px += patch) {
            const w = Math.min(patch, cols - px);
            const n = (w - 1) * (h - 1);
            if (n === 0) continue;
            hist.fill(0);
            for (let y = py, yEnd = py + h - 1; y < yEnd; y++) {
                const base = y * cols;
                for (let x = px, xEnd = px + w - 1; x < xEnd; x++) {
                    const idx = base + x;
                    hist[
                        grid[idx] |
                            (grid[idx + 1] << 1) |
                            (grid[idx + cols] << 2) |
                            (grid[idx + cols + 1] << 3)
                    ]++;
                }
            }
            let H = 0;
            for (let k = 0; k < 16; k++) {
                const c = hist[k];
                if (c) {
                    const p = c / n;
                    H -= (p * Math.log(p)) / LOG2;
                }
            }
            const e = H / 4;
            if (e > max) max = e;
            if (e >= threshold) noisy.push({ x0: px, y0: py, w, h, entropy: e });
        }
    }
    return { noisy, max };
};
