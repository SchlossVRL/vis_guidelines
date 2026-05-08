"""Generate `experiment/stimuli.json` for a triplet-rating experiment.

Validation and catch triplets are sampled once with a fixed seed and then frozen
for the entire experiment so all participants see the same set. The 100 random
trials are sampled client-side per participant; only the count is stored here.

Run once per new experiment (e.g., when starting a new pilot collection):
    python analysis/generate_stimuli.py --seed 0 --out experiment/stimuli.json
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

WORDS = [
    "design pattern",
    "justification",
    "heuristic",
    "requirement",
    "implication",
    "principle",
    "rule of thumb",
    "consideration",
    "common practice",
    "convention",
    "recommendation",
    "best practice",
    "standard",
    "norm",
    "guardrail",
    "paradigm",
    "style guide",
    "guideline",
]


def sample_validation_triplets(words: list[str], n: int, rng: random.Random) -> list[dict]:
    heads = rng.sample(words, n)
    out = []
    for h in heads:
        rest = [w for w in words if w != h]
        a, b = rng.sample(rest, 2)
        out.append({"head": h, "left": a, "right": b})
    return out


def sample_catch_triplets(words: list[str], n: int, rng: random.Random) -> list[dict]:
    heads = rng.sample(words, n)
    out = []
    for h in heads:
        distractor = rng.choice([w for w in words if w != h])
        if rng.random() < 0.5:
            out.append({"head": h, "left": h, "right": distractor})
        else:
            out.append({"head": h, "left": distractor, "right": h})
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--n-validation", type=int, default=10)
    p.add_argument("--n-catch", type=int, default=10)
    p.add_argument("--n-random", type=int, default=100)
    p.add_argument("--out", type=Path, default=Path("experiment/stimuli.json"))
    args = p.parse_args()

    if args.n_validation > len(WORDS) or args.n_catch > len(WORDS):
        raise SystemExit(
            f"n-validation and n-catch cannot exceed word count ({len(WORDS)})"
        )

    rng = random.Random(args.seed)
    validation = sample_validation_triplets(WORDS, args.n_validation, rng)
    catch = sample_catch_triplets(WORDS, args.n_catch, rng)

    stimuli = {
        "words": WORDS,
        "n_random_trials": args.n_random,
        "validation_triplets": validation,
        "catch_triplets": catch,
        "seed": args.seed,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(stimuli, indent=2) + "\n")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
