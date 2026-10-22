# Work-type model: training run 2026-10-22 (synthetic data)

> **Synthetic data (D-45).** These scores show the pipeline works and how the model compares with the rules on data whose patterns WE wrote. They are not real-world accuracy, and this model is not served to users (`servable: false`).

Data: `synthetic_sessions_v3.csv` (feature version 3, 33 features): 2077 labelled sessions from 60 people,
443 blind labels. Evaluation: 5-fold GroupKFold by person (scores are on people the model never saw).

## Ship gate (blind labels only)

Chosen model: **logreg**. Gate: **PASSED** 

**Model (logreg), blind labels**: macro-F1 **0.943**, accuracy 0.948

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.973 | 1.0 | 0.986 | 142 |
| project | 0.944 | 0.903 | 0.923 | 113 |
| debugging | 0.877 | 0.877 | 0.877 | 65 |
| learning | 0.963 | 0.963 | 0.963 | 81 |
| setup | 0.953 | 0.976 | 0.965 | 42 |

**Rules v1, blind labels**: macro-F1 **0.693**, accuracy 0.688

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.946 | 0.62 | 0.749 | 142 |
| project | 0.575 | 0.885 | 0.697 | 113 |
| debugging | 0.517 | 0.477 | 0.496 | 65 |
| learning | 0.897 | 0.642 | 0.748 | 81 |
| setup | 0.739 | 0.81 | 0.773 | 42 |

## All labels

**Logistic regression**: macro-F1 **0.92**, accuracy 0.924

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.945 | 0.964 | 0.954 | 639 |
| project | 0.917 | 0.912 | 0.914 | 533 |
| debugging | 0.893 | 0.868 | 0.88 | 326 |
| learning | 0.929 | 0.919 | 0.924 | 385 |
| setup | 0.919 | 0.933 | 0.926 | 194 |

**Decision tree (depth 4)**: macro-F1 **0.84**, accuracy 0.848

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.93 | 0.912 | 0.921 | 639 |
| project | 0.826 | 0.88 | 0.852 | 533 |
| debugging | 0.758 | 0.712 | 0.734 | 326 |
| learning | 0.783 | 0.805 | 0.794 | 385 |
| setup | 0.933 | 0.866 | 0.898 | 194 |

**Rules v1**: macro-F1 **0.692**, accuracy 0.682

| type | precision | recall | F1 | n |
|---|---|---|---|---|
| dsa | 0.916 | 0.595 | 0.721 | 639 |
| project | 0.578 | 0.899 | 0.703 | 533 |
| debugging | 0.607 | 0.503 | 0.55 | 326 |
| learning | 0.884 | 0.616 | 0.726 | 385 |
| setup | 0.722 | 0.804 | 0.761 | 194 |

Logistic regression, confusion table (all labels, out-of-fold):

| true \ predicted | dsa | project | debugging | learning | setup | not sure |
|---|---|---|---|---|---|---|
| dsa | 616 | 3 | 7 | 13 | 0 | 0 |
| project | 0 | 486 | 26 | 7 | 14 | 0 |
| debugging | 19 | 19 | 283 | 5 | 0 | 0 |
| learning | 17 | 11 | 1 | 354 | 2 | 0 |
| setup | 0 | 11 | 0 | 2 | 181 | 0 |

Rules v1, confusion table (all labels):

| true \ predicted | dsa | project | debugging | learning | setup | not sure |
|---|---|---|---|---|---|---|
| dsa | 380 | 159 | 41 | 15 | 2 | 42 |
| project | 0 | 479 | 42 | 5 | 7 | 0 |
| debugging | 11 | 111 | 164 | 10 | 0 | 30 |
| learning | 24 | 46 | 20 | 237 | 51 | 7 |
| setup | 0 | 34 | 3 | 1 | 156 | 0 |

"Not sure" (best probability under 0.5): 1.2% of sessions.

## Per person (accuracy, all labels)

Model: median 0.927, worst 0.762.
Rules: median 0.708, worst 0.333.

## What the model leans on (largest weights, standardised features)

- **dsa**: hasPackageJson (-2.07), hasRequirements (-1.65), clonedRecently (-0.79), configFileShare (-0.64)
- **project**: hasPackageJson (+1.15), hasRequirements (+0.92), problemFileShare (-0.80), navigationsPerMin (-0.61)
- **debugging**: installShare (-1.98), navigationsPerMin (+0.78), linesPerMin (-0.54), projectSize (+0.52)
- **learning**: navigationsPerMin (+1.17), installShare (+0.88), problemFileShare (+0.68), configFileShare (-0.60)
- **setup**: navigationsPerMin (-1.74), hasPackageJson (+1.42), projectSize (-1.08), configFileShare (+0.99)

## The depth-4 tree, as rules

```
|--- configFileShare <= 0.37
|   |--- navigationsPerMin <= 0.35
|   |   |--- hasPackageJson <= 0.50
|   |   |   |--- hasRequirements <= 0.50
|   |   |   |   |--- class: dsa
|   |   |   |--- hasRequirements >  0.50
|   |   |   |   |--- class: project
|   |   |--- hasPackageJson >  0.50
|   |   |   |--- commandFailRatio <= 0.37
|   |   |   |   |--- class: project
|   |   |   |--- commandFailRatio >  0.37
|   |   |   |   |--- class: debugging
|   |--- navigationsPerMin >  0.35
|   |   |--- readingShare <= 0.55
|   |   |   |--- installShare <= 0.07
|   |   |   |   |--- class: debugging
|   |   |   |--- installShare >  0.07
|   |   |   |   |--- class: learning
|   |   |--- readingShare >  0.55
|   |   |   |--- churnRatio <= 0.52
|   |   |   |   |--- class: learning
|   |   |   |--- churnRatio >  0.52
|   |   |   |   |--- class: debugging
|--- configFileShare >  0.37
|   |--- projectSize <= 0.58
|   |   |--- navigationsPerMin <= 0.56
|   |   |   |--- noDebugRunsPerHour <= 1.81
|   |   |   |   |--- class: setup
|   |   |   |--- noDebugRunsPerHour >  1.81
|   |   |   |   |--- class: project
|   |   |--- navigationsPerMin >  0.56
|   |   |   |--- ownCommits <= 0.50
|   |   |   |   |--- class: learning
|   |   |   |--- ownCommits >  0.50
|   |   |   |   |--- class: learning
|   |--- projectSize >  0.58
|   |   |--- linesPerMin <= 1.75
|   |   |   |--- class: learning
|   |   |--- linesPerMin >  1.75
|   |   |   |--- deepShare <= 0.82
|   |   |   |   |--- class: project
|   |   |   |--- deepShare >  0.82
|   |   |   |   |--- class: learning
```
