"""
Rating outlook (D-63): a RANGE for a person's Codeforces rating change over the next 12 weeks,
from their last 4 weeks of practice. Three gradient-boosting models predict the 10th, 50th and 90th
percentile; the range q10..q90 should hold about 8 in 10 outcomes. Trained on the Kaggle
cf-userdata table (`node ml/build_cf_userdata.js --dir <folder>` with CF_HORIZON_DAYS=84).

Checked on PEOPLE the model never saw (20% of people held out): coverage of the range, the median's
error against "no change" and "rating only", and pinball loss against fixed percentiles.

Exports backend/ml/ratingOutlookModel.json (the trees, evaluated in Node by
backend/services/ratingOutlook.js) and backend/tests/fixtures/ratingOutlookParity.json (Python
predictions JavaScript must match).

  python ml/train_rating_outlook.py
"""
import json
import os
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import GroupShuffleSplit

ROOT = Path(__file__).parent
CSV = Path(os.environ.get("CF_ROWS_CSV", ROOT / "data" / "cf_userdata_rows.csv"))
MODEL = ROOT.parent / "backend" / "ml" / "ratingOutlookModel.json"
PARITY = ROOT.parent / "backend" / "tests" / "fixtures" / "ratingOutlookParity.json"
REPORT = ROOT / "reports" / f"{date.today().isoformat()}-rating-outlook.md"
SEED = 20261105
QUANTILES = [0.1, 0.5, 0.9]
FEATURES = ["rating", "prev_delta", "contests_so_far", "contests_60d", "days_since_prev_contest", "subs_28d",
            "solved_28d", "solved_prev_28d", "fail_ratio_28d", "active_days_28d", "solved_rating_mean",
            "solved_rating_max", "hard_share", "easy_share"]
TRAIN_ROWS = 400_000  # enough for stable trees; keeps training to a few minutes


def make(q):
    return HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=150, max_leaf_nodes=15, learning_rate=0.08,
                                         min_samples_leaf=200, l2_regularization=1.0, random_state=SEED)


def pinball(y, p, q):
    d = y - p
    return float(np.mean(np.maximum(q * d, (q - 1) * d)))


def export_trees(model):
    trees = []
    for (predictor,) in model._predictors:
        n = predictor.nodes
        trees.append({
            "f": n["feature_idx"].astype(int).tolist(),
            "t": [float(x) for x in n["num_threshold"]],
            "l": n["left"].astype(int).tolist(),
            "r": n["right"].astype(int).tolist(),
            "leaf": n["is_leaf"].astype(int).tolist(),
            "v": [round(float(x), 6) for x in n["value"]],
            "m": n["missing_go_to_left"].astype(int).tolist(),
        })
    return {"baseline": float(np.ravel(model._baseline_prediction)[0]), "trees": trees}


