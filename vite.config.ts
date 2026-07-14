import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
declare const process: { env: Record<string, string | undefined> };

export default defineConfig(({ mode }) => ({
    // Single-file build (everything inlined into one index.html) when
    // `--mode singlefile`, otherwise a normal chunked dist.
    base: process.env.GITHUB_ACTIONS ? "/cellular-automaton-generator/" : "./",
    plugins: mode === "singlefile" ? [viteSingleFile()] : [],
    build: {
        target: "es2020",
        assetsInlineLimit: 100000000,
    },
}));
