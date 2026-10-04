"""Reproduce TV's positive-holdout ranking comparison (validation, not test).

python tv/training/compare_models.py --cache /path/to/amazon-tv-cache
"""
import argparse
import json
import sys
from pathlib import Path
import numpy as np
from threadpoolctl import threadpool_limits
from train import catalog, prepare, fit
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from recommender_training.mf import epoch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    threadpool_limits(1)
    matrix, _ = prepare(args.cache, catalog(args.cache))
    users = np.repeat(np.arange(matrix.shape[0], dtype=np.int32), np.diff(matrix.indptr))
    items, ratings = matrix.indices, matrix.data
    rng = np.random.default_rng(49)
    candidates = [u for u in range(matrix.shape[0])
                  if np.count_nonzero(ratings[matrix.indptr[u]:matrix.indptr[u+1]] >= 4) >= 5]
    selected = rng.choice(candidates, 200, replace=False)
    held = []
    for u in selected:
        positions = np.arange(matrix.indptr[u], matrix.indptr[u+1])
        held.append(rng.choice(positions[ratings[positions] >= 4]))
    held = np.array(held)
    excluded = np.zeros(len(ratings), bool)
    excluded[held] = True
    n = matrix.shape[1]
    popularity = np.bincount(items[~excluded], minlength=n)
    profiles = []
    for u, h in zip(selected, held):
        positions = np.arange(matrix.indptr[u], matrix.indptr[u+1])
        positions = positions[positions != h]
        profiles.append((items[positions][ratings[positions] >= 4],
                         items[positions][ratings[positions] <= 2], items[positions], items[h]))

    def evaluate(q):
        q = q/np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-8)
        ranks = []
        for likes, dislikes, seen, target in profiles:
            weights = np.clip((q@q[likes].T-.25)/.75, 0, 1)
            scores = np.sort(weights, axis=1)[:, -5:].sum(axis=1)
            if len(dislikes):
                weights = np.clip((q@q[dislikes].T-.25)/.75, 0, 1)
                scores -= np.sort(weights, axis=1)[:, -5:].sum(axis=1)
            scores[seen] = -np.inf
            order = np.lexsort((np.arange(n), -popularity, -scores))
            ranks.append(np.flatnonzero(order == target)[0]+1)
        ranks = np.array(ranks)
        return {'users':len(ranks), 'hitRate20':float(np.mean(ranks <= 20)),
                'hitRate100':float(np.mean(ranks <= 100))}

    validation = matrix.copy()
    validation.data[held] = 0
    validation.eliminate_zeros()
    factors, _, _ = fit(validation, 'positive-idf', 48)
    results = {'positive-idf':evaluate(factors)}
    rng = np.random.default_rng(49)
    p = rng.normal(0, .1, (matrix.shape[0], 48)).astype('float32')
    q = rng.normal(0, .1, (n, 48)).astype('float32')
    bu, bi = np.zeros(matrix.shape[0], 'float32'), np.zeros(n, 'float32')
    mean = float(ratings[~excluded].mean())
    shuffle = np.random.default_rng(50)
    for step in range(18):
        blocks = shuffle.permutation((len(ratings)+4095)//4096)
        offsets = shuffle.integers(0, 4096, len(blocks))
        epoch(users, items, ratings, excluded, blocks, offsets, p, q, bu, bi,
              mean, .007*.98**step, .02)
    results['observed-only-biased-sgd'] = evaluate(q)
    print(json.dumps(results, indent=2))


if __name__ == '__main__': main()
