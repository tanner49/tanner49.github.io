# Game Night

Live: https://tanner49.github.io/games/

Static Steam game recommendations using the same browser ranking engine as
Movie Night and TV Night. Search, Like/Dislike, contributor explanations, and up
to 500 recommendations run locally in a worker. Preferences are stored by Steam
app ID under `game-night-preferences-v1`, independently of the other apps.

## Data and recency

The [source dataset](https://huggingface.co/datasets/steamgamerecommender/data_files_public)
contains 25,228,753 ownership records across 79,314 users and 34,088 app IDs.
The April 2024 publication includes Helldivers 2, Palworld, Baldur's Gate 3,
and Elden Ring. Its precise collection cutoff is unknown; it is not a current
Steam feed. Games released after the snapshot may be missing.

We retain apps with game genres, merge duplicate user/game pairs by maximum
playtime, and treat >=30 minutes played as an interaction. Unplayed ownership is
neither a Like nor a Dislike. Iterative filtering requires >=50 players per game
and >=5 played games per user. The deployed core has 12,830 games, 71,118 users,
and 11,321,738 played-game interactions. Friendship data is not used.

## Model

The selected model uses binary played-game feedback weighted by inverse item
frequency, `log(1 + user_count / (1 + game_player_count))`, then normalizes each
user row. A seeded 48-factor truncated SVD produces item vectors `V * S`, which
are normalized for cosine similarity. Other candidates use capped playtime,
weaker/no inverse-frequency weighting, or `V * sqrt(S)`; validation selects the
variant. Missing interactions are zeros in this implicit-feedback SVD, not
explicit low star ratings. This is intentionally different from observed-only SGD.

The shared `movies/model.mjs` sums the five strongest Like similarities and
subtracts the five strongest Dislike similarities, using its existing 0.25 cosine
threshold. Every entered game is excluded. A ridge profile breaks exact ties and
serves dislike-only profiles. Catalog baseline 3 is a neutral constant solely for
compatibility with that fold-in; there are no inferred game star ratings. Match
scores are similarity sums, not probabilities.

## Evaluation and limitations

We remove one >=60-minute interaction for each of 600 seeded users with >=20
played games. Twenty other played games form each profile. Both validation and
test targets are removed before fitting; other owned games are excluded from
ranking. The first 300 users select the variant by NDCG@20, and the other 300
evaluate it. Catalog/core filtering precedes the split. Test results were
inspected during development and are exploratory, not a pristine final benchmark.

The selected model's test hit rate is **6.33% at 20** and **16.0% at 100**, versus
**18.33% / 37.33%** for popularity. This first experiment does **not** beat that
baseline. Sample coherent-interest profiles produce plausible neighbors, but
that is qualitative inspection, not proof of better recommendations. The
random-history protocol tests broad interests across a large catalog and cannot
establish that a particular Like/Dislike list will work well. All metrics and
candidate comparisons are in `data/model.json`.

Playtime is not enjoyment; the dataset has no explicit dislikes. Short games
can be missed by the threshold, and public friend-network sampling can introduce
bias. Tags and descriptions are not used to train the taste factors. We do not
claim that the dataset is representative of all Steam users.

## Reproduce

Use Python 3.10, install `training/requirements.txt`, and download each
`games.csv` and `users_games.csv` from upstream partitions `0`, `20000`, `39935`,
and `59526` to an external cache, preserving the subdirectories. Also save the
upstream dataset API response as `dataset-info.json` and its `README.md`.
Pin the revision recorded in `data/model.json`; do not use a moving snapshot.

```sh
python games/training/download.py --cache /path/to/steam-cache
python games/training/train.py --cache /path/to/steam-cache
node --test games/tests/model.test.mjs
```

Preparation caches `played.npz`, `owned.npz`, `catalog.json`, and `prepared.json`
outside the repository. Use a fresh cache if changing preparation rules. Raw
downloads occupy roughly 500 MB; site artifacts are only a few MB. The worker
verifies factor length and SHA-256. No credentials or server are required.

See [ATTRIBUTION.md](ATTRIBUTION.md) for authors and the declared GPL v3 license.
