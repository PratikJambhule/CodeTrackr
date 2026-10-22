"""
Train and evaluate the work-type classifier (ML plan §10-§11, change C-17).

    python ml/train_work_type.py [--data ml/data/synthetic_sessions.csv]

1. Logistic regression (first choice) and a depth-4 decision tree, both with balanced class weights.
2. GroupKFold by person, 5 folds: every score is measured on people the model never saw.
3. Per-type precision / recall / F1, macro-F1, confusion table, "not sure" rate.
4. Rules v1 (the ruleType column, produced by backend/services/workType.js) scored on the same rows.
5. The ship gate (ML plan §11), measured on BLIND labels only:
     model macro-F1 >= rules macro-F1 + 0.05, and no type's recall more than 0.05 below the rules'.
6. Fit the chosen model on all rows and write backend/ml/workTypeModel.json, parity fixtures for the
   JavaScript test, and a report in ml/reports/.

If the data is synthetic (source column), the model file says so and the API will not serve it.
"""
import argparse
import datetime as dt
import json
import pathlib

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, f1_score, precision_recall_fscore_support
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier, export_text

ROOT = pathlib.Path(__file__).resolve().parent.parent
# The feature list comes from the CSV: every column after "activeMin", in order. The generator and the
# export script write them from backend/services/workTypeFeatures.js, so the order always matches.
FEATURES_V2 = [  # backend/services/workTypeFeatures.js FEATURES (version 2), kept for a check
    "linesPerMin", "churnRatio", "readRatio", "pasteShare", "switchesPerMin", "filesTouched",
    "commandsPerMin", "runShare", "packageShare", "commandFailRatio", "buildFailRatio", "testShare",
    "debugPerHour", "commitsPerHour", "deepShare",
    "problemFileShare", "configFileShare", "practiceFolder",
]
CLASSES = ["dsa", "project", "debugging", "learning", "setup"]
NOT_SURE_BELOW = 0.5
SEED = 7


def logreg():
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000))


def tree():
    return DecisionTreeClassifier(max_depth=4, class_weight="balanced", random_state=SEED)


def scores(y_true, y_pred):
    p, r, f, n = precision_recall_fscore_support(y_true, y_pred, labels=CLASSES, zero_division=0)
    return {
        "macroF1": round(float(f1_score(y_true, y_pred, labels=CLASSES, average="macro", zero_division=0)), 3),
        "accuracy": round(float(np.mean(np.array(y_true) == np.array(y_pred))), 3),
        "perType": {c: {"precision": round(float(p[i]), 3), "recall": round(float(r[i]), 3), "f1": round(float(f[i]), 3),
                        "n": int(n[i])} for i, c in enumerate(CLASSES)},
        "confusion": confusion_matrix(y_true, y_pred, labels=CLASSES + ["not_sure"]).tolist(),
    }


def out_of_fold(make, X, y, groups):
    pred = np.empty(len(y), dtype=object)
    proba = np.zeros((len(y), len(CLASSES)))
    for train, test in GroupKFold(n_splits=5).split(X, y, groups):
        m = make().fit(X[train], y[train])
        order = [list(m.classes_).index(c) for c in CLASSES]
        pr = m.predict_proba(X[test])[:, order]
        proba[test] = pr
        pred[test] = np.array(CLASSES)[pr.argmax(1)]
    return pred, proba


def gate(model_s, rules_s):
    reasons = []
    if model_s["macroF1"] < rules_s["macroF1"] + 0.05:
        reasons.append(f"macro-F1 {model_s['macroF1']} is not >= rules {rules_s['macroF1']} + 0.05")
    for c in CLASSES:
        if model_s["perType"][c]["recall"] < rules_s["perType"][c]["recall"] - 0.05:
            reasons.append(f"{c} recall {model_s['perType'][c]['recall']} is more than 0.05 below the rules'")
    return {"passed": not reasons, "reasons": reasons}


