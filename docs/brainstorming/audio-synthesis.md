# Brainstorming — Audio-Erweiterung

> Ablage: `docs/brainstorming/audio-synthesis.md`
> Stand: 2026-07-14 · Status: Recherche abgeschlossen, Implementierung offen

Ziel: aus dem rein visuellen CA-Sketch einen audio-visuellen machen. Ein **Ausschnitt des laufenden Automaten wird in einen Audio-Buffer geschrieben und via Web Audio wiedergegeben**. Ästhetik: Glitch-Noise — Ryoji Ikeda, Raster-Noton, alva noto. Nicht „Sonifikation als Melodie", sondern _Daten als Klangmaterial_.

---

## 1. Referenz-Analyse

### tonemata (kentaro.tools) — CA-based granular noise generator

VST3/AU. Laut Produktbeschreibung: Wavetables werden von schnellen 1D-CA-Regeln generiert und fortlaufend aktualisiert; eine latenzfreie **Granular-Engine ist auf Sample-Ebene an den CA-Clock gekoppelt** und eng mit dem Regelwerk verzahnt. Das Display trackt den Wavetable-Zustand in Echtzeit — die audio-visuelle Kopplung ist explizit Teil des Konzepts, nicht Deko.

**Übertragbar:** CA schreibt Table, Playback-Engine liest sie — zwei gekoppelte, aber getrennte Prozesse. Der CA-Takt ist eine _Audio-Rate-Clock_, kein Frame-Takt.

### YouTube `azmCM3vBBAQ` — „cellular automata with audio clock precision" (Mai 2024)

Prototyp-Demo aus demselben Umfeld. Kernaussage der Beschreibung: **das Synchronisieren der CA-Updates mit der Audio-Clock reduziert das signifikante (unkontrollierte) Rauschen**; weiteres Experimentieren nötig, viel unerschlossenes Potenzial.

**Die zentrale technische Erkenntnis dieses Researches:** Wird der CA im Visual-Takt (rAF, ~60 Hz, jitternd) gesteppt und asynchron in einen Audio-Buffer kopiert, entstehen unkontrollierte Diskontinuitäten — Rauschen, das man _nicht gestalten_ kann. Steppt man ihn dagegen **im Audio-Thread an Sample-Grenzen** (alle N Samples eine Generation), werden die Übergänge deterministisch: **das Glitchen wird vom Bug zum Parameter.** Konsequenz für uns: die _klingende_ CA-Instanz gehört in den AudioWorklet, nicht in den Main-Thread.

### Reaktor UL #5241 — „Aliasing Synth"

Esoterischer Drone/Noise-Klassiker. Mechanik (laut UL-Text und scsynth-Thread): **eine Audiotable wird gleichzeitig beschrieben und gelesen — mit absichtlich „achtlosen", unterschiedlichen Geschwindigkeiten.** Die daraus entstehenden Fehler (Read/Write-Kollisionen, Aliasing) _sind_ der Klang. Feinste Speed-Änderungen erzeugen dramatische Klangänderungen. Kein MIDI — eine Noise-Maschine, aus der man Material sampelt.

**Übertragbar:** Read/Write-Race auf derselben Table als eigener Klangmodus. Trivial (zwei Phasoren, ein Ring-Buffer), enormer Ertrag — und passt, weil unser CA die Table ohnehin ständig neu beschreibt.

### Ikeda / Raster-Noton — Klangvokabular

Sinustöne an den Hörgrenzen (sehr hoch; sehr tief als Sub), Impuls-Clicks und Click-Trains, harte Noise-Bursts, **binäres Gating (an/aus ohne Fades)**, extreme Dynamik inkl. echter Stille, harte Stereo-Trennung, Präzision als Statement. Wichtig: das Material ist _arm_ (Sinus, Click, Noise) — die Komplexität kommt aus Rhythmus und Schaltung. Unser binärer CA liefert genau das: 0/1-Übergänge sind Clicks, Zeilen sind Pulse-Trains, Dichten sind Gates.

### Synthese

|              | tonemata                                      | Audio-Clock-Video             | Aliasing Synth                    |
| ------------ | --------------------------------------------- | ----------------------------- | --------------------------------- |
| CA-Rolle     | schreibt Wavetable                            | wird sample-synchron gesteppt | (kein CA — Race als Fehlerquelle) |
| Klangquelle  | Granular über CA-Table                        | CA-Zustand direkt             | Read/Write-Kollisionen            |
| Clock-Domäne | Audio (sample-locked)                         | Audio                         | Audio                             |
| Lehre        | Table + Engine trennen, Table sichtbar machen | CA in den Worklet             | Race-Modus einbauen               |

