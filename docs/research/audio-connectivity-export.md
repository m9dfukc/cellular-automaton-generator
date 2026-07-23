# Audio Connectivity & Export — Primary-Source Survey

> Research doc · 2026-07-23 · primary-source survey
> Companion to [`audio-synthesis.md`](./audio-synthesis.md) and [`audio-libraries.md`](./audio-libraries.md), and the `poc-audio-synthesis` branch (`src/audio/engine.ts`, `src/audio/processor.js` — a Blob-loaded AudioWorklet wavetable player).

## Question

How can this browser-based Web Audio + Canvas app connect to the "outside world" (tempo sync with a DAW / Ableton Link) and export its output (audio, and audio+video social clips)? Every option is judged against the project's hard constraints.

## Hard constraints (these gate every option)

1. **Single-file build.** `build:single` inlines everything into ONE HTML file that must run from `file://` and GitHub Pages — **no custom HTTP headers, no server.** This kills anything needing COOP/COEP response headers, a WebSocket/HTTP server you must host, or a backend.
2. **No `SharedArrayBuffer`** — no cross-origin isolation available (COOP `same-origin` + COEP `require-corp` cannot be set on `file://` or GitHub Pages).
3. **Client-side only** for the core app. An option that needs a helper server/native bridge is allowed only as a clearly-labelled *optional tier*, never a core dependency.
4. **Bundle size matters** — report sizes where findable.

---

## 1. Ableton Link in the browser — is it even possible?

**Verdict up front: NOT possible client-side. Feasible only via a local native helper process — never from a single-file page alone.**

### What Link's wire protocol is

