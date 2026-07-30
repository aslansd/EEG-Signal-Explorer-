# EEG Signal Explorer — review and changes

Two things happened here. Most of the listed bugs are ordinary defects. But the
central finding is different in kind: **almost nothing in the app was computed.**
The controls were wired to React state and to their own labels, and nothing else.
There was no filter, no FFT and no classifier anywhere in the codebase, so changing
the bandpass from 0.5–45 Hz to 8–12 Hz could not have altered a single pixel.

That is why this is a larger change than a bug-fix pass. Sections 1–3 are the
defects. Section 4 is the substitution of real computation for the lookup tables.
Section 5 lists the judgement calls you may want to overrule.

---

## 1. Correctness bugs

### Prediction probabilities did not sum to 1
`presets.ts:280`. `probabilities[label]` was read before it had been assigned, so
the `|| 0.85` fallback was used whenever the true label appeared later in the array
than the one being computed. Measured sums across the five sleep stages:

```
Wake  1.0000   N1  1.0150   N2  1.0300   N3  1.0450   REM  1.0600
```

The error grew with the true label's index. Now computed in two passes: assign the
winning class first, then distribute the remainder.

### The eye-blink waveform was biphasic, with a step discontinuity
`presets.ts:245`. The comment said "Bell shape for blink" but the expression was
`sin(frac(t) · π / 0.3)`, evaluated over a 0.3 s window starting at t=1.2. Traced
sample by sample:

```
t=1.211  +88.4 µV      <- jumps from 0 to +88 at onset
t=1.305   -5.4 µV
t=1.445 -109.9 µV      <- largest excursion is negative
t=1.492  -99.4 µV      <- cuts off mid-swing
```

A blink is a smooth monophasic *positive* deflection at Fp1/Fp2. Replaced with an
asymmetric raised-sine shape that is zero-valued at both edges, so it no longer
injects a discontinuity into the trace.

### Every channel shared the same noise sample
`presets.ts:110`. `whiteNoise` was computed once per time step, *outside* the
channel loop, then added to all eight channels. Combined with one pure sine per
band, this gave the simulated scalp zero spatial structure.

### Artifact ratio double-counted, then hid it behind a clamp
`presets.ts:349`. `artifactCount` was incremented once per artifact *per channel per
sample*, so overlapping artifacts counted twice, and `Math.min(0.45, ...)` capped
the result. Measured contributions for the sleep preset: blink 304, ECG 2000, bad
channel 640, total 2944 of 20480 channel-samples. Now the union of the masks, with
no clamp.

### `gray-850` is not a Tailwind colour
13 usages. Verified against the built stylesheet: **no rule was generated**, and
Tailwind v4's reset is `border: 0 solid` with no colour, so `border-color` fell back
to `currentColor` — near-white borders on the dark panels. Fixed by defining the
token in `@theme`:

```
.border-gray-850{border-color:var(--color-gray-850)}   # now present in dist CSS
```

`animate-fade-in` and `prose prose-invert prose-xs` generated nothing either (no
typography plugin installed). The first now has real keyframes; the second was
replaced with explicit styles.

### Hover crosshairs drifted from the cursor
`SpectralCharts.tsx:117`, `SignalExplorer.tsx:81`. Both mixed coordinate systems:
`paddingX` / `paddingLeft` are viewBox units (40, 55) but were subtracted from
`rect.width`, which is CSS pixels. Since both charts are `w-full`, the two never
matched. `SignalExplorer` also used `55` in the hit test where its drawing code used
`60`. Replaced with `getScreenCTM()`-based conversion, which is exact at any
rendered size (`src/lib/chart.ts`).

---

## 2. The app was not type-checked at all

`@types/react` and `@types/react-dom` were **missing from package.json**. So
`npm run lint` (`tsc --noEmit`) passed vacuously — React was `any`, JSX was `any`,
and no prop or hook was ever checked. Adding the types and turning on `strict`,
`noUnusedLocals` and `noUnusedParameters` now passes clean, and surfaced dead
imports (`NotebookCell`, `SpectralBandPower`, `Cpu`, `RefreshCw`, `AlertCircle`,
`Settings2`, `useMemo`).

`motion@12.23.24` was a dependency and never imported once. Removed.

---

## 3. Deployment and security

