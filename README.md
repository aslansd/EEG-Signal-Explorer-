# EEG Signal Explorer

A notebook-style workspace for EEG filtering, spectral analysis and epoch
classification. All signal processing runs in the browser — there is no Python
backend and no analysis service to call.

Recordings are synthetic by default, generated from a seed so any result can be
reproduced exactly. You can also import your own CSV.

**Not a medical device. Not for clinical use.**

---

## Run it locally

Requires Node.js 20 or newer (`node --version` to check).

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Everything except the interpretation panel works with no configuration at all. That
one panel needs a Gemini API key:

```bash
cp .env.example .env
# then edit .env and set GEMINI_API_KEY=...
```

Without a key the panel shows a short notice explaining it is inactive, and the rest
of the workspace is unaffected.

### Checking the production build before you deploy

Worth doing once, because it exercises a different code path from `npm run dev`
(static assets instead of Vite middleware):

```bash
npm run build
npm start
```

Also on <http://localhost:3000>. To confirm it is serving the built bundle rather
than the dev server, the console should print `Starting in production mode`.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload, via Express |
| `npm run build` | Builds the client to `dist/` and bundles the server to `dist/server.cjs` |
| `npm start` | Serves the built app |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run clean` | Removes `dist/` |

All scripts work as-is on Windows, macOS and Linux — none of them rely on shell
`VAR=value` syntax.

---

## Push to GitHub

The repository is ready to commit as-is. `.gitignore` already excludes
`node_modules/`, `dist/` and every `.env` file except `.env.example`.

One thing to check before your first push:

```bash
git status --short          # confirm no .env file is listed
```

Your API key must never reach the repository. If it has already been committed at
some point, rotate the key rather than just deleting the file — git history keeps it.

Commit the lockfile (`package-lock.json`). The Docker build uses it for reproducible
installs.

---

## Deploy to Cloud Run

A `Dockerfile` is included, and Cloud Run uses it in preference to buildpack
autodetection. It is a two-stage build: dev dependencies are used to compile and
then discarded, so the runtime image carries only what the server needs.

### Continuous deployment from GitHub

In the Cloud Run console: **Create service → Continuously deploy from a repository**,
pick the repo and branch, and choose **Dockerfile** as the build type.

Then set the API key as a secret rather than a plain environment variable:

1. Create the secret in Secret Manager, e.g. `gemini-api-key`.
2. On the Cloud Run service, under **Variables & Secrets**, expose it as the
   environment variable `GEMINI_API_KEY`.
3. Grant the service's runtime service account the **Secret Manager Secret Accessor**
   role.

### Or deploy from your machine

```bash
gcloud run deploy eeg-signal-explorer \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

### Notes that matter for Cloud Run

- **Port.** The server reads `process.env.PORT` and falls back to 3000. Cloud Run
  injects 8080. Do not set a container port manually; let it use the default.
- **`NODE_ENV`.** You do not need to set it. Production is the default, and
  development mode requires an explicit `--dev` flag, so a missing variable cannot
  accidentally start a dev server in production.
- **Memory.** The default 512 MiB is enough. Processing happens in the visitor's
  browser, not on the server — the container only serves static files and proxies
  interpretation requests.
- **Cost control.** The interpretation endpoint is rate limited to 8 requests per
  minute per IP and 200 per day for the whole deployment. Those limits are constants
  near the top of `server.ts`. They are a spend guard on a public URL, not
  authentication — if the service is exposed with `--allow-unauthenticated`, anyone
  who finds it can use your quota within those limits. Tighten them, or put
  Identity-Aware Proxy in front, if that matters to you.
- **Min instances.** Leave at 0 unless cold starts bother you. The server is ~6 KB
  and starts in well under a second.

---

## Importing your own data

The upload control accepts CSV or TSV: one column per channel, one row per sample.

```csv
time,Fp1,Fp2,C3,C4
0.000000,12.4,-3.1,8.8,5.2
0.003906,14.1,-2.7,9.4,4.9
```

- A header row is used for channel names. Without one, channels are named `Ch1…ChN`.
- A column named `time`, `t`, `timestamp`, `sec` or `s` sets the sample rate. Without
  one, 256 Hz is assumed — and the import log says so rather than hiding it.
- `,`, `;`, tab and space delimiters are detected automatically.
- Values that look like volts rather than microvolts are rescaled, and this is
  reported.
- Unparseable rows are skipped and counted.
- Channel names matching the 10–20 system (`Fp1`, `C3`, `O2`, …) get positions on the
  scalp map. Names that do not match still work everywhere else.

Imported recordings have no ground-truth labels, so the classifier reports features
without accuracy, and the recovery metric shows `n/a`. That is expected: there is
nothing to compare against.

---

## How it is organised

```
src/lib/dsp.ts        FFT, Welch PSD, Butterworth and notch biquads,
                      zero-phase filtfilt, STFT, peak detection
src/lib/simulate.ts   Synthetic recording generation, seeded
src/lib/pipeline.ts   Filtering, artifact correction, measured metrics
src/lib/classify.ts   Nearest-centroid classifier over log band power
src/lib/io.ts         CSV import, CSV/PNG/Markdown export
src/lib/chart.ts      SVG coordinate conversion, min/max decimation
src/lib/rng.ts        Seeded PRNG, white and pink noise
src/components/       Charts and notebook cells
server.ts             Express: static assets plus the interpretation endpoint
```

`src/lib/` is pure functions with no React dependency, so it can be tested directly
with `npx tsx` or reused elsewhere.

See `REVIEW.md` for what changed from the previous version and why, including the
measurements used to verify each fix.
