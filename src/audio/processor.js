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
// Pitch = sampleRate / table length; table length = Region cell count (ADR 0002).

const CELL_AMP = 0.9; // ± table amplitude (conservative; §3 + limiter net)
const WAVE_LEN = 248; // decimated waveform-strip width (research §5)
const WAVE_HZ = 15; // snapshot rate to the main thread

class WavetablePlayer extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const o = (options && options.processorOptions) || {};
        this.alloc(o.regionSize || 64);
        this.readIdx = 0;

        // DC blocker (one-pole HPF ~20 Hz): R = 1 - 2*pi*fc/fs
        this.dcR = 1 - (2 * Math.PI * 20) / sampleRate;
        this.dcX1 = 0;
        this.dcY1 = 0;

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

    alloc(size) {
        this.tableLen = size * size;
        this.table = new Float32Array(this.tableLen);
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
                // or a single capture on pause). m.grid is a transferred buffer.
                const size = m.regionSize | 0;
                if (size && size * size !== this.tableLen) {
                    this.alloc(size);
                    this.readIdx = 0;
                }
                this.fill(new Uint8Array(m.grid));
                break;
            }
            case "config":
                if (m.volume != null)
                    this.targetGain =
                        m.enabled === false ? 0 : Math.pow(10, m.volume / 20);
                if (m.enabled === false) this.targetGain = 0;
                break;
        }
    }

    process(_inputs, outputs) {
        const out = outputs[0];
        const ch0 = out[0];
        const frames = ch0.length;
        const { table, tableLen, dcR, gainCoeff } = this;
        let readIdx = this.readIdx;
        let x1 = this.dcX1;
        let y1 = this.dcY1;
        let gain = this.gain;
        let level = this.level;

        for (let s = 0; s < frames; s++) {
            const raw = table[readIdx];
            if (++readIdx >= tableLen) readIdx = 0;

            // DC blocker (one-pole HPF)
            const dc = raw - x1 + dcR * y1;
            x1 = raw;
            y1 = dc;

            // soft clip, then gain ramp (research §4 order)
            const clipped = Math.tanh(dc);
            gain += (this.targetGain - gain) * gainCoeff;
            const y = clipped * gain;

            const a = y < 0 ? -y : y;
            if (a > level) level = a;

            ch0[s] = y;
        }

        // mirror to the other channels (mono source)
        for (let c = 1; c < out.length; c++) out[c].set(ch0);

        this.readIdx = readIdx;
        this.dcX1 = x1;
        this.dcY1 = y1;
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
