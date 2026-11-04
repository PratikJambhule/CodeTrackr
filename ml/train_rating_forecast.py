"""
Contest-rating forecast: how much will a person's Codeforces rating change over the next 4 weeks,
given their last 4 weeks of practice? Trained on ml/data/codeforces_rating_rows.csv
(built by `node ml/fetch_codeforces.js`).

Every score is measured on PEOPLE the model never saw (GroupKFold by handle), and the models must
beat two baselines:
  - "no change"        predict 0;
  - "rating only"      a line through the current rating alone (high ratings tend to fall back,
                       low ones to rise: regression to the mean, the obvious effect to rule out).

  python ml/train_rating_forecast.py
"""
import os
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).parent
CSV = Path(os.environ["CF_ROWS_CSV"]) if os.environ.get("CF_ROWS_CSV") else ROOT / "data" / "codeforces_rating_rows.csv"
REPORT = ROOT / "reports" / f"{date.today().isoformat()}-{CSV.stem}-{int(os.environ.get('CF_HORIZON_DAYS', '28'))}d.md"
SEED = 20261104
TARGET = "y_delta"
HORIZON = int(os.environ.get("CF_HORIZON_DAYS", "28"))
META = ["handle", "t", "future_contests", TARGET]


def scores(y, p):
    err = p - y
    moved = np.abs(y) >= 25  # direction only counts when the rating really moved
    return {
        "MAE": float(np.mean(np.abs(err))),
        "RMSE": float(np.sqrt(np.mean(err ** 2))),
        "R2": float(1 - np.sum(err ** 2) / np.sum((y - y.mean()) ** 2)),
        "direction": float(np.mean(np.sign(p[moved]) == np.sign(y[moved]))) if moved.any() else float("nan"),
    }


def out_of_fold(make, X, y, groups, folds):
    pred = np.zeros(len(y))
    for train, test in GroupKFold(n_splits=folds).split(X, y, groups):
        pred[test] = make().fit(X.iloc[train], y.iloc[train]).predict(X.iloc[test])
    return pred


def main():
    if not CSV.exists():
        sys.exit(f"{CSV} not found: run `node ml/fetch_codeforces.js` first")
    df = pd.read_csv(CSV)
    features = [c for c in df.columns if c not in META]
    X, y, groups = df[features], df[TARGET].to_numpy(), df["handle"]
    people = groups.nunique()
    folds = min(5, people)
    if folds < 3:
        sys.exit(f"only {people} people with usable rows: download more")

    models = {
        "no change (baseline)": None,
        "rating only (baseline)": lambda: LinearRegression(),
        "ridge regression": lambda: make_pipeline(StandardScaler(), Ridge(alpha=10.0)),
        "gradient boosting": lambda: HistGradientBoostingRegressor(max_depth=3, learning_rate=0.03, max_iter=300, min_samples_leaf=80,
                                                                    l2_regularization=5.0, random_state=SEED),
    }
    results = {}
    for name, make in models.items():
        if make is None:
            pred = np.zeros(len(y))
        elif name.startswith("rating only"):
            pred = out_of_fold(make, df[["rating"]], df[TARGET], groups, folds)
        else:
            pred = out_of_fold(make, X, df[TARGET], groups, folds)
        results[name] = scores(y, pred)

    gb = models["gradient boosting"]().fit(X, y)
    # On a large table, permutation importance on every row is slow and no more informative.
    sample = df.sample(n=min(len(df), 50000), random_state=SEED)
    imp = permutation_importance(gb, sample[features], sample[TARGET], n_repeats=5, random_state=SEED, scoring="neg_mean_absolute_error")
    top = sorted(zip(features, imp.importances_mean), key=lambda kv: -kv[1])[:10]

    lines = [
        f"# Contest-rating forecast: run {date.today().isoformat()} (Codeforces, public API)",
        "",
        f"Data: {len(df)} rows from {people} people. Target: rating change over the next {HORIZON} days "
        f"(mean {y.mean():+.1f}, typical size {np.mean(np.abs(y)):.1f}). Evaluation: {folds}-fold GroupKFold "
        "by person, so every score is on people the model never saw.",
        "",
        "| model | MAE | RMSE | R² | direction right |",
        "|---|---|---|---|---|",
    ]
    for name, s in results.items():
        lines.append(f"| {name} | {s['MAE']:.1f} | {s['RMSE']:.1f} | {s['R2']:.3f} | {s['direction']:.0%} |")
    lines += ["", "Most useful features (gradient boosting, permutation importance on MAE):", ""]
    lines += [f"- `{f}`: {v:.2f}" for f, v in top]
    lines += ["", "MAE = average size of the error in rating points (lower is better). Direction = share of real "
              "moves of 25+ points whose sign (up / down) was predicted right."]
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\nreport: {REPORT.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
