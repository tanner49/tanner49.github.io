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
Predictions are `movie_mean + Q_movie p`. Results are sorted by the unbounded
prediction and displayed clipped to the dataset's 0.5–5 scale. Existing picks
are excluded. Recommendations need 100 ratings; all titles remain searchable,
but titles with no ratings cannot be used to build a profile. Low-support picks
and small preference lists can produce less reliable results. Genre metadata
is displayed but is not used by the model.

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
