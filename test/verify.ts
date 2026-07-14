import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { CA } from "../src/ca.js";

// ---------------------------------------------------------------------------
// Reference implementation — a direct, naive port of the original Processing
// sketch using int[rows][cols], to validate the optimized typed-array engine.
// ---------------------------------------------------------------------------

const WHITE = 0xffffffff;
const BLACK = 0xff000000;
const BLUE = 0xffff0000;

type Grid = number[][];

function refPopulate(
    rows: number,
    cols: number,
    dist: number,
    stripes: boolean,
): Grid {
    const g: Grid = [];
    for (let i = 0; i < rows; i++) {
        g[i] = [];
        for (let j = 0; j < cols; j++) {
            g[i][j] = stripes
                ? i % dist === 0 || j === 0
                    ? 0
                    : 1
                : j % dist === 0 || i % dist === 0
                  ? 0
                  : 1;
        }
    }
    return g;
}

function refProcess(grid: Grid): Grid {
    const rows = grid.length;
    const cols = grid[0].length;
    const buffer: Grid = [];
    for (let i = 0; i < rows; i++) {
        buffer[i] = [];
        for (let j = 0; j < cols; j++) {
            const idxLeft = j > 0 ? j - 1 : j;
            const idxRight = j < cols - 1 ? j + 1 : 0;
            const idxTop = i > 0 ? i - 1 : i;
            const idxBottom = i < rows - 1 ? i + 1 : 0;

            const current = grid[i][j];
            const left = grid[i][idxLeft];
            const right = grid[i][idxRight];
            const top = grid[idxTop][j];
            const bottom = grid[idxBottom][j];
            const topLeft = grid[idxTop][idxLeft];
            const topRight = grid[idxTop][idxRight];
            const bottomLeft = grid[idxBottom][idxLeft];
            const bottomRight = grid[idxBottom][idxRight];

            const sum =
                left +
                right +
                top +
                bottom +
                topLeft +
                topRight +
                bottomLeft +
                bottomRight;

            if (current === 1 && sum < 6) buffer[i][j] = topLeft;
            else if (current === topLeft) buffer[i][j] = 1;
            else buffer[i][j] = current;
        }
    }
    return buffer;
}

function refColors(grid: Grid): Uint32Array {
    const rows = grid.length;
    const cols = grid[0].length;
    const out = new Uint32Array(rows * cols);
    let index = 0;
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const cell = grid[i][j];
            let c = WHITE;
            if (cell === 1) {
                if (j > 0 && i > 0) {
                    c = grid[i][j - 1] === 1 ? BLUE : BLACK;
                } else {
                    c = BLACK;
                }
            }
            out[index++] = c;
        }
    }
    return out;
}

const flat = (g: Grid) => {
    const out = new Uint8Array(g.length * g[0].length);
    let k = 0;
    for (const row of g) for (const v of row) out[k++] = v;
    return out;
};

function eq(
    a: ArrayLike<number>,
    b: ArrayLike<number>,
    label: string,
): boolean {
    if (a.length !== b.length) {
        console.error(`  ✗ ${label}: length ${a.length} != ${b.length}`);
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            console.error(
                `  ✗ ${label}: first diff at ${i}: ${a[i]} != ${b[i]}`,
            );
            return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------

let ok = true;

interface Cfg {
    rows: number;
    cols: number;
    dist: number;
    stripes: boolean;
    gens: number;
}

const cfgs: Cfg[] = [
    { rows: 18, cols: 24, dist: 7, stripes: false, gens: 16 },
    { rows: 32, cols: 32, dist: 5, stripes: true, gens: 16 },
    { rows: 25, cols: 40, dist: 100, stripes: false, gens: 12 }, // sparse seed lines
    { rows: 31, cols: 29, dist: 3, stripes: false, gens: 20 }, // odd dims + wrap edges
    { rows: 120, cols: 120, dist: 13, stripes: true, gens: 8 }, // larger
];

for (const c of cfgs) {
    const tag = `${c.cols}x${c.rows} dist=${c.dist} stripes=${c.stripes}`;
    console.log(`• ${tag}`);

    // --- fused step() path: grid + pixels each generation ---
    const ca = new CA({
        cols: c.cols,
        rows: c.rows,
        dist: c.dist,
        stripes: c.stripes,
    });
    let ref = refPopulate(c.rows, c.cols, c.dist, c.stripes);
    ok = eq(ca.grid, flat(ref), "seed grid") && ok;

    for (let g = 0; g < c.gens; g++) {
        const expectColors = refColors(ref); // colours of pre-step state
        ca.step();
        ok =
            eq(ca.img.data as Uint32Array, expectColors, `gen ${g} pixels`) &&
            ok;
        ref = refProcess(ref);
        ok = eq(ca.grid, flat(ref), `gen ${g} grid`) && ok;
    }

    // --- process() path: grid only (multi-substep correctness) ---
    const ca2 = new CA({
        cols: c.cols,
        rows: c.rows,
        dist: c.dist,
        stripes: c.stripes,
    });
    let ref2 = refPopulate(c.rows, c.cols, c.dist, c.stripes);
    for (let g = 0; g < c.gens; g++) {
        ca2.process();
        ref2 = refProcess(ref2);
        ok = eq(ca2.grid, flat(ref2), `gen ${g} process() grid`) && ok;
    }

    // --- render() path matches colours after an edit ---
    ca2.toggle(1, 1);
    ca2.toggle(0, 0);
    ca2.render();
    // mirror the same edits on the reference flat grid -> 2D for colouring
    const rg: Grid = [];
    for (let i = 0; i < c.rows; i++) {
        rg[i] = [];
        for (let j = 0; j < c.cols; j++) rg[i][j] = ca2.grid[i * c.cols + j];
    }
    ok =
        eq(ca2.img.data as Uint32Array, refColors(rg), "render() pixels") && ok;
}

console.log(
    ok
        ? "\n✅ ALL CHECKS PASSED — engine is bit-exact with the original sketch."
        : "\n❌ MISMATCH",
);

// ---------------------------------------------------------------------------
// Render a real 600x600 frame to PNG for a visual sanity check.
// ---------------------------------------------------------------------------

function writePNG(path: string, w: number, h: number, abgr: Uint32Array) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    let p = 0;
    for (let y = 0; y < h; y++) {
        raw[p++] = 0; // filter: none
        for (let x = 0; x < w; x++) {
            const v = abgr[y * w + x];
            raw[p++] = v & 0xff; // R
            raw[p++] = (v >>> 8) & 0xff; // G
            raw[p++] = (v >>> 16) & 0xff; // B
            raw[p++] = (v >>> 24) & 0xff; // A
        }
    }
    const crcTable = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    const crc32 = (buf: Buffer) => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++)
            c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const tb = Buffer.from(type, "ascii");
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
        return Buffer.concat([len, tb, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // colour type RGBA
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = Buffer.concat([
        sig,
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
    writeFileSync(path, png);
}

const show = new CA({ cols: 600, rows: 600, dist: 100, stripes: false });
for (let g = 0; g < 60; g++) show.step();
writePNG(
    "/home/claude/ca-applet/frame_gen60.png",
    600,
    600,
    show.img.data as Uint32Array,
);
for (let g = 0; g < 90; g++) show.step();
writePNG(
    "/home/claude/ca-applet/frame_gen150.png",
    600,
    600,
    show.img.data as Uint32Array,
);
console.log("wrote frame_gen60.png, frame_gen150.png");
