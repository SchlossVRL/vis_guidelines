# vis_guidelines

Online triplet-rating experiment to elicit semantic similarity judgments over
a list of design-related terms, with the goal of fitting a low-dimensional
embedding using [salmon](https://docs.stsievert.com/salmon/offline.html).

**Active Firebase project:** `svrl-vis-guidelines`
**Active collection:** `vis-guidelines-pilot` (set in `experiment/setup.js`)
**Live URLs (after deploy):** https://svrl-vis-guidelines.web.app · https://svrl-vis-guidelines.firebaseapp.com

## Pipeline

```
jsPsych (browser)  ──>  Firestore  ──>  responses.csv  ──>  salmon OfflineEmbedding  ──>  embedding.csv
```

## Build status

- [x] Repo scaffold (`experiment/`, `analysis/`, `data/`, `results/`, `plots/`)
- [x] Stimuli generated (`experiment/stimuli.json`, seed 0 — 18 words, 10 frozen validation, 10 frozen catch)
- [x] jsPsych experiment shell (`experiment/index.html` + `experiment/setup.js`)
- [x] Firebase project `svrl-vis-guidelines` created; Anonymous auth enabled; Firestore database created
- [x] Firestore rules deployed (write-own-doc only, reads blocked from clients)
- [x] Localhost smoke test verified
- [ ] Hosting deploy verified (`firebase deploy --only hosting`)
- [ ] End-to-end pipeline run verified (export → fit on real data)

## Layout

```
experiment/
  index.html
  setup.js              # FIREBASE_CONFIG and EXPERIMENT_COLLECTION live here
  stimuli.json          # word list + frozen validation/catch triplets
analysis/
  generate_stimuli.py   # rebuild stimuli.json for a new experiment
  export_triplets.py    # Firestore -> data/responses.csv (+ targets.csv)
  fit_embedding.py      # data/responses.csv -> results/embedding.csv (with progress output)
data/                   # exported triplets (CSV)
results/                # fitted embeddings
plots/                  # visualizations
firebase.json           # Hosting + Firestore config (public dir = experiment/)
firestore.rules         # write-own-doc rule for anonymous auth
firestore.indexes.json
.firebaserc             # project alias -> svrl-vis-guidelines
environment.yml         # conda env: vis-guidelines
```

## Trial protocol (per participant, 120 trials)

- **100 random** triplets sampled client-side from the word list (different per participant)
- **10 validation** triplets — frozen in `stimuli.json`, same for all participants in a given experiment
- **10 catch** trials — one option is the head verbatim, used as an attention check (also frozen per experiment)

Each trial record is tagged with a `type` field (`"random" | "validation" | "catch"`)
so analysis can filter — catch trials are always dropped from the embedding fit;
validation trials are held out by default (use `--include-validation` to include).

## Session / refresh behavior

- One Firestore doc per anonymous-auth uid (anon auth persists across browser refreshes).
- On refresh the `trials` array is reset to `[]` and the participant restarts; the previous attempt is overwritten.
- For dev testing, use **incognito** to mint a fresh uid each session.

## Quickstart

### 1. Conda environment (one-time)

```sh
conda env create -f environment.yml
conda activate vis-guidelines
```

### 2. Deploy Firestore rules (one-time, then again whenever rules change)

```sh
firebase deploy --only firestore:rules
```

### 3. Preview locally

```sh
firebase serve --only hosting          # http://localhost:5000
```

Open the URL, click through a few trials, then check the [Firestore console](https://console.firebase.google.com/project/svrl-vis-guidelines/firestore/data)
to confirm a doc lands in `vis-guidelines-pilot`.

### 4. Deploy to production

```sh
firebase deploy --only hosting
```

### 5. Export the responses

```sh
python analysis/export_triplets.py \
    --collection vis-guidelines-pilot \
    --credentials ~/.firebase-keys/svrl-vis-guidelines-admin.json
```

Useful flags:
- `--include-incomplete` — include sessions without a `completedAt` (handy for smoke tests where you didn't finish all 120 trials).
- `--include-validation` — also feed validation triplets to the fit (default: held out).

The script prints `sessions used`, `trials exported`, and writes `data/responses.csv` (head/winner/loser ints) and `data/targets.csv` (index ↔ word).

### 6. Fit the embedding

```sh
python analysis/fit_embedding.py -d 3                          # default
python analysis/fit_embedding.py -d 2                          # for plotting
python analysis/fit_embedding.py --max-epochs 5000             # quick smoke test
python analysis/fit_embedding.py --verbose-interval 100        # more frequent progress logs
```

Progress output: a header summary, then salmon's per-interval score logs (controlled by `--verbose-interval`), then a final history snapshot and elapsed time. The fitted embedding is written to `results/embedding.csv` (one row per word, columns `word, dim_0, dim_1, …`).

## Service-account key

The Admin SDK key (used by `export_triplets.py`) bypasses Firestore rules, so
it must never be committed. The expected location is:

```
~/.firebase-keys/svrl-vis-guidelines-admin.json    (chmod 600)
```

The web `firebaseConfig` (with `apiKey`) in `experiment/setup.js` is **not** a secret — Firebase web API keys are project identifiers meant to ship in browser code; security comes from Firestore rules + auth.

## Starting a new experiment (e.g. v2)

1. Pick a new collection name and update `EXPERIMENT_COLLECTION` in `experiment/setup.js`.
2. Optional — regenerate frozen stimuli with a new seed:
   ```sh
   python analysis/generate_stimuli.py --seed <N> --out experiment/stimuli.json
   ```
3. `firebase deploy --only hosting`.

## Setting up Firebase from scratch (for forks / new projects)

1. Create a project at https://console.firebase.google.com.
2. Authentication → Sign-in method → enable **Anonymous**.
3. Firestore Database → create database → production mode → pick a region.
4. Project settings → General → Your apps → register a Web app → copy `firebaseConfig` into `FIREBASE_CONFIG` in `experiment/setup.js`.
5. Project settings → Service accounts → Generate new private key → save outside the repo.
6. Update the project alias and deploy rules:
   ```sh
   firebase use --add        # pick the new project, alias as 'default'
   firebase deploy --only firestore:rules
   ```