def main():
    if not CSV.exists():
        sys.exit(f"{CSV} not found: build it with ml/build_cf_userdata.js (CF_HORIZON_DAYS=84)")
    df = pd.read_csv(CSV, usecols=["handle", *FEATURES, "y_delta"])
    train_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED).split(df, groups=df["handle"]))
    train, test = df.iloc[train_idx], df.iloc[test_idx]
    fit_on = train.sample(n=min(TRAIN_ROWS, len(train)), random_state=SEED)
    X, y = fit_on[FEATURES], fit_on["y_delta"]
    Xt, yt = test[FEATURES], test["y_delta"].to_numpy()

    models = {q: make(q).fit(X, y) for q in QUANTILES}
    pred = {q: models[q].predict(Xt) for q in QUANTILES}
    lo, mid, hi = pred[0.1], pred[0.5], pred[0.9]
    coverage = float(np.mean((yt >= lo) & (yt <= hi)))
    width = float(np.median(hi - lo))
    rating_only = LinearRegression().fit(train[["rating"]], train["y_delta"]).predict(test[["rating"]])
    fixed = {q: float(np.quantile(train["y_delta"], q)) for q in QUANTILES}
    pin_model = {q: pinball(yt, pred[q], q) for q in QUANTILES}
    pin_fixed = {q: pinball(yt, np.full(len(yt), fixed[q]), q) for q in QUANTILES}

    # What-ifs the page offers, averaged over held-out people (the model's estimate, not a promise).
    def what_if(change):
        X2 = Xt.copy()
        change(X2)
        return float(np.mean(models[0.5].predict(X2) - mid))
    harder = what_if(lambda d: d.update({"hard_share": np.minimum(1, d["hard_share"] + 0.25), "easy_share": np.maximum(0, d["easy_share"] - 0.25)}))
    more_days = what_if(lambda d: d.update({"active_days_28d": np.minimum(28, d["active_days_28d"] + 6)}))

    metrics = {
        "people_test": int(test["handle"].nunique()), "rows_test": int(len(test)), "rows_train": int(len(fit_on)),
        "coverage_80": round(coverage, 3), "median_width": round(width, 1),
        "mae_median": round(float(np.mean(np.abs(mid - yt))), 1),
        "mae_no_change": round(float(np.mean(np.abs(yt))), 1),
        "mae_rating_only": round(float(np.mean(np.abs(rating_only - yt))), 1),
        "pinball_model": {str(q): round(v, 2) for q, v in pin_model.items()},
        "pinball_fixed": {str(q): round(v, 2) for q, v in pin_fixed.items()},
        "what_if_harder_avg": round(harder, 1), "what_if_more_days_avg": round(more_days, 1),
    }

    # Final models on all training people, exported for Node.
    full = df.sample(n=min(TRAIN_ROWS, len(df)), random_state=SEED + 1)
    final = {q: make(q).fit(full[FEATURES], full["y_delta"]) for q in QUANTILES}
    version = f"cf-outlook-{date.today().isoformat()}"
    MODEL.write_text(json.dumps({
        "version": version, "trainedOn": "Kaggle cf-userdata (Codeforces, ~61k users, Dec 2022 - Jan 2023)",
        "horizonDays": 84, "features": FEATURES, "quantiles": QUANTILES, "metrics": metrics,
        "models": {str(q): export_trees(final[q]) for q in QUANTILES},
    }, separators=(",", ":")))

    cases = test.sample(n=20, random_state=SEED)[FEATURES]
    PARITY.parent.mkdir(parents=True, exist_ok=True)
    PARITY.write_text(json.dumps({"modelVersion": version, "cases": [
        {"features": {f: (None if pd.isna(row[f]) else float(row[f])) for f in FEATURES},
         "expected": {str(q): float(final[q].predict(pd.DataFrame([row[FEATURES]]))[0]) for q in QUANTILES}}
        for _, row in cases.iterrows()]}, indent=1))

    lines = [f"# Rating outlook: run {date.today().isoformat()} ({CSV.name})", "",
             f"Held-out people: {metrics['people_test']} ({metrics['rows_test']} rows); trained on {metrics['rows_train']} rows.", "",
             "| measure | value |", "|---|---|",
             f"| share of real outcomes inside the 10–90% range (aim 0.80) | {coverage:.3f} |",
             f"| typical range width (rating points) | {width:.0f} |",
             f"| median prediction MAE | {metrics['mae_median']} (no change {metrics['mae_no_change']}, rating only {metrics['mae_rating_only']}) |",
             f"| pinball loss q10 / q50 / q90, model | {pin_model[0.1]:.2f} / {pin_model[0.5]:.2f} / {pin_model[0.9]:.2f} |",
             f"| pinball loss q10 / q50 / q90, fixed percentiles | {pin_fixed[0.1]:.2f} / {pin_fixed[0.5]:.2f} / {pin_fixed[0.9]:.2f} |",
             f"| what-if: 25% more of solves above your rating (avg median change) | {harder:+.1f} |",
             f"| what-if: 6 more active days in 4 weeks (avg median change) | {more_days:+.1f} |", "",
             f"Exported {MODEL.relative_to(ROOT.parent)} ({MODEL.stat().st_size // 1024} KB) and 20 parity cases."]
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