| Issue | Fix |
|---|---|
| `const PORT = 3000` ignored `process.env.PORT`, which Cloud Run injects | `Number(process.env.PORT) \|\| 3000`. Verified: `PORT=8080` → `Listening on http://0.0.0.0:8080` |
| `import { createServer } from "vite"` at module scope, so the production bundle loaded the dev server | Dynamic `await import("vite")` inside the dev branch. Verified: 0 static `require("vite")` in `dist/server.cjs`, 1 dynamic import |
| Mode check was `NODE_ENV !== "production"` — an unset variable started **Vite dev middleware in production** | Checks for `=== "production"`, and the npm scripts set `NODE_ENV` explicitly on both sides |
| `POST /api/gemini/analyze` had no rate limit, no auth, and a 50 MB body limit, publicly reachable | 256 KB body limit, 8 requests/minute per IP, 200/day per deployment. Verified: 413 on oversized body, 503 with no key configured |
| Provider error messages forwarded straight to the client | Logged server-side; client gets a generic 502 |
| Title was "My Google AI Studio App"; no favicon, description or `color-scheme` | Fixed |
| No error boundary — any render exception blanked the page | `ErrorBoundary` with a reload affordance |

I was wrong about one thing I flagged earlier: I assumed `gemini-3.5-flash` was a
hallucinated model string. It is real and GA. But `gemini-3.6-flash` shipped on
21 July 2026 with a lower output price, so the default now points there, reads from
`GEMINI_MODEL`, and the UI badge reads the live value from `/api/health` instead of
a hard-coded "Gemini 3.5 Flash" that could drift.

---

## 4. Replacing the mock with real computation

### What was fake

- `bandPower` (`presets.ts:301`) was a lookup table keyed on scenario name.
- The PSD curve was five Gaussian bumps on a `25/f^0.95` baseline, labelled
  "calculated via fast Welch-Fourier transform".
- The spectrogram was painted from `dp.predictedLabel` — the segment's *name*.
  `selectedChannel` was in the effect's dependency array but **never read in the
  body**, so choosing a different electrode changed nothing. It also called
  `Math.random()` per pixel, so the image shimmered on every repaint.
- The hypnogram was hard-coded JSX (`width: "20%"`, `WAKE (0-4s)`), duplicating the
  label spans in the data file.
- File upload read `file.name` and `file.size`, printed "Extracted 8 columns of
  microvolt potentials", discarded the file and regenerated the sleep preset.
- `averageHeartRate: 72 + Math.floor(Math.random() * 8)`.
- The console log asserted findings that never happened:
  `"FastICA: Identified Component 0 as Frontal Eye Blink activity (92% confidence)"`.
  For a tool that also offered to draft referral letters, I'd treat that as the most
  serious item in this document.

### New: `src/lib/dsp.ts`

Radix-2 FFT, Welch PSD, RBJ/Butterworth biquads, zero-phase `filtfilt` with odd
reflection padding, STFT, and a Pan–Tompkins style peak detector. Validated against
analytic ground truth:

| Test | Expected | Measured |
|---|---|---|
| 20 µV sine @10 Hz, integrated power | 200 µV² (A²/2) | **200.00** |
| ...alpha band only | 200 | **200.00** |
| ...beta band | 0 | **0.000** |
| σ=10 white noise, total power | 100 | **99.31** |
| 50 Hz notch, 49–51 Hz power | ≈0 | **450 → 0.028** |
| ...alpha preserved | 50 | **50.00** |
| Butterworth Q, order 4 | 1.3066, 0.5412 | **1.3066, 0.5412** |
| HR from 72 bpm train | 72 | **72.1** |
| STFT peak bin | 10 Hz | **10.00** |

### New: `simulate.ts`, `pipeline.ts`, `classify.ts`, `io.ts`

Band-limited noise over a 1/f background with a shared spatial component;
properly-shaped spindles, K-complexes and 3 Hz spike-and-wave; seeded throughout.
The pipeline does real filtering, ocular regression, cardiac template subtraction,
muscle suppression and bad-channel interpolation. The classifier is nearest-centroid
on log band power.

Because the simulator knows the truth, the pipeline can be scored against it. All
four presets, seed 20260101:

| | true bpm | measured | true blinks | detected | bad ch. | flagged | recovery r | epoch acc. |
|---|---|---|---|---|---|---|---|---|
| sleep | 81 | **81** | 4 | 5 | O2 | **O2** | 0.806 → **0.948** | 100% |
| epilepsy | 71 | **71** | 11 | **11** | O2 | **O2** | 0.760 → **0.898** | 100% |
| workload | 81 | **81** | 11 | **11** | O2 | **O2** | 0.562 → **0.827** | 100% |
| meditation | 84 | **84** | 11 | **11** | O2 | **O2** | 0.697 → **0.898** | 100% |

The controls now demonstrably affect the output:

