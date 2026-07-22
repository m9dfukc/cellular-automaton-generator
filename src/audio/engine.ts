// Main-thread audio engine: owns the AudioContext, loads the worklet, builds
// the node graph, and plumbs messages both ways. The worklet source is
// imported verbatim (`?raw`) and loaded from a Blob URL, with a data: URL
// fallback for the `file://` single-file case (handoff Risk 1, verified).
//
// The worklet is a pure wavetable player (ADR 0005) — the engine feeds it Region
// seeds and a volume; there is no tempo/rule/mode on the audio side.

import processorSrc from "./processor.js?raw";
import { level$, wave$ } from "../state.js";

export class AudioEngine {
    private ctx: AudioContext | null = null;
    private node: AudioWorkletNode | null = null;
    running = false;

    /** Start the context + graph. The call must originate from a user gesture
     * (the `a` keypress) so `resume()` is allowed by the autoplay policy. The
     * `seed`'s byte length is the initial table length (one cell = one sample). */
    async start(volume: number, width: number, seed: ArrayBuffer): Promise<void> {
        const ctx = new AudioContext();
        this.ctx = ctx;

        try {
            const url = URL.createObjectURL(
                new Blob([processorSrc], { type: "text/javascript" }),
            );
            await ctx.audioWorklet.addModule(url); // http origins
            URL.revokeObjectURL(url);
        } catch {
            await ctx.audioWorklet.addModule( // file:// origin
                "data:text/javascript;charset=utf-8," +
                    encodeURIComponent(processorSrc),
            );
        }

        const node = new AudioWorkletNode(ctx, "wavetable-player", {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { length: seed.byteLength },
        });
        this.node = node;

        node.port.onmessage = (e) => {
            const m = e.data;
            if (m.type === "wave") {
                wave$.next(m.data as Float32Array);
                level$.next(m.level as number);
            }
        };

        // limiter safety net (research §4): worklet -> compressor -> destination
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.25;
        node.connect(limiter).connect(ctx.destination);

        this.running = true;
        // seed first so the table isn't silent, then enable the gain
        node.port.postMessage({ type: "seed", grid: seed }, [seed]);
        this.setConfig(volume, width);
        await ctx.resume(); // inside the `a` gesture
    }

    setConfig(volume: number, width: number): void {
        if (!this.node) return;
        this.node.port.postMessage({
            type: "config",
            volume,
            width,
            enabled: true,
        });
    }

    /** Push a fresh Region into the worklet, transferring the backing buffer.
     * The buffer's byte length becomes the table length (any W×H rectangle). */
    pushSeed(grid: ArrayBuffer): void {
        if (!this.node) return;
        this.node.port.postMessage({ type: "seed", grid }, [grid]);
    }

    /** Stop and release the context (idempotent). */
    async stop(): Promise<void> {
        this.running = false;
        const ctx = this.ctx;
        this.ctx = null;
        this.node = null;
        if (ctx) await ctx.close();
        level$.next(0);
    }
}
