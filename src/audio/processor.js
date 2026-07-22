// AudioWorklet processor — a pure wavetable player (ADR 0005). Plain .js on
// purpose: it is loaded verbatim via Vite `?raw` + a Blob/data: URL, so it must
// be valid JS with no transpile step (handoff Risk 1, verified).
//
// The worklet holds NO CA — it just loops whatever Region table the main thread
// last handed it (ADR 0005 retired the autonomous "sounding CA"). Running: the
// main thread mirrors the visible Region every generation → the loop morphs.
// Paused: no updates arrive → the last table loops as a static drone.
//
// Signal chain per sample (research §4):
//   table read -> DC-blocker (one-pole HPF ~20 Hz) -> soft-clip -> gain ramp
// Pitch = sampleRate / table length; table length = the Region's cell count
// (ADR 0002). The Region may be any W×H rectangle raster-scanned row-by-row —
// the worklet only sees a flat buffer and loops it, so it needs no dimensions.

const CELL_AMP = 0.9; // ± table amplitude (conservative; §3 + limiter net)
const WAVE_LEN = 248; // decimated waveform-strip width (research §5)
const WAVE_HZ = 15; // snapshot rate to the main thread

class WavetablePlayer extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const o = (options && options.processorOptions) || {};
        this.alloc(o.length || 0);
        this.readIdx = 0;

        // Stereo width (ADR "A"): the right channel reads the same table with a
        // second phasor, offset by `widthFrac · tableLen/2` samples — pure phase
        // decorrelation, no pitch change. 0 = mono/centre.
        this.readIdxR = 0;
        this.widthFrac = 0;
        this.offset = 0;

        // DC blocker (one-pole HPF ~20 Hz), per channel: R = 1 - 2*pi*fc/fs
        this.dcR = 1 - (2 * Math.PI * 20) / sampleRate;
        this.dcX1 = 0;
        this.dcY1 = 0;
        this.dcX1R = 0;
        this.dcY1R = 0;

        // gain ramp (~10 ms one-pole toward target); start silent to avoid click
        this.gain = 0;
        this.targetGain = 0;
        this.gainCoeff = 1 - Math.exp(-1 / (0.01 * sampleRate));

        // waveform/level readout
        this.waveScratch = new Float32Array(WAVE_LEN);
        this.wavePeriod = Math.max(1, (sampleRate / WAVE_HZ) | 0);
        this.waveCounter = 0;
        this.level = 0;

        this.port.onmessage = (e) => this.onMessage(e.data);
    }

    alloc(length) {
        this.tableLen = length;
        this.table = new Float32Array(length);
    }

    /** Recompute the right-channel read offset (samples) from the width. */
    updateOffset() {
        this.offset = Math.round(this.widthFrac * this.tableLen * 0.5);
        this.readIdxR = this.tableLen
            ? (this.readIdx + this.offset) % this.tableLen
            : 0;
    }

    /** Raster-scan a flat Region into the wavetable (alive -> +g, dead -> -g). */
    fill(region) {
        const { table, tableLen } = this;
        for (let k = 0; k < tableLen; k++)
            table[k] = region[k] ? CELL_AMP : -CELL_AMP;
    }

    onMessage(m) {
        switch (m.type) {
            case "seed": {
                // new Region from the main thread (live-mirror every generation,
                // or a single capture on pause). m.grid is a transferred buffer;
                // its length IS the table length (one cell = one sample).
                const region = new Uint8Array(m.grid);
                if (region.length !== this.tableLen) {
                    this.alloc(region.length);
                    this.readIdx = 0;
                    this.updateOffset(); // offset scales with the new length
                }
                this.fill(region);
                break;
            }
            case "config":
                if (m.volume != null)
                    this.targetGain =
                        m.enabled === false ? 0 : Math.pow(10, m.volume / 20);
                if (m.enabled === false) this.targetGain = 0;
                if (m.width != null) {
                    this.widthFrac = m.width;
                    this.updateOffset();
                }
                break;
        }
    }

    process(_inputs, outputs) {
        const out = outputs[0];
        const ch0 = out[0];
        const ch1 = out[1]; // undefined on a mono device
        const frames = ch0.length;
        const { table, tableLen, dcR, gainCoeff } = this;
        if (tableLen === 0) return true; // no Region yet — output silence
        let readIdx = this.readIdx;
        let readIdxR = this.readIdxR;
        let x1 = this.dcX1;
        let y1 = this.dcY1;
        let x1R = this.dcX1R;
        let y1R = this.dcY1R;
        let gain = this.gain;
        let level = this.level;

        for (let s = 0; s < frames; s++) {
            const rawL = table[readIdx];
            const rawR = table[readIdxR];
            if (++readIdx >= tableLen) readIdx = 0;
            if (++readIdxR >= tableLen) readIdxR = 0;

            // DC blocker (one-pole HPF), independent per channel
            const dcL = rawL - x1 + dcR * y1;
            x1 = rawL;
            y1 = dcL;
            const dcRch = rawR - x1R + dcR * y1R;
            x1R = rawR;
            y1R = dcRch;

            // soft clip, then gain ramp (research §4 order)
            gain += (this.targetGain - gain) * gainCoeff;
            const yL = Math.tanh(dcL) * gain;
            const yR = Math.tanh(dcRch) * gain;

            const aL = yL < 0 ? -yL : yL;
            const aR = yR < 0 ? -yR : yR;
            const a = aL > aR ? aL : aR;
            if (a > level) level = a;

            ch0[s] = yL;
            if (ch1) ch1[s] = yR;
        }

        // any further channels (>2) get the left signal
        for (let c = 2; c < out.length; c++) out[c].set(ch0);

        this.readIdx = readIdx;
        this.readIdxR = readIdxR;
        this.dcX1 = x1;
        this.dcY1 = y1;
        this.dcX1R = x1R;
        this.dcY1R = y1R;
        this.gain = gain;

        // periodic waveform + level snapshot to the main thread (~15 Hz)
        this.waveCounter += frames;
        if (this.waveCounter >= this.wavePeriod) {
            this.waveCounter = 0;
            const scratch = this.waveScratch;
            const stride = tableLen / WAVE_LEN;
            for (let i = 0; i < WAVE_LEN; i++)
                scratch[i] = table[(i * stride) | 0];
            this.port.postMessage({ type: "wave", data: scratch, level });
            this.level = 0;
        } else {
            this.level = level;
        }

        return true;
    }
}

registerProcessor("wavetable-player", WavetablePlayer);