**Alle drei operieren vollständig in der Audio-Clock-Domäne. Keine überträgt Visual-Frames in Audio.** Das ist die wichtigste Einzelerkenntnis — und die Hauptabweichung von der naiven Umsetzung („Canvas-Ausschnitt jede Frame in einen Buffer kopieren").

---

## 2. Sonifikations-Design-Raum

Der Rahmen (Ausschnitt → Buffer → Playback) ist richtig. Vier tragfähige Mappings, aufsteigend nach Aufwand:

### A. Region-Scan als Wavetable (Basis)

Ausschnitt (z. B. 64×64) wird zeilenweise (raster-scan) in eine Table geschrieben: Zelle 1 → `+g`, Zelle 0 → `−g`. Ein Phasor liest sie als Loop.

Rechnung: 64×64 = 4096 Samples @ 48 kHz → bei Rate 1× ein **~11,7-Hz-Loop** = rhythmisches Klicken/Knattern (sehr Ikeda). Höhere Raten pitchen ins Tonale; die **Zeilenperiodizität (64 Samples) erzeugt einen Träger bei ~750 Hz** mit Kammstruktur. Unsere Plaid-Muster sind quasi-periodisch → harmonische Kämme mit glitchenden Brüchen an den Webkanten. Der CA-Fortschritt schreibt die Table neu → spektrale Animation.

### B. Read/Write-Race (Aliasing-Modus)

Wie A, aber Ring-Buffer: Write-Phasor schreibt den Region-Scan mit Rate `W`, Read-Phasor liest mit Rate `R ≠ W`. Kollisionen = Aliasing-Synth-Verhalten. **`W/R`-Verhältnis („Drift") ist der Haupt-Performance-Parameter** — die Referenz sagt: feinste Bewegungen um 1.0 = dramatische Änderungen, also dort sehr feine Slider-Auflösung. Mehrkosten gegenüber A: minimal.

### C. Audio-Clock-CA (Präzisions-Modus — die tonemata/Video-Erkenntnis)

Der Worklet führt eine **eigene CA-Instanz** (Kopie des Ausschnitts inkl. Regel), gesteppt **alle N Samples**. `N` = „samples per generation" wird zum Klangparameter:

- N groß (≥ 2048) → langsame Texturmorphs
- N klein (64–256) → **der CA _ist_ der Oszillator, die Regel wird hörbar**

Budget: 64×64 = 4096 Zellen; bei N=64 → 4096 × 750 = ~3 M Zell-Updates/s. Unser Kernel liegt bei ~0,25 ns/Zelle → unkritisch. Zum Vergleich: das **600×600-Voll-Grid ist nicht audio-rate-fähig** (~4 ms/Step). Der Ausschnitt ist also nicht nur UX-, sondern auch Performance-Entscheidung.

Praktisch: unsere `CA`-Klasse ist bereits parametrisiert und dependency-arm — sie läuft im Worklet, wenn man den `@thi.ng/pixel`-Teil (nur Rendering) abtrennt. **TODO beim Umsetzen:** Rendering aus `CA` herausziehen oder Konstruktor-Flag `headless` einführen, damit der Worklet keinen IntBuffer allokiert.

### D. Event-Layer (Ikeda-Schicht)

Zusätzlich zum Table-Playback: Zell-_Ereignisse_ werden direkt geschaltet — Geburten → 1-Sample-Impulse (Clicks), Live-Dichte → Gate/Amplitude eines Sub-Sinus, Kantendichte → Noise-Anteil. Billig (fällt im CA-Step ohnehin an) und liefert die **Dynamik-Schicht (Stille ↔ Burst)**, die reines Wavetable-Scanning nicht hat.

### Verworfen

- **FFT-Mappings** (Region als Spektrum + iFFT) — klanglich weichgespült, widerspricht der harten Binär-Ästhetik.
- **MIDI-/Noten-Mappings** — falsches Genre.

---

## 3. Das größte klangliche Risiko

**Statische Perioden.** Unsere kuratierten Keeper-Regeln konvergieren in quasi-stationäre Gewebe (genau deshalb sehen sie gut aus). Als reine Wavetable heißt das: **nach dem Einschwingen ein stehender, harmonischer Ton statt Glitch.**

Gegenmittel sind exakt B (Race-Drift), C (kleines N) und D (Event-Layer). Deshalb: **B gehört in den MVP, nicht in Phase 2.** Ein MVP mit nur A wäre eine hübsche Enttäuschung.

Weitere Risiken:

- **Lautheits-Unfälle** — binäre Vollausschlag-Tables sind brutal. Limiter + konservativer Default (−18 dB) + Gain-Ramps sind nicht optional.
- **DC-Offset** — eine überwiegend „lebendige" Region ist fast reiner DC. HPF zwingend (s. u.).
- **Safari** — Blob-Worklet + AudioContext-Eigenheiten. Expliziter Testpunkt, keine Annahme.

---

## 4. Technische Architektur

### AudioWorkletProcessor, kein ScriptProcessorNode

(Letzterer ist deprecated und läuft im Main-Thread → genau der Jitter, den die Referenzen eliminieren.)

Signalkette **im Worklet**:

```
Table-Read → DC-Blocker (One-Pole-HPF ~20 Hz) → Soft-Clip → Gain-Ramp (~10 ms, click-frei)
```

Nativer Graph: `workletNode → destination`, optional `DynamicsCompressorNode` als Limiter-Sicherheitsnetz.

**Nie in `process()` allokieren.** Double-Buffer im Worklet, Swap bei Message-Empfang.

### Zwei harte Plattform-Constraints (bestimmen das Design)

**1. SharedArrayBuffer scheidet aus.** SAB braucht Cross-Origin-Isolation (COOP `same-origin` + COEP `require-corp`), also Response-Header — die ein via `file://` geöffnetes oder header-los gehostetes Single-File-HTML nicht setzen kann. **Konsequenz:** Transport via `port.postMessage` mit **Transferable ArrayBuffers** (Zero-Copy-Ownership-Transfer).

Budget: 64×64 = 16 KB pro Visual-Generation @ 60 Hz ≈ 1 MB/s → unkritisch.

_(Auf GitHub Pages ließen sich COOP/COEP übrigens auch nicht setzen — Pages erlaubt keine Custom-Header. Das Design muss also ohnehin ohne SAB funktionieren.)_

**2. Worklet-Modul-Ladung im Single-File-Build.** `audioWorklet.addModule(url)` braucht eine URL. Lösung: Prozessor-Quelle als `?raw`-Import inline bundeln, dann

```ts
const blob = new Blob([processorSrc], { type: "text/javascript" });
await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
```

In Chromium/Firefox etabliert; **Safari hat hier historisch Eigenheiten → Verifikationsliste**, Fallback `data:`-URL. So bleibt auch `build:single` ein einziges HTML.

### Clock-Domänen — Phasenwechsel

- **MVP (A/B):** CA bleibt visuell getaktet (rAF), Worklet konsumiert Table-Updates asynchron. Das _hat_ den vom Video beschriebenen Jitter — aber im Scan/Race-Modus dominieren die Race-Kollisionen klanglich ohnehin, der Jitter geht in der Textur auf.
- **Phase 2 (C):** klingende CA läuft im Worklet an Sample-Grenzen. Main-Thread sendet nur noch Seeds („Capture Region"), Regel-Änderungen, Parameter.

Dann existieren **zwei CA-Instanzen** — die visuelle und die klingende. Das ist **bewusst kein Bug**: die Referenz-Tools trennen genauso. Perfekte Dauer-Kongruenz von Bild und Klang ist mit Audio-Clock-Präzision prinzipiell unvereinbar; **Momente der Kongruenz (Capture) sind das Interaktionsmodell.**

### Performance-Budget (128-Frame-Quantum @ 48 kHz = 2,7 ms)

|                              | Kosten                                             |
| ---------------------------- | -------------------------------------------------- |
| 128 Table-Reads + HPF + Clip | trivial                                            |
| Race-Modus: +128 Writes      | trivial                                            |
| Audio-Clock-CA 64×64 @ N=64  | 2 Steps/Quantum à 4096 Zellen ≈ 8k Ops → **< 1 %** |

Headroom für Mehrstimmigkeit (mehrere Regionen) ist da.

---

## 5. GUI-Integration

### Region-Selektion auf dem Canvas

Sichtbarer **Selektionsrahmen** im bestehenden Blau (`#3b3bff`), per Drag verschiebbar. Größe **nicht frei, sondern gestuft (32 / 64 / 128)** — hält Buffer-Größen auf Zweierpotenzen (saubere Periodizitäten, FFT-tauglich) und erspart Resize-Handles auf 600-px-Zellen.

**Konflikt mit dem Zeichnen** (wichtig): Drag _im_ Rahmen zeichnet weiter, Drag _am_ Rahmen (schmale Hit-Zone) verschiebt; Alt+Drag verschiebt von überall. Rahmen existiert nur bei aktivem Audio — **ohne Audio bleibt der Sketch exakt wie bisher.**

### Panel-Sektion „Audio"

Neu, unterhalb des Pencil-Blocks, **zusammenklappbar** (Details-Pattern), damit das Panel ohne Audio nicht wächst:

- **Power-Toggle** (▸ Audio) — startet/resumed den AudioContext. _Autoplay-Policy: braucht zwingend User-Geste — der Toggle **ist** die Geste._
- **Volume** — Default konservativ (−18 dB)
- **Mode** — Segmented „Scan / Race" (analog zum bestehenden Draw/Erase-Pattern)
- **Rate** — logarithmisch, ±3 Oktaven um 1×
- **Drift** (nur Race) — W/R-Verhältnis, **sehr feine Auflösung um 1.0**
- **Region Size** — 32 / 64 / 128
- **Level-Meter** — schmale Leiste

Dazu ein **Waveform-Strip** (Mini-Canvas ~248×40 px): zeichnet die _klingende_ Table. Das ist die tonemata-Lehre — die audio-visuelle Kopplung wird nicht nur behauptet, sondern gezeigt. Worklet postet dekimierte Snapshots zurück (~15 Hz reicht).

Keyboard: **`a` = Audio an/aus.** Bestehende Shortcuts unverändert.

### Zustand

Audio-Parameter als eigener Slice in den `defAtom` — und **wie `brush`/`tool` NICHT Teil der Reset-Defaults** (Reset betrifft die Simulation, nicht das Instrument).

**`gen$`/`fps$`-Prinzip gilt weiter:** hochfrequente Meter-/Waveform-Daten laufen als Streams am Atom vorbei.

**Und die Falle nicht vergessen:** jede neue Atom-Reaktion braucht `dedupe(equiv)`, nicht `dedupe()`.

---

## 6. Phasenplan

### Phase 1 — MVP „Scan + Race"

Region-Rahmen (64×64, verschiebbar) · Worklet mit Table + zwei Phasoren · Modi Scan/Race · Transport via Transferables · DC-Block + Limiter + Ramps · Panel-Sektion (Power/Volume/Mode/Rate/Drift/Size) · Waveform-Strip · Taste `a`.

→ Kern-Erfahrung vollständig: _der Ausschnitt klingt, und Drift macht ihn kaputt auf die gute Art._

### Phase 2 — Audio-Clock-CA

CA-Instanz in den Worklet (`headless`-Variante) · „samples per generation" als Parameter · Capture-Button. Bringt die Präzisions-Ästhetik der Referenzen und **löst das Statik-Risiko strukturell**.

### Phase 3 — Ikeda-Layer & Capture

Event-Clicks · Sub-Gate · Noise-Layer mit Mixer · **WAV-Recording** (Worklet-Capture → Download, analog zum bestehenden Download-PNG-Pattern) · optional zweite Region = zweite Stimme, hart gepannt.

Jede Phase ist einzeln shipbar.

---

## 7. Offene Fragen für den ersten Prototyp

Usability-Check nach Phase 1 — fünf Minuten selbst spielen, drei Fragen:

1. Findet man den Rahmen?
2. Verschiebt man ihn versehentlich beim Zeichnen? (Hit-Zonen-Tuning)
3. Versteht man Scan vs. Race ohne Doku?

Klanglich offen: ob die Keeper-Regeln als Wavetable _interessant genug_ sind oder ob man für Audio einen **eigenen Regel-Pool** braucht (die für Optik verworfenen Bänder-/Flut-Regeln könnten klanglich reizvoll sein — dichte Flut = Rauschteppich, Bänder = starke Periodizität). **Nicht vorschnell ausschließen: der visuelle Filter ist kein Audio-Filter.**

---

## Quellen

tonemata-Produktseite (kentaro.tools/tonemata) · YouTube `azmCM3vBBAQ` „cellular automata with audio clock precision" (Mai 2024 — Titel + Beschreibung; Videoinhalt selbst nicht maschinell abrufbar, Aussagen daher auf die Beschreibung gestützt) · Reaktor UL #5241 „Aliasing Synth" via scsynth.org-Thread „Replicating Aliasing Synth" (Feb 2024) und dogsonacid.com-Thread (2010) · MDN: SharedArrayBuffer / Cross-Origin-Isolation · Chrome Labs Web-Audio-Samples (AudioWorklet Design Patterns).
