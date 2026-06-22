"""Fit a low-dimensional embedding from triplet responses using salmon.

Reads `data/responses.csv` and `data/targets.csv` (produced by
`export_triplets.py`) and writes `results/embedding.csv`.

Progress is reported live: salmon's `verbose` argument controls how often it
records (and logs) train/test scores; `--verbose-interval` exposes it as a CLI
flag. We also surface salmon's internal log messages, time the fit, and print
a final history summary.

Usage:
    python analysis/fit_embedding.py                    # default d=3, max_epochs=500k
    python analysis/fit_embedding.py -d 2               # 2D for plotting
    python analysis/fit_embedding.py --max-epochs 5000  # quick smoke test
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split
from salmon.triplets.offline import OfflineEmbedding


def setup_logging() -> None:
    """Surface salmon's INFO-level log messages with a clean format."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.WARNING)
    logging.getLogger("salmon").setLevel(logging.INFO)


def summarize_history(history) -> None:
    if history is None:
        print("[fit] no history attribute on model")
        return

    rows: list[dict] = []
    if isinstance(history, list):
        rows = [r for r in history if isinstance(r, dict)]
    elif hasattr(history, "to_dict"):  # pandas DataFrame
        try:
            rows = history.to_dict(orient="records")
        except Exception:
            rows = []
    elif isinstance(history, dict):
        try:
            keys = list(history.keys())
            n = len(next(iter(history.values())))
            rows = [{k: history[k][i] for k in keys} for i in range(n)]
        except Exception:
            rows = []

    if not rows:
        print(f"[fit] history (raw): {history}")
        return

    print(f"[fit] {len(rows)} history entries recorded")
    snapshots = sorted({0, len(rows) // 4, len(rows) // 2, 3 * len(rows) // 4, len(rows) - 1})
    for i in snapshots:
        if 0 <= i < len(rows):
            entry = rows[i]
            keys = ("score_test", "loss_test", "score_train", "loss_train", "epoch")
            shown = {k: entry[k] for k in keys if k in entry}
            print(f"  snapshot[{i:>4}]: {shown or entry}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--responses", default="data/responses.csv")
    p.add_argument("--targets", default="data/targets.csv")
    p.add_argument("--out", default="results/embedding.csv")
    p.add_argument("-d", "--dim", type=int, default=3)
    p.add_argument("--max-epochs", type=int, default=500_000)
    p.add_argument(
        "--verbose-interval",
        type=int,
        default=1000,
        help="Salmon scores and logs progress every N epochs (default: 1000).",
    )
    p.add_argument("--test-size", type=float, default=0.2)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    setup_logging()

    df = pd.read_csv(args.responses)
    targets = pd.read_csv(args.targets).sort_values("index").reset_index(drop=True)

    if len(df) == 0:
        raise SystemExit("responses.csv is empty — run export_triplets.py first.")

    X = df[["head", "winner", "loser"]].to_numpy()
    n = int(targets["index"].max()) + 1

    X_train, X_test = train_test_split(
        X, test_size=args.test_size, random_state=args.seed
    )

    bar = "─" * 64
    print(bar)
    print("Salmon OfflineEmbedding")
    print(bar)
    print(f"  words (n)         : {n}")
    print(f"  embedding dim (d) : {args.dim}")
    print(f"  triplets (total)  : {len(X)}")
    print(f"  train / test      : {len(X_train)} / {len(X_test)}")
    print(f"  max_epochs        : {args.max_epochs:,}")
    print(f"  verbose interval  : every {args.verbose_interval:,} epochs")
    print(f"  random seed       : {args.seed}")
    print(bar)
    print("[fit] starting — salmon will log scores at each verbose interval")
    print(bar)

    model = OfflineEmbedding(
        n=n,
        d=args.dim,
        max_epochs=args.max_epochs,
        verbose=args.verbose_interval,
        random_state=args.seed,
    )

    t0 = time.time()
    try:
        model.fit(X_train, X_test)
    except KeyboardInterrupt:
        elapsed = time.time() - t0
        print(f"\n[fit] interrupted after {elapsed:.1f}s")
        raise

    elapsed = time.time() - t0

    print(bar)
    print(f"[fit] complete in {elapsed:.1f}s ({elapsed / 60:.2f} min)")
    summarize_history(getattr(model, "history_", None))

    def save_history(history, path):
        if history is None:
            print("[fit] no history to save")
            return
        if isinstance(history, pd.DataFrame):
            df_hist = history.copy()
        elif isinstance(history, list):
            df_hist = pd.DataFrame(history)
        elif isinstance(history, dict):
            df_hist = pd.DataFrame(history)
        else:
            print(f"[fit] unsupported history type: {type(history)}")
            return
        df_hist.to_csv(path, index=False)
        print(f"[fit] wrote history -> {path}")

    history_out = out.with_name(f"{out.stem}_history.csv")
    save_history(getattr(model, "history_", None), history_out)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    em = pd.DataFrame(
        model.embedding_, columns=[f"dim_{i}" for i in range(args.dim)]
    )
    em.insert(0, "word", targets["word"].values)
    em.to_csv(out, index=False)

    print(f"[fit] wrote embedding -> {out}")
    print(bar)


if __name__ == "__main__":
    main()