def table(s, title):
    lines = [f"**{title}**: macro-F1 **{s['macroF1']}**, accuracy {s['accuracy']}", "",
             "| type | precision | recall | F1 | n |", "|---|---|---|---|---|"]
    lines += [f"| {c} | {v['precision']} | {v['recall']} | {v['f1']} | {v['n']} |" for c, v in s["perType"].items()]
    return "\n".join(lines)


def confusion_md(s):
    head = "| true \\ predicted | " + " | ".join(CLASSES + ["not sure"]) + " |"
    rows = [f"| {c} | " + " | ".join(str(x) for x in s["confusion"][i]) + " |" for i, c in enumerate(CLASSES)]
    return "\n".join([head, "|" + "---|" * (len(CLASSES) + 2)] + rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "ml/data/synthetic_sessions_v3.csv"))
    args = ap.parse_args()

    d = pd.read_csv(args.data)
    global FEATURES
    FEATURES = list(d.columns[list(d.columns).index("activeMin") + 1:])
    feature_version = int(d["featureVersion"].iloc[0])
    assert (d["featureVersion"] == feature_version).all(), "one feature version per training run"
    if feature_version == 2:
        assert FEATURES == FEATURES_V2, "version-2 columns differ from workTypeFeatures.FEATURES"
    d = d[d["label"].isin(CLASSES)].reset_index(drop=True)
    source = "synthetic" if (d["source"] == "synthetic").any() else "real"
    X = d[FEATURES].to_numpy(dtype=float)
    y = d["label"].to_numpy()
    groups = d["personId"].to_numpy()
    blind = d["blind"].to_numpy() == 1

    lr_pred, lr_proba = out_of_fold(logreg, X, y, groups)
    tr_pred, _ = out_of_fold(tree, X, y, groups)
    rules = d["ruleType"].to_numpy()

    res = {
        "logreg_all": scores(y, lr_pred), "tree_all": scores(y, tr_pred), "rules_all": scores(y, rules),
        "logreg_blind": scores(y[blind], lr_pred[blind]), "tree_blind": scores(y[blind], tr_pred[blind]),
        "rules_blind": scores(y[blind], rules[blind]),
    }
    # the simplest model within 0.02 macro-F1 of the best wins; logistic regression counts as simplest
    chosen = "logreg" if res["logreg_all"]["macroF1"] >= res["tree_all"]["macroF1"] - 0.02 else "tree"
    notsure = float(np.mean(lr_proba.max(1) < NOT_SURE_BELOW))
    g = gate(res[f"{chosen}_blind"], res["rules_blind"])
    # how each method does per person, so one person can't hide a failure
    per_person = pd.DataFrame({"person": groups, "y": y, "m": lr_pred, "r": rules}).groupby("person").apply(
        lambda t: pd.Series({"model": np.mean(t.y == t.m), "rules": np.mean(t.y == t.r), "n": len(t)}), include_groups=False)

    # final model on all rows
    final = logreg().fit(X, y)
    scaler, lr = final.named_steps["standardscaler"], final.named_steps["logisticregression"]
    order = [list(lr.classes_).index(c) for c in CLASSES]
    today = dt.date.today().isoformat()
    model = {
        "version": f"wt-{today}-{source}",
        "trainedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "trainingData": source,
        "servable": source == "real" and g["passed"],
        "featureVersion": feature_version,
        "labelCount": int(len(d)), "people": int(d["personId"].nunique()),
        "features": FEATURES, "classes": CLASSES,
        "means": [round(float(v), 10) for v in scaler.mean_], "stds": [round(float(v), 10) for v in scaler.scale_],
        "weights": [[round(float(w), 10) for w in lr.coef_[i]] for i in order],
        "bias": [round(float(lr.intercept_[i]), 10) for i in order],
        "notSureBelow": NOT_SURE_BELOW,
        "scores": {"chosen": chosen, "macroF1_blind": res[f"{chosen}_blind"]["macroF1"],
                   "rulesMacroF1_blind": res["rules_blind"]["macroF1"], "notSureRate": round(notsure, 3), "gate": g},
    }
    out = ROOT / "backend/ml/workTypeModel.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(model, indent=1) + "\n")

    # parity fixtures: JavaScript must reproduce these probabilities (backend/tests/workTypeModel.test.js)
    rng = np.random.default_rng(SEED)
    idx = sorted(rng.choice(len(d), size=20, replace=False).tolist())
    full = final.predict_proba(X[idx])[:, order]
    fixtures = [{"sessionId": d.loc[i, "sessionId"], "vector": [float(v) for v in X[i]],
                 "proba": [float(v) for v in full[k]]} for k, i in enumerate(idx)]
    fx = ROOT / "backend/tests/fixtures/workTypeParity.json"
    fx.parent.mkdir(parents=True, exist_ok=True)
    fx.write_text(json.dumps({"modelVersion": model["version"], "cases": fixtures}, indent=1) + "\n")

    # explainability: the strongest weights per type (on standardised features)
    top = {c: sorted(zip(FEATURES, model["weights"][k]), key=lambda t: -abs(t[1]))[:4] for k, c in enumerate(CLASSES)}
    tree_rules = export_text(tree().fit(X, y), feature_names=FEATURES, max_depth=4)

    rep = ROOT / f"ml/reports/{today}-{source}-v{feature_version}.md"
    rep.parent.mkdir(parents=True, exist_ok=True)
    warn = ("> **Synthetic data (D-45).** These scores show the pipeline works and how the model compares with "
            "the rules on data whose patterns WE wrote. They are not real-world accuracy, and this model is "
            "not served to users (`servable: false`).\n\n") if source == "synthetic" else ""
    rep.write_text(f"""# Work-type model: training run {today} ({source} data)

{warn}Data: `{pathlib.Path(args.data).name}` (feature version {feature_version}, {len(FEATURES)} features): {len(d)} labelled sessions from {d['personId'].nunique()} people,
{int(blind.sum())} blind labels. Evaluation: 5-fold GroupKFold by person (scores are on people the model never saw).

## Ship gate (blind labels only)

Chosen model: **{chosen}**. Gate: **{'PASSED' if g['passed'] else 'FAILED'}** {('; '.join(g['reasons'])) if g['reasons'] else ''}

{table(res[f'{chosen}_blind'], f'Model ({chosen}), blind labels')}

{table(res['rules_blind'], 'Rules v1, blind labels')}

## All labels

{table(res['logreg_all'], 'Logistic regression')}

{table(res['tree_all'], 'Decision tree (depth 4)')}

{table(res['rules_all'], 'Rules v1')}

Logistic regression, confusion table (all labels, out-of-fold):

{confusion_md(res['logreg_all'])}

Rules v1, confusion table (all labels):

{confusion_md(res['rules_all'])}

"Not sure" (best probability under {NOT_SURE_BELOW}): {notsure:.1%} of sessions.

## Per person (accuracy, all labels)

Model: median {per_person['model'].median():.3f}, worst {per_person['model'].min():.3f}.
Rules: median {per_person['rules'].median():.3f}, worst {per_person['rules'].min():.3f}.

## What the model leans on (largest weights, standardised features)

""" + "\n".join(f"- **{c}**: " + ", ".join(f"{f} ({w:+.2f})" for f, w in top[c]) for c in CLASSES) + f"""

## The depth-4 tree, as rules

```
{tree_rules}```
""")
    print(json.dumps({"source": source, "sessions": len(d), "people": int(d['personId'].nunique()), "chosen": chosen,
                      "model_blind_macroF1": res[f'{chosen}_blind']['macroF1'], "tree_all_macroF1": res['tree_all']['macroF1'],
                      "logreg_all_macroF1": res['logreg_all']['macroF1'], "rules_blind_macroF1": res['rules_blind']['macroF1'],
                      "featureVersion": feature_version, "gate": g, "notSure": round(notsure, 3), "servable": model["servable"]}, indent=1))
    print("wrote", out.relative_to(ROOT), fx.relative_to(ROOT), rep.relative_to(ROOT))


if __name__ == "__main__":
    main()
