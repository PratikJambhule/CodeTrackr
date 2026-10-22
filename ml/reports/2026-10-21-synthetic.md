# Work-type model: training run 2026-10-21 (synthetic data)

> **Synthetic data (D-45).** These scores show the pipeline works and how the model compares with the rules on data whose patterns WE wrote. They are not real-world accuracy, and this model is not served to users (`servable: false`).

Data: `synthetic_sessions.csv`: 1961 labelled sessions from 60 people,
407 blind labels. Evaluation: 5-fold GroupKFold by person (scores are on people the model never saw).

## Ship gate (blind labels only)

Chosen model: **logreg**. Gate: **PASSED** 

**Model (logreg), blind labels**: macro-F1 **0.869**, accuracy 0.875

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.925 | 0.899 | 0.912 | 109 |
| project | 0.904 | 0.873 | 0.888 | 118 |
| debugging | 0.79 | 0.79 | 0.79 | 62 |
| learning | 0.789 | 0.909 | 0.845 | 66 |
| setup | 0.939 | 0.885 | 0.911 | 52 |

**Rules v1, blind labels**: macro-F1 **0.61**, accuracy 0.651

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.908 | 0.725 | 0.806 | 109 |
| project | 0.618 | 0.907 | 0.735 | 118 |
| debugging | 0.596 | 0.452 | 0.514 | 62 |
| learning | 0.808 | 0.636 | 0.712 | 66 |
| setup | 0.75 | 0.173 | 0.281 | 52 |

## All labels

**Logistic regression**: macro-F1 **0.878**, accuracy 0.881

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.934 | 0.903 | 0.918 | 484 |
| project | 0.895 | 0.862 | 0.878 | 552 |
| debugging | 0.824 | 0.858 | 0.84 | 310 |
| learning | 0.851 | 0.88 | 0.865 | 358 |
| setup | 0.869 | 0.907 | 0.888 | 257 |

**Decision tree (depth 4)**: macro-F1 **0.742**, accuracy 0.736

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.944 | 0.659 | 0.776 | 484 |
| project | 0.75 | 0.732 | 0.741 | 552 |
| debugging | 0.524 | 0.661 | 0.585 | 310 |
| learning | 0.665 | 0.793 | 0.724 | 358 |
| setup | 0.872 | 0.903 | 0.887 | 257 |

**Rules v1**: macro-F1 **0.59**, accuracy 0.624

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.933 | 0.717 | 0.811 | 484 |
| project | 0.584 | 0.862 | 0.696 | 552 |
| debugging | 0.562 | 0.5 | 0.529 | 310 |
| learning | 0.859 | 0.595 | 0.703 | 358 |
| setup | 0.727 | 0.125 | 0.213 | 257 |

Logistic regression, confusion table (all labels, out-of-fold):

| true \ predicted | dsa | project | debugging | learning | setup | not sure |
|---|---|---|---|---|---|---|
| dsa | 437 | 9 | 18 | 20 | 0 | 0 |
| project | 1 | 476 | 29 | 19 | 27 | 0 |
| debugging | 13 | 19 | 266 | 12 | 0 | 0 |
| learning | 17 | 11 | 7 | 315 | 8 | 0 |
| setup | 0 | 17 | 3 | 4 | 233 | 0 |

Rules v1, confusion table (all labels):

| true \ predicted | dsa | project | debugging | learning | setup | not sure |
|---|---|---|---|---|---|---|
| dsa | 347 | 73 | 29 | 6 | 0 | 29 |
| project | 2 | 476 | 59 | 5 | 1 | 9 |
| debugging | 11 | 91 | 155 | 17 | 3 | 33 |
| learning | 12 | 64 | 20 | 213 | 8 | 41 |
| setup | 0 | 111 | 13 | 7 | 32 | 94 |

"Not sure" (best probability under 0.5): 4.8% of sessions.

## Per person (accuracy, all labels)

Model: median 0.880, worst 0.667.
Rules: median 0.647, worst 0.233.

## What the model leans on (largest weights, standardised features)

- **dsa**: configFileShare (-1.35), packageShare (-1.21), problemFileShare (+0.82), switchesPerMin (-0.70)
- **project**: problemFileShare (-1.47), readRatio (-0.81), packageShare (+0.78), linesPerMin (+0.67)
- **debugging**: testShare (+0.91), pasteShare (-0.81), churnRatio (+0.71), runShare (-0.45)
- **learning**: readRatio (+1.11), testShare (-0.96), problemFileShare (+0.79), switchesPerMin (+0.75)
- **setup**: configFileShare (+2.32), readRatio (-0.63), packageShare (+0.60), switchesPerMin (-0.39)

## The depth-4 tree, as rules

```
|--- configFileShare <= 0.26
|   |--- problemFileShare <= 0.17
|   |   |--- linesPerMin <= 2.33
|   |   |   |--- testShare <= 0.05
|   |   |   |   |--- class: learning
|   |   |   |--- testShare >  0.05
|   |   |   |   |--- class: debugging
|   |   |--- linesPerMin >  2.33
|   |   |   |--- commandFailRatio <= 0.33
|   |   |   |   |--- class: project
|   |   |   |--- commandFailRatio >  0.33
|   |   |   |   |--- class: debugging
|   |--- problemFileShare >  0.17
|   |   |--- linesPerMin <= 0.70
|   |   |   |--- runShare <= 0.66
|   |   |   |   |--- class: learning
|   |   |   |--- runShare >  0.66
|   |   |   |   |--- class: dsa
|   |   |--- linesPerMin >  0.70
|   |   |   |--- switchesPerMin <= 0.89
|   |   |   |   |--- class: dsa
|   |   |   |--- switchesPerMin >  0.89
|   |   |   |   |--- class: learning
|--- configFileShare >  0.26
|   |--- configFileShare <= 0.57
|   |   |--- filesTouched <= 3.50
|   |   |   |--- churnRatio <= 0.27
|   |   |   |   |--- class: setup
|   |   |   |--- churnRatio >  0.27
|   |   |   |   |--- class: debugging
|   |   |--- filesTouched >  3.50
|   |   |   |--- readRatio <= 0.65
|   |   |   |   |--- class: setup
|   |   |   |--- readRatio >  0.65
|   |   |   |   |--- class: learning
|   |--- configFileShare >  0.57
|   |   |--- commitsPerHour <= 5.74
|   |   |   |--- filesTouched <= 9.50
|   |   |   |   |--- class: setup
|   |   |   |--- filesTouched >  9.50
|   |   |   |   |--- class: setup
|   |   |--- commitsPerHour >  5.74
|   |   |   |--- churnRatio <= 0.07
|   |   |   |   |--- class: project
|   |   |   |--- churnRatio >  0.07
|   |   |   |   |--- class: setup
```
