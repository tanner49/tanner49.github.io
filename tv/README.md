# TV Night: first Amazon experiment

Live app: https://tanner49.github.io/tv/

The frontend runs entirely in the browser. It uses the same ranking engine as
`/movies/`, with separate local preferences and a different trained catalog/model.
Both apps sum similarity weights from the **five closest liked titles** and
subtract weights from the **five closest disliked titles**. Counts do not determine
the order. Results exclude entered titles and can be expanded to 500 recommendations.

## Data preparation

Source: McAuley Lab's Amazon Reviews 2023 Movies & TV category. Downloads:

- https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/meta_categories/meta_Movies_and_TV.jsonl.gz
- https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/benchmark/0core/rating_only/Movies_and_TV.csv.gz

All 17,158,519 rows in the official deduplicated ratings-only file were scanned.
Explicit TV categories or season/complete-series markers anchor the series
catalog. Titles are normalized conservatively; season and format suffixes are
removed. Streaming titles are included only if they exactly match an anchored
normalized TV title. Untagged physical movie listings are not added just because
their names match a show. No fuzzy matching is used.

The initial match contains 1,444,287 product ratings. Multiple products/seasons
reviewed by one person are averaged into one series rating. Iterative filtering
retains series with at least 50 reviewers and reviewers with at least three
series. The final matrix contains **230,516 ratings, 46,452 reviewers, and 1,205
series**. `data/series-map.json` makes the retained product mapping inspectable.
No reviewer identifiers, review text, or user factors are published.

## Model and validation

Two 48-factor randomized SVD variants were evaluated with seed 49 and five power
iterations: centered explicit ratings, and positive ratings weighted by inverse
item frequency. The latter performed better and is deployed. It transforms
ratings with `max(0, (rating - 3) / 2)`, weights each item by
`log(1 + user_count / (1 + positive_user_count))`, and L2-normalizes user rows.
Item factors are `V * sqrt(S)`, then normalized per item for cosine similarity.
All retained ratings inform baseline means; ratings of 3 or below contribute
zero to this positive-interaction SVD. App dislikes subtract neighbor evidence.

Validation holds out one positively rated series for each of 500 seeded users
with at least five positive series. Factors are fit without those ratings and
the browser's top-five weighted-neighbor rule ranks unseen shows against the
full retained catalog. Hit rate at 20 is **16.2%**, versus **10.2%** for popularity
and **10.2%** for centered-rating SVD. Hit rate at 100 is **37.2%**, versus **30.4%**
for popularity. Production refits on all retained ratings. This validation set
was used to select the model; it is not an independent final test. These results
do not guarantee recommendation quality for every short Like/Dislike list.

## Observed-only SGD experiment

The shared movie SGD trainer was also trained on TV ratings. Its independent
rating-test RMSE was 0.81918 versus 0.92659 for series means, but its cosine
neighbors produced much worse recommendations. On a separate 200-user positive
holdout comparison, top-20 hit rate was 1.0% for SGD versus 14.5% for the previous
positive-IDF model (top-100: 8.5% versus 43.0%). Both models were refit without
those held-out ratings. The comparison uses the same top-five weighting rule,
with popularity breaking ties, rather than the browser's ridge tie-breaker.
This is a validation comparison, not an independent final ranking test.

Experiments with 8/16/48 factors, smaller initialization, and longer SGD training
also failed to close the gap. The previous TV model is therefore deployed;
movies use observed-only SGD. Both still share the browser ranking engine.
The experimental adapter remains available as `training/train_sgd.py`; it uses
`recommender_training/mf.py` and saves outside the site by default. See
[data/sgd-experiment.json](data/sgd-experiment.json) and `training/compare_models.py`.

## Reproduce and test

Use Python 3.10 and `training/requirements.txt`. Download both archives to a cache
outside the website; they occupy approximately 621 MB in total. Then:

```sh
python tv/training/train.py --cache /path/to/amazon-tv-cache
python tv/training/test_titles.py
node --test movies/tests/model.test.mjs tv/tests/model.test.mjs
python -m http.server 8766
```

The trainer caches the cleaned catalog and sparse rating matrix outside the repo.
If changing title preparation, use new cache filenames or remove the named cached
artifacts before retraining. Source SHA-256 digests and validation are recorded
in `data/model.json`. Runtime needs only `shows.json`, `model.json`, and
`factors.f32` (under 0.5 MB total). `series-map.json` is an optional audit download.

## Limits

This is a research prototype. DVD-era and established shows have stronger
coverage; streaming-only and recent shows can be absent. Data ends in September
2023. Reviews may concern packaging, delivery, or discs rather than the show.
Title-only grouping may retain duplicates or conflate identically named remakes;
explicit country qualifiers are kept, but unqualified listings remain ambiguous.
Source TV category labels can be wrong. The UI discloses these limitations.

See [ATTRIBUTION.md](ATTRIBUTION.md) for sources and upstream license context.