Ableton Link is a **header-only C++ library**, "dual licensed under GPLv2+ and a proprietary license" ([README](https://github.com/Ableton/link)). Its discovery and sync ride **UDP multicast on the local subnet**: Ableton's own transport header `UdpMessenger.hpp` defines `multicastEndpointV4()` / `multicastEndpointV6()`, listens via `mpImpl->listen(MulticastTag{})`, and sends peer state to the multicast endpoint (`sendPeerState(v1::kAlive, multicastEndpointV4())`) — [include/ableton/discovery/UdpMessenger.hpp](https://github.com/Ableton/link/blob/master/include/ableton/discovery/UdpMessenger.hpp). The default group/port is `224.76.78.75:20808` ("LNK"). To be a Link peer, a process must join that multicast group and exchange raw UDP datagrams.

### Browsers cannot do that

No browser web API can open a raw UDP socket or join a multicast group:

- **`RTCDataChannel`** is not raw UDP — it is SCTP-over-DTLS-over-UDP and is always bound to an `RTCPeerConnection` (ICE + signaling). MDN: the transport is `"UDP/DTLS/SCTP"` or `"TCP/DTLS/SCTP"`, and "Every data channel is associated with an RTCPeerConnection" ([MDN RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel)). It cannot address a multicast group or emit Link's datagrams.
- **`WebTransport`** is QUIC/HTTP3 over UDP but only to an HTTP/3 **server** — no arbitrary UDP, no LAN multicast. MDN: it "provides functionality to enable a user agent to connect to an HTTP/3 server" ([MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport)).
- **`WebSocket`** is TCP-only and requires a server you host ([MDN, Writing WebSocket servers](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers)).

A WASM build of Link would not help: WASM in the browser has no more socket access than JS, so it still cannot open the multicast socket the protocol needs. No WASM port of Link exists on GitHub anyway.

### Bridge approaches — all need a native process on the user's machine

- **Carabiner** ([github.com/Deep-Symmetry/carabiner](https://github.com/Deep-Symmetry/carabiner)) — "A loose connector for interacting with Ableton Link." Ships **precompiled native executables** (macOS / Windows x64 / Linux x64 / Raspberry Pi) and exposes a text/EDN protocol over **TCP** (default port 17000). It is a separate native process; a browser still can't open raw TCP to it, so it also needs a local WebSocket shim.
- **npm packages are all Node native addons** compiled from Ableton's C++ via node-gyp — none run in a browser: `abletonlink` (2bbb) [npm](https://www.npmjs.com/package/abletonlink) / [src](https://github.com/2bbb/node-abletonlink) (C++ 89.8%, `npm install` runs `node-gyp rebuild`); `abletonlink-addon` ([src](https://github.com/Onni97/abletonlink-node-addon)); `@ktamas77/abletonlink` ([npm](https://www.npmjs.com/package/@ktamas77/abletonlink), a TS wrapper over "the native Ableton Link C++ SDK … Node.js Native Addon"); `@volst/abletonlink` ([npm](https://www.npmjs.com/package/@volst/abletonlink), fork of 2bbb).
- **"AbletonLinkJS"** — no package or repo by that exact name exists on npm or GitHub. The JS Link ecosystem is the node-gyp native addons above.

**Verdict:** In-browser Link is **(b) only via a local native helper.** A single-file page can never be a Link peer (no raw UDP / multicast). It becomes possible only if the user runs a native helper (Carabiner, or a Node addon build of Link) that does the real UDP multicast and bridges to the page over WebSocket. That breaks the "client-side only, no server" constraint, so it belongs strictly in an optional tier and should not be a near-term goal.

---

## 2. If not Link, what clock/sync IS available in-browser?

**Web MIDI clock is the realistic sync path — but only on Chromium and Firefox, never Safari.**

### Web MIDI can send/receive raw MIDI including realtime clock

The Web MIDI API lets a page enumerate inputs/outputs (`MIDIAccess.inputs` / `.outputs`), send raw bytes via `MIDIOutput.send(data)`, and receive via `MIDIInput.onmidimessage` ([MDN Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API); [W3C Web MIDI spec](https://webaudio.github.io/web-midi-api/)). `send()` takes an arbitrary byte sequence, so the API is **byte-transparent** — nothing blocks MIDI System Real-Time messages:

- **`0xF8` Timing Clock** (24 pulses per quarter note), **`0xFA` Start**, **`0xFB` Continue**, **`0xFC` Stop**.

The app can therefore act as a **MIDI clock master** — emit 24× `0xF8` per quarter note plus start/stop — or as a **follower**, counting incoming `0xF8` from `onmidimessage`. This maps cleanly onto ADR 0001's master tempo grid (BPM + subdivisions). The tempo maths already live in the audio state atom; MIDI clock is just an output/input mapping of that clock.

### Permissions & secure context

`navigator.requestMIDIAccess({ sysex })` returns a promise; the API is a **secure-context feature** and is gated by the `midi` Permissions-Policy and a user permission ([MDN Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)). System Real-Time clock bytes are **not** SysEx, so `sysex: true` is not required for clock sync (SysEx needs the extra permission). Secure context includes `https://` and `file://` and `localhost`, so GitHub Pages (HTTPS) and a locally opened single file both qualify.

### Browser support (decisive)

- **Chrome / Edge / Opera (Chromium):** supported (Chrome since v43, 2015). This is the primary target. ([MDN compat](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API#browser_compatibility))
- **Firefox:** shipped Web MIDI in **Firefox 108 (Dec 2022)**, behind a user permission prompt (and historically a site-permission add-on for SysEx). Usable for clock. (MDN marks the API "Limited availability / not Baseline" precisely because of the gaps below.)
- **Safari:** **not supported** — no released Safari (through early 2026) implements Web MIDI. `navigator.requestMIDIAccess` is absent. *(If a future Safari ships it, re-verify on MDN compat.)*

MDN's overall status line for the API: **"Limited availability … not Baseline because it does not work in some of the most widely-used browsers"** ([MDN Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)) — that "some widely-used browsers" is Safari.

### MIDI clock to a DAW via a virtual/loopback port — fully client-side

On macOS the **IAC Driver** (Audio MIDI Setup → MIDI Studio → enable "IAC Driver / Device is online") creates a virtual MIDI bus; the page's `MIDIOutput` targets the IAC port and a DAW (Ableton, Logic, etc.) receives the clock — no server, no native helper code to write, only an OS setting the user enables ([Apple, Audio MIDI Setup / IAC](https://support.apple.com/guide/audio-midi-setup/welcome/mac)). Windows has no built-in loopback; users install **loopMIDI** (third-party) as the analog. This is the one path that syncs a DAW **fully client-side** from a single-file page — the browser writes MIDI clock, the OS routes it. It works only where Web MIDI works (so Chromium/Firefox, not Safari), and requires the user to enable IAC/loopMIDI once.

### Other tempo options

- **Tap tempo** and **manual BPM entry** are trivial app-side (no API) and are the universal fallback — especially the only tempo affordance on Safari, which has neither Web MIDI nor Link.

---

## 3. Audio recording & export (client-side)

### Real-time capture: MediaRecorder + MediaStreamAudioDestinationNode

`AudioContext.createMediaStreamDestination()` returns a `MediaStreamAudioDestinationNode` whose `.stream` is a `MediaStream` carrying the graph's audio ([MDN MediaStreamAudioDestinationNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode)). Feed that stream to `MediaRecorder` ([MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder); [W3C MediaStream Recording](https://w3c.github.io/mediacapture-record/)) and you get a downloadable blob. Container/codec is **browser-dependent** (probe with `MediaRecorder.isTypeSupported()`, [MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported)):

- **Chrome (since v49) / Firefox (since v29):** `audio/webm;codecs=opus` (Firefox also `audio/ogg;codecs=opus`). No MP3/AAC out.
- **Safari (MediaRecorder since 14.1):** produces **`audio/mp4` (AAC)**, not WebM — Safari's MediaRecorder does not emit `audio/webm`. So a cross-browser recorder must branch on `isTypeSupported`. ([caniuse mediarecorder](https://caniuse.com/mediarecorder))

MediaRecorder records **in real time** (at playback speed), so it is simple but not deterministic — see §4 for the sync/jitter caveat, which applies equally to audio-only capture.

### Deterministic offline render: OfflineAudioContext (+ AudioWorklet)

`OfflineAudioContext` renders a graph **faster than real time** into an `AudioBuffer`, deterministically: `startRendering()` resolves with the finished buffer ([MDN OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext), [`startRendering`](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/startRendering)).

**AudioWorklet works inside OfflineAudioContext.** `audioWorklet` and `AudioWorkletNode` are defined on `BaseAudioContext`, the shared superclass of both `AudioContext` and `OfflineAudioContext` ([MDN BaseAudioContext.audioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/audioWorklet)) — so the project's existing `wavetable-player` processor (`src/audio/processor.js`) can be instantiated in an offline context and rendered to a buffer with no code change to the DSP. This is the **quality/export path**: reproducible, no rAF jitter, faster than real time.

Then encode the rendered `AudioBuffer`'s channel data to **WAV** with **`@thi.ng/dsp-io-wav`** (`wavByteArray`, already identified in [`audio-libraries.md`](./audio-libraries.md); [npm](https://www.npmjs.com/package/@thi.ng/dsp-io-wav)) and download it — matching the existing download-PNG pattern. Pure ESM, already in-ecosystem, no SAB, single-file-safe.

### WAV vs compressed export

WAV is lossless, trivially encoded client-side, and large (≈10 MB/min stereo 16-bit @ 48 kHz). For sharing you may want a compressed encoder:

| Encoder | Codec | Type | License | Needs SAB? | Notes |
| --- | --- | --- | --- | --- | --- |
| **`@thi.ng/dsp-io-wav`** | WAV (PCM) | pure ESM | Apache-2.0 | No | Already the recommended default. Tiny. [npm](https://www.npmjs.com/package/@thi.ng/dsp-io-wav) |
| **`@breezystack/lamejs`** | MP3 | pure JS | LGPL-3.0 | No | Maintained fork of `lamejs` (`zhuker/lamejs`, [repo](https://github.com/zhuker/lamejs)); ~tens of KB min; runs anywhere incl. worklet-adjacent worker. Single-file-OK. [npm](https://www.npmjs.com/package/@breezystack/lamejs) |
| **opus-recorder** | Opus (Ogg) | WASM (libopus in a Worker) | libopus BSD + MIT wrapper | No (uses Worker + postMessage, not SAB) | [github.com/chris-rudmin/opus-recorder](https://github.com/chris-rudmin/opus-recorder). **Unmaintained** (repo notice: "no longer being maintained … webcodecs API … replaces the need for wasm codecs"; last v8.0.5, Oct 2021). Larger (WASM libopus). |
| **WebCodecs `AudioEncoder`** | AAC / Opus / FLAC / MP3 | native | — | No | [MDN AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder); codec strings in the [W3C WebCodecs codec registry](https://www.w3.org/TR/webcodecs-codec-registry/). Chrome/Edge 94+, Firefox 130+, Safari partial 16.4–18.7 / full 26 ([caniuse](https://caniuse.com/webcodecs)). **Secure-context only.** Zero bundle weight when present. |

For a first export feature, **WAV via `@thi.ng/dsp-io-wav` from an OfflineAudioContext render** is the lowest-risk, single-file-clean, deterministic choice. MP3 (`@breezystack/lamejs`) is the natural "smaller file for sharing" add-on — pure JS, no SAB, LGPL (dynamic-link/attribution obligations, acceptable for an inlined lib but note the license).

---

## 4. Combined video + audio export (the social-media clip)

Highest-value near-term feature. Two fundamentally different paths.

### Path A — real-time capture (simple, ships first)

- **`HTMLCanvasElement.captureStream(frameRate?)`** returns a `MediaStream` with a live video track of the canvas ([MDN captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)). With no `frameRate`, or via `CanvasCaptureMediaStreamTrack.requestFrame()`, you drive frames manually for tighter timing ([MDN requestFrame](https://developer.mozilla.org/en-US/docs/Web/API/CanvasCaptureMediaStreamTrack/requestFrame)).
- **Combine A/V**: build one stream from the canvas video track plus the `MediaStreamAudioDestinationNode` audio track — `new MediaStream([videoTrack, audioTrack])` — and feed it to a single `MediaRecorder` → one file with synced A/V ([MDN MediaStream](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream/MediaStream), [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)).
- **Container/codec** follows §3: WebM/VP8/VP9+Opus on Chrome/Firefox; MP4/H.264+AAC on Safari (probe `isTypeSupported`). Chrome can also emit `video/mp4` with H.264+AAC on recent versions ([MDN isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported)).

**Caveat (must document):** MediaRecorder records **in real time**, tied to the wall clock and to `requestAnimationFrame` pacing — output frame rate and A/V alignment vary with rendering load and rAF jitter. It is **not frame-accurate or deterministic**. Good enough for a quick share clip; not for a clean, reproducible export.

### Path B — deterministic offline export via WebCodecs + a muxer (the quality path)

Render each CA frame and its matching audio block, encode both with exact timestamps, and mux at precise timing — no real-time capture, no jitter.

- **`VideoEncoder`** encodes a `VideoFrame` (constructible directly from the canvas) into `EncodedVideoChunk`s (H.264 `avc1.*` / VP9 `vp09.*` / AV1 `av01.*`); **`AudioEncoder`** encodes `AudioData` into AAC / Opus chunks. Timestamps are caller-supplied per frame → frame-accurate, decoupled from wall-clock, deterministic ([W3C WebCodecs spec](https://www.w3.org/TR/webcodecs/); [MDN VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder), [MDN AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder); probe configs with [`isConfigSupported()`](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)).
- **No SharedArrayBuffer / cross-origin isolation required.** Neither the WebCodecs spec nor MDN mentions COOP/COEP/`crossOriginIsolated`/SAB; `VideoFrame`/`AudioData` flow without shared memory. MDN lists WebCodecs only as a **secure-context** feature ([MDN VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder)). **This is the decisive difference from ffmpeg.wasm** and is what makes the quality path single-file-viable.
- **Mux** the encoded chunks into a container with a pure-JS muxer (no server):
  - **Mediabunny** — Vanilagy's unified successor that "entirely supersedes" the older muxers: "reading, writing, and converting media (MP4, WebM, MP3, HLS) directly in the browser." **MPL-2.0, zero dependencies, "extremely tree-shakable" → as small as ~5 KB gzipped**, WebCodecs-based, no SAB ([github.com/Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny)). Preferred for new work.
  - **`mp4-muxer`** / **`webm-muxer`** — the older standalone muxers, "MP4/WebM multiplexer in pure TypeScript with support for WebCodecs API", **MIT**, no deps, no SAB, but both **deprecated in favour of Mediabunny** ([mp4-muxer](https://github.com/Vanilagy/mp4-muxer), [webm-muxer](https://github.com/Vanilagy/webm-muxer)).
  - **`mp4box.js`** — GPAC's mux/demux toolkit, BSD-3-Clause ([github.com/gpac/mp4box.js](https://github.com/gpac/mp4box.js)). Heavier; more than needed for pure muxing.

**Browser support (WebCodecs encoders, [caniuse](https://caniuse.com/webcodecs)):**

- **Chrome / Edge:** `VideoEncoder`/`AudioEncoder` since **v94** (2021). Full support.
- **Firefox:** shipped WebCodecs (incl. `VideoEncoder`) in **v130** (2024), not behind a flag.
- **Safari:** partial from **16.4–18.7**; full WebCodecs from **Safari 26**. So a Safari fallback matters until 26 is broadly deployed.

Global support is ~92%, but MDN flags WebCodecs as **"Limited availability / not Baseline"** ([MDN VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder)) — so Path B needs a capability check and a Path-A (MediaRecorder) fallback.

**Secure-context / `file://` note:** WebCodecs (and `AudioEncoder`) require a secure context. HTTPS (GitHub Pages) qualifies. For a locally-opened single file, Chromium and Firefox treat `file://` origins as potentially-trustworthy secure contexts, so WebCodecs generally works there too — but this is browser-dependent and should be verified on the target browsers, since a non-secure `file://` treatment would disable the WebCodecs export path locally (MediaRecorder and WAV/MP3 still work).

### ffmpeg.wasm — INCOMPATIBLE with the single-file constraint

**`@ffmpeg/ffmpeg` (github.com/ffmpegwasm/ffmpeg.wasm)** requires **`SharedArrayBuffer`** for its multithread core — its own docs: *"As SharedArrayBuffer is required for multithread version, make sure you have fulfilled Security Requirements"* ([ffmpegwasm.netlify.app/docs](https://ffmpegwasm.netlify.app/docs/getting-started/usage/)). SAB in turn requires **cross-origin isolation**: MDN, *"To use shared memory your document must be in a secure context and cross-origin isolated"* — i.e. the COOP (`same-origin`) + COEP (`require-corp`) **response headers** ([MDN SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)). A `file://`-opened or header-less GitHub-Pages-hosted single file **cannot set those headers and cannot use `SharedArrayBuffer`** (constraints 1 & 2). The single-thread `@ffmpeg/core` avoids SAB ([ffmpeg.wasm overview](https://ffmpegwasm.netlify.app/docs/overview/)), but the WASM core is **tens of MB**, which kills the single-file/bundle-size constraint regardless. **Verdict: ffmpeg.wasm is out.** The **WebCodecs + muxer** path is the correct in-browser encoder/muxer and needs none of this.

### Social-media format requirements

For a portable share clip, **MP4 with H.264 video + AAC audio** is the safest cross-platform container/codec — accepted by all three major short-video platforms. Aspect ratio **9:16** (vertical) is the native short-form frame:

- **Instagram Reels:** vertical **9:16**, recommended **1080×1920** (min 600×1067), `.mp4`/`.mov`, **H.264 video + AAC audio**. ([Instagram Help](https://help.instagram.com/1038071743007909), [Meta Business specs](https://www.facebook.com/business/help/2222978001316177))
- **TikTok:** **MP4 or WebM**, 720×1280 or higher (**9:16** native; also 1:1 / 16:9). MP4/H.264/AAC is the compatible baseline. ([TikTok Support — creator tools](https://support.tiktok.com/en/using-tiktok/creating-videos/creator-tools-on-tiktok))
- **YouTube Shorts:** vertical, up to **3 minutes**, max 1080p ([YouTube Help — Shorts](https://support.google.com/youtube/answer/10059070)); YouTube's recommended encoding is container **MP4**, video **H.264**, audio **AAC-LC** ([YouTube upload encoding settings](https://support.google.com/youtube/answer/1722171)).

WebM/VP9 is **not** universally accepted (Instagram is H.264-centric), so **MP4 / H.264 / AAC** is the safe cross-platform baseline. *(Exact numbers change; re-check the cited official pages at implementation time.)*

**Practical implication:** target **MP4 / H.264 / AAC, 1080×1920 (9:16)** as the export default. That means Path B should encode H.264 + AAC into MP4 via `mp4-muxer`/Mediabunny; Path A (MediaRecorder) yields MP4 directly only on Safari/newer Chrome and WebM elsewhere, so WebM outputs may need a one-time transcode the app cannot do in-browser (no ffmpeg.wasm) — another reason the WebCodecs→MP4 path is the better long-term target.

---

## Feasibility matrix

| Option | In-browser? | Needs helper/server? | Single-file OK? | Browser support | Bundle |
| --- | --- | --- | --- | --- | --- |
| **Ableton Link (direct)** | No | — | **No** | none (no raw UDP) | — |
| **Ableton Link via native helper** (Carabiner / Node addon + WS shim) | Partly | **Yes — native process + local WS** | No | n/a | native binary |
| **Web MIDI clock (master/follower)** | Yes | No | Yes | Chrome/Edge/Firefox; **not Safari** | 0 (native API) |
| **MIDI clock → DAW via IAC/loopMIDI** | Yes | No (OS loopback, user enables) | Yes | as Web MIDI | 0 |
| **Tap tempo / manual BPM** | Yes | No | Yes | all | ~0 |
| **MediaRecorder audio (webm/opus, mp4/aac)** | Yes | No | Yes | all (codec varies; Safari=mp4/aac) | 0 |
| **OfflineAudioContext render + AudioWorklet** | Yes | No | Yes | all | 0 |
| **WAV export (`@thi.ng/dsp-io-wav`)** | Yes | No | Yes | all | tiny (Apache-2.0) |
| **MP3 export (`@breezystack/lamejs`)** | Yes | No | Yes | all | ~tens KB (LGPL) |
| **Opus export (opus-recorder)** | Yes | No | Yes (no SAB) | all | larger (WASM) |
| **WebCodecs `AudioEncoder`** | Yes | No | Yes (secure ctx) | Chrome/Edge 94+, FF 130+, Safari 16.4 partial / 26 full | 0 |
| **Canvas `captureStream` + MediaRecorder A/V** | Yes | No | Yes | all (real-time only, jittery) | 0 |
| **WebCodecs Video+Audio + Mediabunny muxer** | Yes | No | **Yes (no SAB)** | Chrome/Edge 94+, FF 130+, Safari 16.4 partial / 26 full | ~5 KB gz muxer (MPL-2.0) |
| **ffmpeg.wasm** | Yes | **No, but needs SAB/COOP+COEP** | **No** (breaks constraints 1 & 2) | Chromium/FF/Safari w/ isolation | multi-MB WASM |

---

## Tiered recommendation

**Tier 0 — ship first, fully client-side, no constraint risk:**
1. **Audio export = OfflineAudioContext render → WAV via `@thi.ng/dsp-io-wav`.** Deterministic, tiny, in-ecosystem, single-file-clean, reuses the existing worklet unchanged. This is the safest first export and directly serves Phase 3's WAV-recording goal.
2. **Tempo affordances that always work:** tap tempo + manual BPM (the only sync Safari can offer).
3. **Real-time A/V share clip = `canvas.captureStream()` + `MediaStreamAudioDestinationNode` → one `MediaRecorder`.** Zero dependencies, works everywhere, output codec branches on `isTypeSupported` (WebM/Opus on Chrome/FF, MP4/AAC on Safari). Accept and document that it is real-time and slightly jittery.

**Tier 1 — client-side, capability-gated (add after Tier 0):**
4. **Web MIDI clock out/in** for DAW sync (`0xF8`/start/stop), plus **IAC/loopMIDI** routing docs. Fully client-side, no server. Gate behind `requestMIDIAccess` presence; unavailable on Safari — fall back to tap tempo there.
5. **Deterministic A/V export = WebCodecs `VideoEncoder` + `AudioEncoder` + Mediabunny → MP4 (H.264 + AAC, 1080×1920 / 9:16).** The quality path: frame-accurate, no jitter, **needs no SAB/headers**, single-file-viable (Mediabunny is MPL-2.0, zero-dep, ~5 KB gz), and produces the cross-platform-safe MP4 that Reels/TikTok/Shorts all accept. Gate behind WebCodecs capability detection (and secure context) with the Tier-0 MediaRecorder path as fallback — notably on Safari < 26.
6. **MP3 export** via `@breezystack/lamejs` as a smaller-file option alongside WAV (mind LGPL).

**Optional tier — needs a native helper, not core:**
7. **Ableton Link** only via a user-run native helper (Carabiner or a Node addon) bridged over local WebSocket. Breaks "no server / client-side only," so document it as an advanced, opt-in integration, never a shipped default.

**Explicit verdicts:**
- **Ableton Link:** impossible from a single-file page (no raw UDP/multicast in any browser API); feasible **only** with a local native helper. Do not pursue for the core app; Web MIDI clock is the in-browser substitute.
- **A/V export:** ship **real-time MediaRecorder first** (simple, universal), then invest in **WebCodecs + muxer** for the deterministic, MP4, social-ready quality path. They share the same audio graph and canvas, so Path B is an additive upgrade, not a rewrite.
- **Constraint-breakers to avoid:** **ffmpeg.wasm** (requires SharedArrayBuffer + COOP/COEP headers → incompatible with `file://`/GitHub Pages single-file). Everything else recommended above works without SAB and without custom headers.

---

## Sources

**Ableton Link / networking**
- Ableton Link — [README (license, header-only C++)](https://github.com/Ableton/link) · [UdpMessenger.hpp (UDP multicast transport)](https://github.com/Ableton/link/blob/master/include/ableton/discovery/UdpMessenger.hpp)
- MDN [RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel) · [WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport) · [Writing WebSocket servers](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers)
- Carabiner (native bridge) — [github.com/Deep-Symmetry/carabiner](https://github.com/Deep-Symmetry/carabiner)
- Node native addons — [abletonlink (2bbb)](https://www.npmjs.com/package/abletonlink) · [node-abletonlink src](https://github.com/2bbb/node-abletonlink) · [abletonlink-node-addon](https://github.com/Onni97/abletonlink-node-addon) · [@ktamas77/abletonlink](https://www.npmjs.com/package/@ktamas77/abletonlink) · [@volst/abletonlink](https://www.npmjs.com/package/@volst/abletonlink)

**Web MIDI**
- MDN [Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) (+ [Browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API#browser_compatibility)) · W3C [Web MIDI API spec](https://webaudio.github.io/web-midi-api/)
- Apple [Audio MIDI Setup / IAC Driver](https://support.apple.com/guide/audio-midi-setup/welcome/mac)

**Audio recording / export**
- MDN [MediaStreamAudioDestinationNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode) · [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) · [MediaRecorder.isTypeSupported](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported) · W3C [MediaStream Recording](https://w3c.github.io/mediacapture-record/)
- MDN [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext) · [startRendering](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/startRendering) · [BaseAudioContext.audioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/audioWorklet)
- [`@thi.ng/dsp-io-wav`](https://www.npmjs.com/package/@thi.ng/dsp-io-wav) · [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) · [zhuker/lamejs](https://github.com/zhuker/lamejs) · [opus-recorder](https://github.com/chris-rudmin/opus-recorder) · MDN [AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder)

**Video + A/V export**
- MDN [HTMLCanvasElement.captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream) · [CanvasCaptureMediaStreamTrack.requestFrame](https://developer.mozilla.org/en-US/docs/Web/API/CanvasCaptureMediaStreamTrack/requestFrame) · [MediaStream()](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream/MediaStream)
- W3C [WebCodecs spec](https://www.w3.org/TR/webcodecs/) · MDN [VideoEncoder](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder) (+ [compat](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder#browser_compatibility)) · [AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder)
- Muxers — [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) · [webm-muxer](https://github.com/Vanilagy/webm-muxer) · [mediabunny](https://github.com/Vanilagy/mediabunny) · [mp4box.js](https://github.com/gpac/mp4box.js)
- [ffmpeg.wasm repo](https://github.com/ffmpegwasm/ffmpeg.wasm) · [ffmpeg.wasm docs (SAB / cross-origin-isolation requirement)](https://ffmpegwasm.netlify.app/docs/getting-started/usage/)

**Social platform specs**
- [Instagram Reels Help](https://help.instagram.com/1038071743007909) · [Meta Business Help](https://www.facebook.com/business/help/) · [TikTok Support](https://support.tiktok.com/) · [YouTube Shorts Help](https://support.google.com/youtube/answer/10059070)

## Open points to verify at implementation time

- **`file://` secure-context treatment** for WebCodecs on the specific target browsers (Chromium/Firefox generally treat `file://` as a secure context, but confirm — it decides whether the WebCodecs export path works when the single file is opened locally vs. only on GitHub Pages HTTPS).
- Exact **Safari** version for Web MIDI if a future release ships it (none through early 2026).
- Live **social-platform** resolution/duration/bitrate numbers (these change; re-check the cited official help pages).
- **LGPL** obligations for `@breezystack/lamejs` if MP3 export is shipped in the inlined single-file bundle.
