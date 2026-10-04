"""Observed-only biased matrix factorization shared by movies and television.

Missing entries never enter the loss. No dense user-item matrix is constructed.
The loss is squared error plus L2 penalties on user/item factors and biases.
"""
import hashlib
import json
import time
from pathlib import Path
import numpy as np
from numba import njit


@njit(cache=True)
def epoch(users, items, ratings, excluded, blocks, offsets, p, q, bu, bi, mean, lr, reg):
    # Shuffle blocks and permute within each block. Visit every observation
    # exactly once without a 32-million-element permutation.
    for b in blocks:
        start = b * 4096
        size = min(4096, len(ratings) - start)
        for k in range(size):
            j = start + ((k * 2053 + offsets[b]) % size if size == 4096 else (k + offsets[b]) % size)
            if excluded[j]:
                continue
            u, i = users[j], items[j]
            pred = mean + bu[u] + bi[i]
            for f in range(q.shape[1]):
                pred += p[u, f] * q[i, f]
            error = ratings[j] - pred
            bu[u] += lr * (error - reg * bu[u])
            bi[i] += lr * (error - reg * bi[i])
            for f in range(q.shape[1]):
                pu, qi = p[u, f], q[i, f]
                p[u, f] += lr * (error * qi - reg * pu)
                q[i, f] += lr * (error * pu - reg * qi)


def predictions(pos, users, items, p, q, bu, bi, mean):
    u, i = users[pos], items[pos]
    return np.clip(mean + bu[u] + bi[i] + np.sum(p[u] * q[i], axis=1), .5, 5)


def train(users, items, ratings, indptr, n_items, rank=48, max_epochs=30):
    """Select epoch on validation, assess untouched test, refit ALL observations."""
    start = time.time()
    rng = np.random.default_rng(49)
    candidates = np.flatnonzero(np.diff(indptr) >= 8)
    selected = rng.choice(candidates, min(2000, len(candidates)), replace=False)
    # Separate people in validation/test; both retain training histories.
    def hold(group):
        return np.concatenate([rng.choice(np.arange(indptr[u], indptr[u+1]),
                                         min(5, (indptr[u+1]-indptr[u])//4), replace=False)
                               for u in group])
    val = hold(selected[:len(selected)//2])
    test = hold(selected[len(selected)//2:])
    held = np.concatenate([val, test])
    excluded = np.zeros(len(ratings), dtype=np.bool_)
    excluded[held] = True
    counts = np.bincount(items, minlength=n_items)
    sums = np.bincount(items, weights=ratings, minlength=n_items)
    train_counts = counts - np.bincount(items[held], minlength=n_items)
    train_sums = sums - np.bincount(items[held], weights=ratings[held], minlength=n_items)
    mean = float((ratings.sum(dtype=np.float64)-ratings[held].sum(dtype=np.float64))/(len(ratings)-len(held)))
    baseline = (train_sums + 25*mean)/(train_counts+25)
    def init():
        r = np.random.default_rng(49)
        return (r.normal(0, .1, (len(indptr)-1, rank)).astype('float32'),
                r.normal(0, .1, (n_items, rank)).astype('float32'),
                np.zeros(len(indptr)-1, 'float32'), np.zeros(n_items, 'float32'))
    def run(state, step, mean, excluded, shuffle):
        blocks = shuffle.permutation((len(ratings)+4095)//4096)
        offsets = shuffle.integers(0, 4096, size=len(blocks))
        epoch(users, items, ratings, excluded, blocks, offsets, *state, mean, .007*.98**step, .02)
    state = init()
    best, best_epoch, best_state = float('inf'), 0, None
    history = []
    shuffle = np.random.default_rng(50)
    for step in range(max_epochs):
        run(state, step, mean, excluded, shuffle)
        rmse = float(np.sqrt(np.mean((predictions(val, users, items, *state, mean)-ratings[val])**2)))
        history.append(rmse)
        print(f'Validation epoch {step+1}: RMSE {rmse:.5f}', flush=True)
        if rmse < best:
            best, best_epoch = rmse, step+1
            best_state = tuple(x.copy() for x in state)
        elif step+1-best_epoch >= 4:
            break
    metrics = {}
    for name, pos in [('validation', val), ('test', test)]:
        metrics[name] = {'ratings':len(pos), 'rmse':float(np.sqrt(np.mean((predictions(pos, users, items, *best_state, mean)-ratings[pos])**2))),
                         'movieMeanRmse':float(np.sqrt(np.mean((baseline[items[pos]]-ratings[pos])**2)))}
    print(json.dumps(metrics), flush=True)
    del state, best_state
    excluded[:] = False
    state = init()
    mean = float(ratings.mean(dtype=np.float64))
    shuffle = np.random.default_rng(50)
    for step in range(best_epoch):
        run(state, step, mean, excluded, shuffle)
        print(f'Production epoch {step+1}/{best_epoch}', flush=True)
    p, q, bu, bi = state
    # Cosine neighbors and browser ridge fold-in use normalized item factors.
    q[counts == 0] = 0
    q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-8)
    metadata = dict(version=2, model='observed-only-biased-sgd', rank=rank, seed=49,
                    ratings=len(ratings), users=len(indptr)-1, ridge=1.0, neighborLimit=5,
                    epochs=best_epoch, learningRate=.007, learningRateDecay=.98, regularization=.02,
                    globalMean=mean, missingRatings='Excluded entirely from the loss and SGD updates',
                    validation={**metrics['validation'], 'method':'Random ratings from disjoint seeded validation/test users with >=8 observations; remaining histories used for training. Epoch selected on validation RMSE only.', 'rmseByEpoch':history},
                    test={**metrics['test'], 'method':'Untouched rating holdout; evaluated once after epoch selection. Measures trained user-factor rating prediction, not browser binary-profile ranking.'},
                    factorFormat='row-major little-endian float32', trainingSeconds=round(time.time()-start))
    return q, mean+bi, counts, metadata


def export(out, name, catalog, factors, metadata):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    assert np.isfinite(factors).all()
    factors.astype('<f4').tofile(out/'factors.f32')
    (out/name).write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    metadata['factorsSHA256'] = hashlib.sha256((out/'factors.f32').read_bytes()).hexdigest()
    (out/'model.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps(metadata, indent=2), flush=True)
