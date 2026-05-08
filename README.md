# vis_guidelines

Online triplet-rating experiment to elicit semantic similarity judgments over
a list of design-related terms, with the goal of fitting a low-dimensional
embedding using [salmon](https://docs.stsievert.com/salmon/offline.html).

**Active Firebase project:** `svrl-vis-guidelines`
**Active collection:** `vis-guidelines-pilot` (set in `experiment/setup.js`)

## Pipeline

```
jsPsych (browser)  ──>  Firestore  ──>  responses.csv  ──>  salmon OfflineEmbedding  ──>  embedding.csv
```

## Layout

```
experiment/           # jsPsych client (deployed to Firebase Hosting)
  index.html
  setup.js            # FIREBASE_CONFIG and EXPERIMENT_COLLECTION live here
  stimuli.json        # word list + frozen validation/catch triplets
analysis/             # Python pipeline
  generate_stimuli.py # rebuild stimuli.json for a new experiment
  export_triplets.py  # Firestore -> data/responses.csv (+ targets.csv)
  fit_embedding.py    # data/responses.csv -> results/embedding.csv
data/                 # exported triplets
results/              # fitted embeddings
plots/                # visualizations
firebase.json         # Hosting + Firestore config
firestore.rules       # write-own-doc rule for anonymous auth
.firebaserc           # project alias -> svrl-vis-guidelines
environment.yml       # conda env: vis-guidelines
```

## Trial protocol (per participant, 120 trials)

- **100 random** triplets sampled client-side from the word list
- **10 validation** triplets — frozen in `stimuli.json`, same for all participants
- **10 catch** trials — one option is the head verbatim, used as an attention check

Each trial record is tagged with a `type` field (`"random" | "validation" | "catch"`)
so analysis can filter (catch trials are dropped from the embedding fit;
validation trials are held out by default).

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
firebase serve --only hosting        # http://localhost:5000
```

Open the URL, run through a few trials, then check the Firebase console
(Firestore → `vis-guidelines-pilot`) to confirm a doc was written for your
session. The doc ID is the anonymous-auth uid; the `trials` array grows as you
progress.

### 4. Deploy to production

```sh
firebase deploy --only hosting
```

The site URL is shown after deploy — typically
`https://svrl-vis-guidelines.web.app`.

### 5. Export and fit

```sh
python analysis/export_triplets.py \
    --collection vis-guidelines-pilot \
    --credentials ~/.firebase-keys/svrl-vis-guidelines-admin.json

python analysis/fit_embedding.py -d 3       # default
python analysis/fit_embedding.py -d 2       # for plotting
```

Results land in `data/responses.csv`, `data/targets.csv`, and
`results/embedding.csv`.

## Service-account key

The Admin SDK key (used by `export_triplets.py`) bypasses Firestore rules, so
it must never be committed. The expected location is:

```
~/.firebase-keys/svrl-vis-guidelines-admin.json    (chmod 600)
```

If you keep the JSON elsewhere, just pass `--credentials <path>` to
`export_triplets.py`. The `.gitignore` covers `*-firebase-adminsdk-*.json` and
`serviceAccount*.json` as a backstop.

## Starting a new experiment (e.g. v2)

1. Pick a new collection name and update `EXPERIMENT_COLLECTION` in
   `experiment/setup.js`.
2. Optional — regenerate frozen stimuli with a new seed:
   ```sh
   python analysis/generate_stimuli.py --seed <N> --out experiment/stimuli.json
   ```
3. `firebase deploy --only hosting`.

## Setting up Firebase from scratch (for forks / new projects)

1. Create a project at https://console.firebase.google.com.
2. Authentication → Sign-in method → enable **Anonymous**.
3. Firestore Database → create database → production mode → pick a region.
4. Project settings → General → Your apps → register a Web app → copy
   `firebaseConfig` into `FIREBASE_CONFIG` in `experiment/setup.js`.
5. Project settings → Service accounts → Generate new private key → save
   outside the repo.
6. Update the project alias:
   ```sh
   firebase use --add        # pick the new project, alias as 'default'
   firebase deploy --only firestore:rules
   ```
