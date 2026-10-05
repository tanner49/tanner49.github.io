"""Train browser-sized Steam neighbors from a pinned public playtime snapshot.

Raw data, user IDs, sparse matrices, and checkpoints stay outside the website.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import time
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, load_npz, save_npz
from sklearn.utils.extmath import randomized_svd
from threadpoolctl import threadpool_limits

PARTS = ['0', '20000', '39935', '59526']
GAME_GENRES = {'Action', 'Adventure', 'Casual', 'Indie', 'RPG', 'Simulation',
               'Strategy', 'Racing', 'Sports', 'Massively Multiplayer'}


def prepare(cache):
    if (cache/'prepared.json').exists():
        return (load_npz(cache/'played.npz'), load_npz(cache/'owned.npz'),
                json.loads((cache/'catalog.json').read_text(encoding='utf-8')),
                json.loads((cache/'prepared.json').read_text()))
    frames = [pd.read_csv(cache/p/'games.csv') for p in PARTS]
    games = pd.concat(frames, ignore_index=True).drop_duplicates('id').sort_values('id')
    games['genres'] = games.genres.map(lambda x: ast.literal_eval(x) if isinstance(x, str) else [])
    games = games[games.genres.map(lambda x: bool(GAME_GENRES.intersection(x)))]
    game_ids = games.id.to_numpy()
    mapping = {int(v):i for i,v in enumerate(game_ids)}
    rows, cols, minutes = [], [], []
    source_rows = 0
    for part in PARTS:
        for chunk in pd.read_csv(cache/part/'users_games.csv', chunksize=500000, dtype='int32'):
            source_rows += len(chunk)
            chunk['index'] = chunk.game_id.map(mapping)
            chunk = chunk.dropna(subset=['index'])
            rows.append(chunk.user_id.to_numpy(dtype='int32'))
            cols.append(chunk['index'].to_numpy(dtype='int32'))
            minutes.append(np.maximum(chunk.playtime_forever.to_numpy(dtype='float32'), 0))
    rows, cols, minutes = np.concatenate(rows), np.concatenate(cols), np.concatenate(minutes)
    # Duplicate observations across snowballs must not multiply confidence.
    frame = pd.DataFrame({'user':rows, 'game':cols, 'minutes':minutes})
    del rows, cols, minutes
    frame = frame.groupby(['user', 'game'], sort=True, as_index=False).minutes.max()
    rows = frame.user.to_numpy(dtype='int32')
    cols = frame.game.to_numpy(dtype='int32')
    minutes = frame.minutes.to_numpy(dtype='float32')
    unique_users = int(frame.user.nunique())
    del frame
    shape = (int(rows.max())+1, len(games))
    owned = csr_matrix((np.ones(len(rows), dtype='uint8'), (rows, cols)), shape=shape)
    keep = minutes >= 30
    played = csr_matrix((minutes[keep], (rows[keep], cols[keep])), shape=shape)
    del rows, cols, minutes
    # Keep a core with enough players per game and a history per user.
    user_mask = np.ones(shape[0], bool)
    game_mask = np.ones(shape[1], bool)
    for _ in range(20):
        old = (int(user_mask.sum()), int(game_mask.sum()))
        game_mask = np.asarray(played[user_mask].getnnz(axis=0)) >= 50
        user_mask = np.asarray(played[:, game_mask].getnnz(axis=1)) >= 5
        if old == (int(user_mask.sum()), int(game_mask.sum())): break
    played = played[user_mask][:, game_mask].tocsr()
    owned = owned[user_mask][:, game_mask].tocsr()
    catalog = [[int(g.id), g['name'], '|'.join(g.genres)] for _,g in games[game_mask].iterrows()]
    stats = dict(sourceOwnerships=source_rows, sourceUsers=unique_users,
                 users=played.shape[0], games=played.shape[1], playedInteractions=played.nnz,
                 minimumPlaytimeMinutes=30, minPlayersPerGame=50, minGamesPerUser=5)
    save_npz(cache/'played.npz', played)
    save_npz(cache/'owned.npz', owned)
    (cache/'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False), encoding='utf-8')
    (cache/'prepared.json').write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats), flush=True)
    return played, owned, catalog, stats


def fit(matrix, kind, rank):
    x = matrix.copy()
    if not kind.startswith('capped'): x.data[:] = 1
    else:
        # Between 1 and 2: 1,000 hours never overwhelms a short game.
        x.data = 1 + np.minimum(np.log1p(x.data/60)/np.log(21), 1)
    counts = np.bincount(x.indices, minlength=x.shape[1])
    idf_power = 0 if 'no-idf' in kind else (.5 if 'sqrt-idf' in kind else 1)
    x.data *= np.log1p(x.shape[0]/(1+counts[x.indices])).astype('float32')**idf_power
    lengths = np.sqrt(np.asarray(x.multiply(x).sum(axis=1)).ravel())
    x = x.multiply((1/np.maximum(lengths, 1e-8))[:, None]).tocsr()
    _, s, vt = randomized_svd(x, n_components=rank, n_iter=5, random_state=49)
    factors = vt.T*(s if kind.endswith('-full-s') else np.sqrt(s))
    factors /= np.maximum(np.linalg.norm(factors, axis=1, keepdims=True), 1e-8)
    return factors.astype('float32')


def split(matrix):
    rng = np.random.default_rng(49)
    candidates = np.flatnonzero(np.diff(matrix.indptr) >= 20)
    users = rng.choice(candidates, min(600, len(candidates)), replace=False)
    positions, profiles = [], []
    for u in users:
        pos = np.arange(matrix.indptr[u], matrix.indptr[u+1])
        positive = pos[matrix.data[pos] >= 60]
        if not len(positive): continue
        held = int(rng.choice(positive))
        remaining = pos[pos != held]
        liked = matrix.indices[rng.choice(remaining, min(20, len(remaining)), replace=False)]
        positions.append(held)
        profiles.append((int(u), int(matrix.indices[held]), liked))
    training = matrix.copy()
    training.data[positions] = 0
    training.eliminate_zeros()
    half = len(profiles)//2
    return training, profiles[:half], profiles[half:]


def evaluate(profiles, owned, factors, popularity):
    ranks, pop_ranks = [], []
    ids = np.arange(owned.shape[1])
    for u, target, likes in profiles:
        weights = np.clip((factors@factors[likes].T-.25)/.75, 0, 1)
        scores = np.sort(weights, axis=1)[:, -5:].sum(axis=1)
        # Match browser's neutral baseline and ridge-profile tie breaker.
        q = factors[likes]
        profile = np.linalg.solve(q.T@q + np.eye(q.shape[1]), q.T@np.full(len(likes), 2.))
        prediction = 3 + factors@profile
        seen = owned.indices[owned.indptr[u]:owned.indptr[u+1]]
        seen = seen[seen != target]
        scores[seen] = -np.inf
        order = np.lexsort((ids, -popularity, -prediction, -scores))
        ranks.append(int(np.flatnonzero(order == target)[0])+1)
        pop = popularity.copy().astype('float64')
        pop[seen] = -np.inf
        order = np.lexsort((ids, -pop))
        pop_ranks.append(int(np.flatnonzero(order == target)[0])+1)
    def metrics(ranks):
        ranks = np.asarray(ranks)
        return dict(users=len(ranks), hitRate20=float(np.mean(ranks <= 20)),
                    hitRate100=float(np.mean(ranks <= 100)), medianRank=float(np.median(ranks)),
                    ndcg20=float(np.mean(np.where(ranks <= 20, 1/np.log2(ranks+1), 0))))
    return {'model':metrics(ranks), 'popularity':metrics(pop_ranks)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--rank', type=int, default=48)
    args = parser.parse_args()
    start = time.time()
    out = Path(__file__).resolve().parents[1]/'data'
    out.mkdir(exist_ok=True, parents=True)
    matrix, owned, catalog, stats = prepare(args.cache)
    training, validation, test = split(matrix)
    pop = np.bincount(training.indices, minlength=matrix.shape[1])
    metrics = {}
    best_factors = None
    with threadpool_limits(4):
        for kind in ['binary-idf', 'capped-playtime-idf', 'binary-no-idf', 'binary-no-idf-full-s', 'binary-sqrt-idf-full-s', 'binary-idf-full-s']:
            factors = fit(training, kind, args.rank)
            metrics[kind] = evaluate(validation, owned, factors, pop)
            print(kind, json.dumps(metrics[kind]), flush=True)
            np.save(args.cache/(kind+'-validation-factors.npy'), factors)
        selected = max(metrics, key=lambda k: (metrics[k]['model']['ndcg20'], metrics[k]['model']['hitRate20']))
        best_factors = np.load(args.cache/(selected+'-validation-factors.npy'))
        test_metrics = evaluate(test, owned, best_factors, pop)
        print('Independent test', selected, json.dumps(test_metrics), flush=True)
        factors = fit(matrix, selected, args.rank)
    counts = np.bincount(matrix.indices, minlength=matrix.shape[1])
    catalog = [row+[int(counts[i]), 3.0] for i,row in enumerate(catalog)]
    factors.astype('<f4').tofile(out/'factors.f32')
    (out/'games.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    hashes = {}
    for part in PARTS:
        for name in ['games.csv', 'users_games.csv']:
            digest = hashlib.sha256()
            with open(args.cache/part/name, 'rb') as f:
                while block := f.read(8*1024*1024): digest.update(block)
            hashes[f'{part}/{name}'] = digest.hexdigest()
    meta = dict(version=1, dataset='Steam Game Ownership and User Friendships',
                sourceRevision=json.loads((args.cache/'dataset-info.json').read_text())['sha'],
                snapshotPublished='2024-04-04', collectionCutoff='Not documented; contains early-2024 releases',
                **stats, rank=args.rank, seed=49, model=selected, ridge=1., neighborLimit=5,
                minRecommendationRatings=50, neutralBaseline=3.,
                validation={'method':'600 seeded users with >=20 played games: one >=60-minute game held out each; Up to 20 remaining played games form Likes. First 300 select weighting, other 300 form independent test. Held-out entries from both groups excluded from factor fitting. All other owned games excluded from recommendations. Catalog/core filtering precedes split. No negative ratings exist in source. Test inspected during development; exploratory results, not a pristine final benchmark.', 'models':metrics},
                test=test_metrics, sourceFiles=hashes, trainingSeconds=round(time.time()-start),
                factorsSHA256=hashlib.sha256((out/'factors.f32').read_bytes()).hexdigest(),
                factorFormat='row-major little-endian float32')
    (out/'model.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(json.dumps(meta, indent=2), flush=True)


if __name__ == '__main__': main()
