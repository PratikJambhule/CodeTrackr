# Rating forecast (ML)

Forecasts a person's Codeforces rating change from their recent practice and contest history, and the range the
website shows. Trained on Codeforces data only; it has not been validated on CodeTrackr's own users.

## Contest-rating forecast (experiment, 2026-11-04)

How much will a person's rating change over the next 4 weeks, given their last 4 weeks of practice?
Trained on **Codeforces** (official public API: full rating history and every submission, failed
ones too, with problem tags and difficulty), as a stand-in until CodeTrackr users link LeetCode.

```bash
node ml/fetch_codeforces.js --users 300
```

```bash
python ml/train_rating_forecast.py
```

`node ml/test_fetch_codeforces.js` checks that features use only data from before each contest.
Models: gradient boosting (main) and ridge regression, against "no change" and "rating only"
baselines, scored on people the model never saw (GroupKFold by person).

| Date | Data | No change MAE | Gradient boosting MAE | Verdict |
|---|---|---|---|---|
| 2026-11-04 | 451 rows, 19 people (of 40 downloaded) | 69.3 | 74.8 | **does not beat the baseline**: far too few people; a pipeline check only |
| 2026-11-04 | 5,119 rows, 154 people (of 294), **4 weeks** ahead | 73.1 | 69.5 (rating only 70.6, ridge 69.6) | beats "no change"; practice adds ~1 point over rating alone |
| 2026-11-04 | 5,387 rows, 155 people, **8 weeks** ahead | 89.8 | 81.8 (rating only 83.9, ridge 81.4) | practice adds ~2 points; direction right 70% |
| 2026-11-04 | 5,474 rows, 155 people, **12 weeks** ahead | 99.8 | **86.9** (rating only 89.9, ridge 87.4) | best: R² 0.114 vs 0.052 for rating alone; direction right 73% |

| 2026-11-04 | Kaggle cf-userdata: 974,344 rows, 36,800 people, **4 weeks** ahead | 82.0 | **77.8** (rating only 80.1, ridge 78.6) | R² 0.063 vs 0.008; direction right 63% |
| 2026-11-04 | Kaggle cf-userdata: 1,032,610 rows, 37,141 people, **8 weeks** ahead | 98.6 | **90.5** (rating only 93.9, ridge 91.6) | R² 0.079 vs 0.012; direction right 66% |
| 2026-11-04 | **Kaggle cf-userdata: 1,053,493 rows, 37,368 people** (of 61,715), 12 weeks ahead | 110.3 | **98.7** (rating only 102.8, ridge 99.8) | **confirmed on a large set**: R² 0.089 vs 0.015 for rating alone; direction right 68% |

The Kaggle set ("Codeforces User Practice and Rating History", Alex Li, CC0, collected Dec 2022 –
Jan 2023) is converted with `node ml/build_cf_userdata.js --dir "<unzipped folder>"` (~5 min for
all users; `--limit N` for a sample), then
`CF_ROWS_CSV=ml/data/cf_userdata_rows.csv CF_HORIZON_DAYS=84 python ml/train_rating_forecast.py`.
Tests: `node ml/test_build_cf_userdata.js`. Most useful on the large set: contests so far
(experience), the last rating change (momentum), the share of hard problems solved.

`CF_HORIZON_DAYS=84` sets the horizon for both scripts.

### Rating outlook (served on the website, D-63)

`python ml/train_rating_outlook.py` trains three quantile gradient-boosting models (10th / 50th /
90th percentile of the 12-week change), checks them on held-out people, and exports
`backend/ml/ratingOutlookModel.json` plus parity cases for the Node tests.

| Held-out people | Inside the 10–90% range | Middle MAE (no change / rating only) | Pinball q10 / q50 / q90 (fixed) |
|---|---|---|---|
| 7,474 | **79.8%** (target 80%) | **98.2** (109.8 / 102.6) | 21.8 / 49.1 / 22.7 (22.6 / 51.5 / 24.5) |

What-if "25% more solves above your rating": +15 on average (shown). "6 more active days": −10
(not shown: likely confounded). Rows overlap in time for one person, but
the split is by person, so no one is in both training and testing.
