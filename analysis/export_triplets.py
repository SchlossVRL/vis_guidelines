"""Export the full experiment data from Firestore into local CSVs.

Writes four files into `data/` (or the path passed to `--out-dir`):

  trials.csv        rich per-trial data (one row per triplet trial)
                    columns: participant_id, collection, trial_index, type,
                             head, left, right, winner, loser,
                             response_side, response_source, rt

  participants.csv  one row per participant (session metadata + demographics)
                    columns: participant_id, collection, consent,
                             started_at, consented_at, completed_at,
                             n_trials, user_agent,
                             demo_<field>...  (one column per demographics field
                                               if/when those are collected)

  responses.csv     salmon-ready: integer-indexed head/winner/loser triples,
                    derived from trials.csv after filtering catch trials (and
                    by default validation trials too)
                    columns: head, winner, loser

  targets.csv       word ↔ index mapping used to build responses.csv
                    columns: index, word

Catch trials are always excluded from responses.csv. Validation trials are
held out by default (use --include-validation to include).

Usage:
    python analysis/export_triplets.py \\
        --collection vis-guidelines-pilot \\
        --credentials ~/.firebase-keys/svrl-vis-guidelines-admin.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore


TRIAL_COLUMNS = [
    "participant_id",
    "collection",
    "trial_index",
    "type",
    "head",
    "left",
    "right",
    "winner",
    "loser",
    "response_side",
    "response_source",
    "rt",
]

PARTICIPANT_COLUMNS = [
    "participant_id",
    "collection",
    "consent",
    "started_at",
    "consented_at",
    "completed_at",
    "n_trials",
    "user_agent",
]


def iso_or_none(ts: Any) -> str | None:
    """Convert a Firestore timestamp (or None) to an ISO 8601 string."""
    if ts is None:
        return None
    if hasattr(ts, "isoformat"):
        return ts.isoformat()
    return str(ts)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--collection", nargs="+", default="vis-guidelines-pilot-v2")
    p.add_argument(
        "--credentials",
        required=True,
        help="Path to a Firebase service-account JSON key.",
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
    p.add_argument(
        "--include-non-consenting",
        action="store_true",
        help="Include sessions whose `consent` field is not True (default: skipped).",
    )
    args = p.parse_args()

    cred = credentials.Certificate(args.credentials)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    stimuli = json.loads(Path(args.stimuli).read_text())
    word_to_idx = {w: i for i, w in enumerate(stimuli["words"])}

    trial_rows: list[dict] = []
    participant_rows: list[dict] = []

    n_skipped_no_consent = 0
    n_skipped_incomplete = 0
    n_unknown_word = 0

    for collection_name in args.collection:
        for snap in db.collection(collection_name).stream():
            data = snap.to_dict() or {}

            if not args.include_non_consenting and data.get("consent") is not True:
                n_skipped_no_consent += 1
                continue
            if not args.include_incomplete and data.get("completedAt") is None:
                n_skipped_incomplete += 1
                continue
        
            #get deomographics data to exclude for less than 1 year vis experience
            demographics = data.get("demographics") or {}

            #skip participants with less than 1 year of experience in VIS
            vis_exp = demographics.get("years_in_vis")

            try:
                years = float(vis_exp)
                if years < 1:
                    continue
            except (TypeError, ValueError):
                pass

            # skip participants with fewer than 100 trials
            n_trials = len(data.get("trials", []) or [])
            if n_trials < 100:
                continue

            pid = data.get("participantId") or snap.id
            trials = data.get("trials", []) or []
            #demographics = data.get("demographics") or {}

            p_row: dict[str, Any] = {
                "participant_id": pid,
                "collection": data.get("collection"),
                "consent": data.get("consent"),
                "started_at": iso_or_none(data.get("startedAt")),
                "consented_at": iso_or_none(data.get("consentedAt")),
                "completed_at": iso_or_none(data.get("completedAt")),
                "n_trials": len(trials),
                "user_agent": data.get("userAgent"),
            }
            # Demographic fields land as demo_<field> columns; pandas will fill NaN
            # for participants who don't have a given field.
            for k, v in demographics.items():
                p_row[f"demo_{k}"] = v
            participant_rows.append(p_row)

            for t in trials:
                trial_rows.append(
                    {
                        "participant_id": pid,
                        "collection": data.get("collection"),
                        "trial_index": t.get("trial_index"),
                        "type": t.get("type"),
                        "head": t.get("head"),
                        "left": t.get("left"),
                        "right": t.get("right"),
                        "winner": t.get("winner"),
                        "loser": t.get("loser"),
                        "response_side": t.get("response_side"),
                        "response_source": t.get("response_source"),
                        "rt": t.get("rt"),
                    }
                )

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # --- trials.csv ---
    trials_df = (
        pd.DataFrame(trial_rows, columns=TRIAL_COLUMNS)
        if trial_rows
        else pd.DataFrame(columns=TRIAL_COLUMNS)
    )
    trials_df.to_csv(out_dir / "trials.csv", index=False)

    # --- participants.csv ---
    # Pull any demo_* columns to the right of the fixed columns.
    if participant_rows:
        participants_df = pd.DataFrame(participant_rows)
        demo_cols = sorted(
            c for c in participants_df.columns if c.startswith("demo_")
        )
        participants_df = participants_df.reindex(
            columns=PARTICIPANT_COLUMNS + demo_cols
        )
    else:
        participants_df = pd.DataFrame(columns=PARTICIPANT_COLUMNS)
    participants_df.to_csv(out_dir / "participants.csv", index=False)

    # --- responses.csv (derived from trials.csv) ---
    salmon_rows: list[tuple[int, int, int]] = []
    keep_types = {"random"} | ({"validation"} if args.include_validation else set())
    for t in trial_rows:
        if t["type"] not in keep_types:
            continue
        h, w, l = t["head"], t["winner"], t["loser"]
        if h in word_to_idx and w in word_to_idx and l in word_to_idx:
            salmon_rows.append((word_to_idx[h], word_to_idx[w], word_to_idx[l]))
        else:
            n_unknown_word += 1

    pd.DataFrame(salmon_rows, columns=["head", "winner", "loser"]).to_csv(
        out_dir / "responses.csv", index=False
    )

    # --- targets.csv ---
    pd.DataFrame(
        sorted(word_to_idx.items(), key=lambda kv: kv[1]),
        columns=["word", "index"],
    )[["index", "word"]].to_csv(out_dir / "targets.csv", index=False)

    print(
        f"sessions used         : {len(participant_rows)}\n"
        f"  skipped (no consent): {n_skipped_no_consent}\n"
        f"  skipped (incomplete): {n_skipped_incomplete}\n"
        f"trials exported       : {len(trial_rows)}\n"
        f"salmon triplets       : {len(salmon_rows)} "
        f"(skipped {n_unknown_word} with unknown words, "
        f"type filter: {sorted(keep_types)})\n"
        f"wrote → {out_dir / 'trials.csv'}\n"
        f"        {out_dir / 'participants.csv'}\n"
        f"        {out_dir / 'responses.csv'}\n"
        f"        {out_dir / 'targets.csv'}"
    )


if __name__ == "__main__":
    main()
