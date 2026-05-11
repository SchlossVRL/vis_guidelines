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

### 2. Install the Firebase CLI (one-time)

The `firebase` command is provided by the `firebase-tools` npm package, which requires Node.js. If you don't already have Node, install it via [Homebrew](https://brew.sh) (`brew install node`) or the installer at [nodejs.org](https://nodejs.org). Then:

```sh
npm install -g firebase-tools          # install the CLI globally
firebase login                         # opens a browser to sign in with your Google account
firebase use                           # should print: svrl-vis-guidelines (default)
```

The `firebase use` check confirms the CLI picked up the project alias from `.firebaserc`. If it prints something else, run `firebase use svrl-vis-guidelines`.

### 3. Deploy Firestore rules (one-time, then again whenever rules change)

```sh
firebase deploy --only firestore:rules
```

### 4. Preview locally

```sh
firebase serve --only hosting          # http://localhost:5000
```

Open the URL, click through a few trials, then check the [Firestore console](https://console.firebase.google.com/project/svrl-vis-guidelines/firestore/data)
to confirm a doc lands in `vis-guidelines-pilot`.

### 5. Deploy to production

```sh
firebase deploy --only hosting
```

### 6. Export the data

```sh
python analysis/export_triplets.py \
    --collection vis-guidelines-pilot \
    --credentials ~/.firebase-keys/svrl-vis-guidelines-admin.json
```

The script writes four CSVs into `data/`:

| file               | what's in it                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `trials.csv`       | one row per triplet trial: `participant_id, collection, trial_index, type, head, left, right, winner, loser, response_side, response_source, rt` |
| `participants.csv` | one row per participant: session metadata + consent + (future) `demo_<field>` columns                                        |
| `responses.csv`    | derived, salmon-ready: 0-based integer `head, winner, loser`                                                                 |
| `targets.csv`      | word ↔ index mapping                                                                                                         |

Flags:
- `--include-incomplete` — include sessions without a `completedAt` timestamp (handy for smoke tests where you didn't finish all 120 trials).
- `--include-non-consenting` — include sessions whose `consent` is not `True` (default: skipped).
- `--include-validation` — also feed validation triplets to the salmon fit (default: held out for post-hoc embedding evaluation).

### 7. Fit the embedding

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

## For collaborators (downloading data)

If you've been added to the `svrl-vis-guidelines` Firebase project as an **Editor**, follow these steps to set yourself up to pull data and fit embeddings. Each collaborator should generate their own service-account key rather than sharing one — that way access is tied to your account and can be revoked individually.

### 1. Clone the repo

```sh
git clone git@github.com:SchlossVRL/vis_guidelines.git
cd vis_guidelines
```

### 2. Create the conda environment

```sh
conda env create -f environment.yml
conda activate vis-guidelines
```

### 3. Generate your own service-account key

1. Sign into the [Firebase console for this project](https://console.firebase.google.com/project/svrl-vis-guidelines) with the Google account you were added under.
2. Click the gear ⚙️ → **Project settings** → **Service accounts** tab.
3. Scroll to **Firebase Admin SDK** → click **Generate new private key** → **Generate key**. A JSON file will download.
4. Move it somewhere outside the repo and lock down its permissions:
   ```sh
   mkdir -p ~/.firebase-keys
   mv ~/Downloads/svrl-vis-guidelines-firebase-adminsdk-*.json \
      ~/.firebase-keys/svrl-vis-guidelines-admin.json
   chmod 600 ~/.firebase-keys/svrl-vis-guidelines-admin.json
   ```

**Treat this JSON like a password.** Anyone who has it can read/write the entire Firestore database (it bypasses security rules). Don't commit it, don't paste it into chat, don't email it.

### 4. Pull data and fit an embedding

```sh
python analysis/export_triplets.py \
    --collection vis-guidelines-pilot \
    --credentials ~/.firebase-keys/svrl-vis-guidelines-admin.json

python analysis/fit_embedding.py -d 3
```

That's it — `data/responses.csv`, `data/targets.csv`, and `results/embedding.csv` will be written locally.

### If your access is ever revoked

If you leave the project (or just want to rotate your key), revoke it in the Firebase console → Project settings → Service accounts → **Manage all service accounts** (which opens Google Cloud) → find your key → delete. Then delete the local JSON.

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
