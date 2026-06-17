"""Export the full experiment data from Firestore into local CSVs.

Writes two files into `data/scales/` (or the path passed to `--out-dir`):

  trials.csv        rich per-trial data (one row per rating trial)
                    columns: participant_id, collection, block, trial_index,
                    word, scale_id, scale_left_display, scale_right_display, 
                    scale_reversed, response

  participants.csv  one row per participant (session metadata + demographics)
                    columns: participant_id, collection, consent,
                             started_at, consented_at, completed_at,
                             n_trials, user_agent,
                             demo_<field>...  (one column per demographics field
                                               if/when those are collected)

Usage:
    python analysis/export_scales.py \\
        --collection vis-guidelines-scales-true-run \\
        --credentials ~/.firebase-keys/svrl-vis-guidelines-admin.json
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore


TRIAL_COLUMNS = [
    "participant_id",
    "collection",
    "block",
    "trial_index",
    "word",
    "scale_id",
    "scale_left_display",
    "scale_right_display",
    "scale_reversed",
    "response"
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
    p.add_argument("--collection", nargs="+", default="vis-guidelines-scales-true-run")
    p.add_argument(
        "--credentials",
        required=True,
        help="Path to a Firebase service-account JSON key.",
    )
    p.add_argument("--out-dir", default="data/scales")
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

    trial_rows: list[dict] = []
    participant_rows: list[dict] = []

    n_skipped_no_consent = 0
    n_skipped_incomplete = 0
    n_skipped_vis_experience = 0
    n_skipped_too_few_trials = 0

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
                    n_skipped_vis_experience += 1
                    continue
            except (TypeError, ValueError):
                pass

            # skip participants with fewer than 68 trials
            n_trials = len(data.get("trials", []) or [])
            if n_trials < 68:
                n_skipped_too_few_trials += 1
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
                        "block": t.get("block"),
                        "trial_index": t.get("trial_index"),
                        "word": t.get("word"),
                        "scale_id": t.get("scale_id"),
                        "scale_left_display": t.get("scale_left_display"),
                        "scale_right_display": t.get("scale_right_display"),
                        "scale_reversed": t.get("scale_reversed"),
                        "response": t.get("response")
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


    print(
        f"sessions used         : {len(participant_rows)}\n"
        f"  skipped (no consent): {n_skipped_no_consent}\n"
        f"  skipped (incomplete): {n_skipped_incomplete}\n"
        f"  skipped (<1 yr VIS) : {n_skipped_vis_experience}\n"
        f"  skipped (<68 trials): {n_skipped_too_few_trials}\n"
        f"trials exported       : {len(trial_rows)}\n"
        f"wrote → {out_dir / 'trials.csv'}\n"
        f"        {out_dir / 'participants.csv'}\n"
    )


if __name__ == "__main__":
    main()
