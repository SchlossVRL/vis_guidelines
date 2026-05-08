"""Export triplet responses from Firestore to a salmon-compatible CSV.

The output columns (`head`, `winner`, `loser`) are 0-based integer indices into
`data/targets.csv`, matching the format documented at
https://docs.stsievert.com/salmon/offline.html.

Catch trials are always excluded. Validation trials are excluded by default
(use --include-validation to include them in the fit set; otherwise hold them
out for post-hoc embedding evaluation).

Usage:
    python analysis/export_triplets.py \\
        --collection vis-guidelines-pilot \\
        --credentials path/to/service-account.json
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--collection", default="vis-guidelines-pilot")
    p.add_argument(
        "--credentials",
        required=True,
        help="Path to a Firebase service-account JSON key (Project settings → Service accounts → Generate new private key).",
    )
    p.add_argument("--stimuli", default="experiment/stimuli.json")
    p.add_argument("--out-dir", default="data")
    p.add_argument(
        "--include-validation",
        action="store_true",
        help="Include validation trials in responses.csv (default: held out).",
    )
    p.add_argument(
        "--include-incomplete",
        action="store_true",
        help="Include sessions with no completedAt timestamp (default: skipped).",
    )
    args = p.parse_args()

    cred = credentials.Certificate(args.credentials)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    stimuli = json.loads(Path(args.stimuli).read_text())
    word_to_idx = {w: i for i, w in enumerate(stimuli["words"])}

    rows: list[tuple[int, int, int]] = []
    n_sessions = 0
    n_skipped = 0
    n_unknown = 0

    for snap in db.collection(args.collection).stream():
        data = snap.to_dict()
        if not args.include_incomplete and data.get("completedAt") is None:
            n_skipped += 1
            continue
        n_sessions += 1
        for trial in data.get("trials", []):
            if trial.get("type") == "catch":
                continue
            if trial.get("type") == "validation" and not args.include_validation:
                continue
            head = trial.get("head")
            winner = trial.get("winner")
            loser = trial.get("loser")
            if head not in word_to_idx or winner not in word_to_idx or loser not in word_to_idx:
                n_unknown += 1
                continue
            rows.append(
                (word_to_idx[head], word_to_idx[winner], word_to_idx[loser])
            )

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    with (out_dir / "responses.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["head", "winner", "loser"])
        w.writerows(rows)

    with (out_dir / "targets.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["index", "word"])
        for word, i in word_to_idx.items():
            w.writerow([i, word])

    print(
        f"sessions used: {n_sessions} (skipped incomplete: {n_skipped})\n"
        f"trials exported: {len(rows)} (skipped unknown words: {n_unknown})\n"
        f"wrote {out_dir / 'responses.csv'} and {out_dir / 'targets.csv'}"
    )


if __name__ == "__main__":
    main()
