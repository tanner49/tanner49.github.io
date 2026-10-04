# Movie Night

Static, browser-side movie recommendations at https://tanner49.github.io/movies/.
No API, server, account, build step, or secret is needed. GitHub Pages serves the
catalog and trained movie factors alongside the JavaScript. A module Web Worker
loads and verifies the model and computes recommendations without blocking search.
Preferences are stored locally by MovieLens movie ID; nothing is submitted.

## Model

All **32,000,204 ratings** from **200,948 users** are used in the production model.
The catalog contains 87,585 titles. Movies use the
[observed-only SGD trainer](../recommender_training/mf.py), also available for TV
experiments, with 48-dimensional factors. TV retains its previous similarity model
after SGD substantially reduced held-out recommendation quality. Prediction during training is global mean + user bias +
title bias + the user/item factor dot product. Each epoch visits only actual
ratings; missing ratings are never filled with zeros or added to the loss.
L2 regularization discourages overfitting. Low ratings remain real observations.
Item factors are normalized for the browser's cosine-neighbor ranking.

For a new visitor, Like = 5 stars and Dislike = 1 star. We solve
`p = (Q_selected.T Q_selected + I)^-1 Q_selected.T (ratings - item_baselines)`.
Predictions are `global_mean + item_bias + Q_movie p`. These break exact similarity-score ties
and provide a fallback for dislike-only profiles. Existing picks are excluded.
Recommendations need 100 ratings; all titles remain searchable, but titles with
no ratings cannot be used to build a profile. Genre metadata is display-only.

Ranking uses item-neighborhood similarity sums, inspired by the established
[item-item kNN similarity-sum approach](https://lenskit.org/0.14.3/knn.html).
For every candidate and every preference, transform factor cosine similarity with
`weight = max(0, (cosine - .25) / .75)`, capped at 1 for numerical roundoff.
Only the five strongest liked weights and five strongest disliked weights
contribute per candidate. There is no division by contributor count. Weak similarities below the threshold contribute zero.

The ranking score is exactly `sum(top 5 liked weights) - sum(top 5 disliked weights)`.
The fitted user vector only breaks exact ties; dislike-only profiles instead
use `normalized_profile_prediction - sum(disliked weights)`. The threshold is
heuristic and the displayed score is neither a probability nor a star rating.

The UI displays the weighted score separately from the full supporting-like
count. Its compact explanation previews three titles; expandable details list
all five (or fewer) contributing likes and weight, plus positive/negative totals. Only
explanation previews are shortened. All entered movies are excluded, and there
are no handwritten title exclusions or genre filters.

The worker yields during long computations and cancels outdated requests. An
LRU cache stores similarities for up to 128 seeds. A 1,000-preference history
took about 2.4 seconds in local Node testing. The browser retrieves the top 500
recommendations and reveals another 20 per click without recomputing the model.
Tanner's favorites button merges 28 matched titles into Like, preserving other
picks and moving any matching dislikes to Like. Both tiers are treated equally.
Next Goal Wins (2023) and Dune: Part Two are unavailable in this dataset.

Training selects an epoch using a seeded rating holdout, then evaluates a
separate untouched test holdout, and refits on all ratings for deployment.
Validation/test users are disjoint; each retains an observed training history.
See [data/model.json](data/model.json) for RMSE, baseline comparison, epoch history,
hyperparameters, checksums, and timings. The test measures trained user-vector
rating prediction, not the browser's binary Like/Dislike recommendation quality.
The earlier truncated-SVD score used a different split and inference method and
is not a direct comparison. Hyperparameters are a starting configuration, not an
exhaustive search; the ranking threshold and five-neighbor rule stay unchanged.

## Reproduce

Use Python 3.10 and dependencies in `training/requirements.txt`. Download the
[MovieLens 32M archive](https://files.grouplens.org/datasets/movielens/ml-32m.zip)
outside this repo (about 239 MB). The trainer verifies the official ratings MD5,
reads directly from the archive, evaluates, refits, and exports all site assets:

```sh
python -m pip install -r movies/training/requirements.txt
python movies/training/train.py --archive /path/to/ml-32m.zip
python -m http.server 8765
# Open http://localhost:8765/movies/
node --test movies/tests/model.test.mjs
```

Ratings are memory-mapped outside the repository to keep training memory bounded. Runtime artifacts total about
22.4 MB before HTTP compression; no user factors or raw ratings are published.
Do not commit the raw archive or install dependencies inside the published tree.
Deploy by committing the `movies/` directory to the existing Pages source branch.
Module workers require HTTP(S), not opening `index.html` through `file://`.

## Attribution and data license

F. Maxwell Harper and Joseph A. Konstan. 2015. *The MovieLens Datasets: History
and Context.* ACM Transactions on Interactive Intelligent Systems 5, 4, Article
19. https://doi.org/10.1145/2827872

The data and derived model are redistributed under the original
[MovieLens license](data/MOVIELENS-README.txt). Its conditions include research
use, attribution, no implied endorsement, and permission from GroupLens before
commercial or revenue-bearing use. This noncommercial demo is independent of
GroupLens and the University of Minnesota. Ratings end in October 2023.