```
bandpass 0.5–45 → 8–12 Hz :  delta 425.86 → 0.00,  alpha 16.44 → 6.06
notch off → on            :  49–51 Hz power 1.652 → 0.047
same seed twice           :  identical band powers
different seed            :  different band powers
```

### Working CSV import

Tested against four file shapes: header + time column (30 µV @10 Hz sine → alpha
power **449.8**, expected 450); no header, semicolon-delimited, values in volts
(auto-scaled to µV, peak **20.0**); malformed rows (2 skipped, rate inferred as
100 Hz); and a 2-row file (rejected with a readable message).

### Other additions

Export of the cleaned signal, the band-power table, a reproducible run record, and
PNG of any chart. Gain control with autoscale and a clipping warning — the old
viewer used a fixed `ampScale = 0.6` and hard-clipped, so a 40 µV slow-wave trace
was a flat-topped square while a 3 µV beta trace was invisible. Min/max decimation,
since the naive path emitted ~82,000 segments for a full-recording view. Real
inverse-distance interpolation on the scalp map, replacing stacked radial gradients
with `mix-blend-screen` (which is not interpolation: values never blended, gaps
stayed dark, and screen blending pushed overlaps towards white regardless of power).
Visible focus rings, `prefers-reduced-motion`, and a "settings changed" cell state
so a cell can no longer claim "Complete" beside numbers from older settings.

### Bugs my own tests caught in my own code

Worth recording, because both were invisible by inspection:

1. **Bad-channel repair ran after re-referencing.** Common average referencing with
   one contaminated electrode still in the set spread its noise into all eight
   channels at 1/N. Band powers inflated (beta 78 µV² where it should be ~15) and
   the surrogate used for blink detection was dominated by the bad channel.
   Reordered to filter → repair → artifact correction → reference.
2. **The recovery metric compared different reference spaces.** Scoring a
   CAR-referenced result against un-referenced ground truth made cleaning look
   catastrophic (r 0.81 → 0.36). CAR legitimately removes the spatially broad
   component most of the signal lives in; the truth has to go through the same
   transform first.

Three detectors also needed real work: blink detection fired on cortical slow waves
and on epileptiform spikes (fixed with a frontal-minus-posterior surrogate, a
minimum-duration criterion, and an absolute µV floor — spikes last ~60 ms, blinks
~250 ms), and heart-rate detection locked onto every second spike-and-wave complex
and reported 97 bpm against a true 71 (fixed by requiring corroboration across
channels, then by adding a dedicated ECG lead as real polysomnography has).

---

## 5. Decisions you may want to reverse

These are product choices, not fixes:

1. **The fake method options are gone.** "Deep Denoising Autoencoder",
   "Spatiotemporal Transformer Filter", "1D-Conv Waveform Filter" and
   "EEG-Conformer" are replaced by the methods that actually run. If the
   aspirational labels matter for your audience, that is a reasonable position —
   but they should not sit next to fabricated confidence percentages.
2. **Sample rate 128 → 256 Hz, duration 20 → 40 s.** At 128 Hz, Nyquist is 64 Hz,
   leaving almost no headroom above the 50 Hz mains peak. 256 Hz is also what the
   type comment already claimed.
3. **Default reference is now "as recorded", not common average.** CAR attenuates
   exactly the delta a sleep recording is about.
4. **`EegDataPoint[]` → typed arrays.** The old model allocated one object plus two
   `Record<string, number>` maps *per sample*. Roughly 20× less memory and it lets
   the DSP run over contiguous buffers.
5. **Config changes are staged until you press Run.** This suits the notebook
   metaphor and avoids re-filtering on every keystroke, but it is a behaviour change.

---

## Verification

```
npx tsc --noEmit        # clean under strict + noUnusedLocals + noUnusedParameters
npm run build           # vite 309 kB (96 kB gzip) + server.cjs 6.3 kB
NODE_ENV=production PORT=8080 node dist/server.cjs
```

Server smoke test: `/api/health` → `{"status":"ok","geminiConfigured":false,"model":null}`;
`/` → `<title>EEG Signal Explorer</title>`; unknown route → 200 (SPA fallback);
`/api/interpret` with no key → 503; 400 KB body → 413.

Pipeline cost is 190–290 ms for 8 channels × 40 s at 256 Hz, which is why it runs on
Run rather than on every keystroke.

## Suggested order of adoption

Everything under `src/lib/` is a pure addition and safe to drop in. If you want the
smallest useful change instead of all of this: `package.json` (types), `index.css`
(the `gray-850` token), `server.ts` (port, dynamic import, rate limit), and the
probability, blink-shape and hover-mapping fixes. That subset is perhaps a tenth of
the work and fixes everything outright broken without changing what the app claims
to be.
