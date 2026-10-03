# Movie Night

Static, browser-side movie recommendations at https://tanner49.github.io/movies/.
No API, server, account, build step, or secret is needed. GitHub Pages serves the
catalog and trained movie factors alongside the JavaScript. A module Web Worker
loads and verifies the model and computes recommendations without blocking search.
Preferences are stored locally by MovieLens movie ID; nothing is submitted.

## Model

All **32,000,204 ratings** from **200,948 users** are used in the production model.
The catalog contains 87,585 titles. Training subtracts a regularized movie mean
(25 pseudo-ratings at the global mean) from observed ratings, leaving missing
entries at zero residual. Randomized truncated SVD extracts 48 factors with four
power iterations and seed 49. Movie factors are `V * sqrt(S)`, normalized by row.
This is explicit truncated SVD of a sparse residual matrix, not the SGD algorithm
sometimes also called SVD by recommender libraries.

For a new visitor, Like = 5 stars and Dislike = 1 star. We solve
`p = (Q_selected.T Q_selected + I)^-1 Q_selected.T (ratings - movie_means)`.
Predictions are `movie_mean + Q_movie p`. These provide a small secondary signal
for the neighborhood-consensus ranking described below. Existing picks
are excluded. Recommendations need 100 ratings; all titles remain searchable,
but titles with no ratings cannot be used to build a profile. Low-support picks
and small preference lists can produce less reliable results. Genre metadata
is displayed but is not used by the model.

Ranking primarily uses item-neighborhood consensus, inspired by the established
[item-item kNN similarity-sum approach](https://lenskit.org/0.14.3/knn.html).
This implementation uses SVD cosine similarities, not raw co-rating similarities.
For each candidate, transform each similarity with `max(0, (cosine - .25) / .75)`.
Add the three largest positive values and divide by `min(3, number_of_likes)`.
Missing neighbors contribute zero, so three moderate matches can outrank one
very close match. This top-three neighborhood allows a candidate to match one
interest without matching the visitor's entire list. All likes are considered.

The final score is `0.9 * consensus + 0.1 * normalized_profile_prediction
- 0.35 * dislike_consensus - 0.15 * strongest_dislike_similarity`. Dislikes use
the same top-three aggregation. With no likes, the score falls back to the
profile prediction minus `0.5 * dislike_consensus`. These blending weights and
the similarity threshold are heuristics, not validated probability estimates.
The UI shows up to three actual supporting likes rather than inflated star
predictions. All entered movies are excluded. There is no genre filter or
handwritten exclusion for a particular movie.

The worker yields during long computations and cancels outdated requests. An
LRU cache stores similarities for up to 128 seeds. A 1,000-preference history
took about 2.4 seconds in local Node testing. The browser retrieves the top 500
recommendations and reveals another 20 per click without recomputing the model.
Tanner's favorites button merges 28 matched titles into Like, preserving other
picks and moving any matching dislikes to Like. Both tiers are treated equally.
Next Goal Wins (2023) and Dune: Part Two are unavailable in this dataset.

Validation withholds five randomly chosen ratings for each of 1,000 seeded
random users before fitting both the SVD and baselines. Their remaining ratings
fit ridge profiles. RMSE on 5,000 unseen ratings is **0.81175**, compared with
**0.98099** for the regularized movie-mean baseline. Production then refits on
all ratings. This measures rating prediction with established user histories;
it does not establish ranking quality for short binary Like/Dislike profiles.
See [data/model.json](data/model.json) for metadata, checksums, and timings.

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

Training requires roughly 3–4 GB available RAM. Runtime artifacts total about
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
