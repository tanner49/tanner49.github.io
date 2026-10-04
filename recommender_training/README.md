# Shared movie/TV matrix factorization

Both dataset adapters call `mf.train` and `mf.export`. Both websites import
`movies/model.mjs` for ranking. Data cleaning and catalogs remain dataset-specific.

Training predicts `global_mean + user_bias + item_bias + dot(user, item)`.
SGD minimizes squared error on observed ratings only, with L2 regularization on
both factors and biases. Missing entries have no training loss or update. There
is no imputed zero, dense matrix, positive-only transform, or randomized SVD.
Each epoch shuffles blocks of observations and permutes each block, visiting
every retained observation once. The last partial block is handled separately.

Defaults: 48 factors, seed 49, learning rate 0.007 decaying by 0.98 each epoch,
regularization 0.02, maximum 30 epochs, validation patience 4. Validation/test
holdouts use disjoint sampled users with at least eight ratings and retain the
rest of their histories for training. The epoch with lowest validation RMSE is
selected, its untouched test RMSE reported, then production refits all ratings
for that many epochs. This is a modest starting configuration, not an exhaustive
hyperparameter search. `model.json` records the actual selected epoch.

Item vectors are normalized after fitting for the existing cosine-neighbor
ranking. Only item factors, global mean plus item biases, and public catalog
metadata ship to the browser. User vectors and raw ratings remain local.
The browser fits a regularized profile in the normalized coordinate system;
it is a different estimator from the trained user factors used in RMSE testing.
That profile is only a tie-breaker or a dislike-only fallback. The main ranking
remains the sum of the five strongest liked similarities minus the five strongest
disliked similarities, with the existing cosine threshold of 0.25.

Run training through `movies/training/train.py` or `tv/training/train.py`.
Run gradient/missing-data regression tests from the repository root:

```sh
python -m unittest recommender_training.test_mf
```
