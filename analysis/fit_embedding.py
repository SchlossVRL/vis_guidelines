"""Fit a low-dimensional embedding from triplet responses using salmon.

Reads `data/responses.csv` and `data/targets.csv` (produced by
`export_triplets.py`) and writes `results/embedding.csv`.

Usage:
    python analysis/fit_embedding.py            # default d=3
    python analysis/fit_embedding.py -d 2       # 2D for plotting
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split
from salmon.triplets.offline import OfflineEmbedding


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--responses", default="data/responses.csv")
    p.add_argument("--targets", default="data/targets.csv")
    p.add_argument("--out", default="results/embedding.csv")
    p.add_argument("-d", "--dim", type=int, default=3)
    p.add_argument("--max-epochs", type=int, default=500_000)
    p.add_argument("--test-size", type=float, default=0.2)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    df = pd.read_csv(args.responses)
    targets = pd.read_csv(args.targets).sort_values("index").reset_index(drop=True)

    if len(df) == 0:
        raise SystemExit("responses.csv is empty — run export_triplets.py first.")

    X = df[["head", "winner", "loser"]].to_numpy()
    n = int(targets["index"].max()) + 1

    X_train, X_test = train_test_split(
        X, test_size=args.test_size, random_state=args.seed
    )

    print(
        f"fitting OfflineEmbedding: n={n}, d={args.dim}, "
        f"train={len(X_train)}, test={len(X_test)}, max_epochs={args.max_epochs}"
    )
    model = OfflineEmbedding(n=n, d=args.dim, max_epochs=args.max_epochs)
    model.fit(X_train, X_test)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    em = pd.DataFrame(
        model.embedding_, columns=[f"dim_{i}" for i in range(args.dim)]
    )
    em.insert(0, "word", targets["word"].values)
    em.to_csv(out, index=False)

    print(f"wrote embedding to {out}")


if __name__ == "__main__":
    main()
