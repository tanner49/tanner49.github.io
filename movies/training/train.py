"""Reproducible, memory-bounded MovieLens SVD training and browser export."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import time
import zipfile

os.environ.setdefault('OPENBLAS_NUM_THREADS', '4')
os.environ.setdefault('OMP_NUM_THREADS', '4')
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.utils.extmath import randomized_svd
from threadpoolctl import threadpool_limits

def log(message):
    print(message, flush=True)

def fit(matrix, rank):
    counts = np.diff(matrix.tocsc().indptr)
    mean = float(matrix.data.mean())
    baseline = (np.asarray(matrix.sum(axis=0)).ravel() + 25 * mean) / (counts + 25)
    residual = matrix.copy()
    residual.data -= baseline[residual.indices].astype(np.float32)
    log('Computing randomized truncated SVD…')
    with threadpool_limits(limits=4):
        _, singular, vt = randomized_svd(residual, n_components=rank, n_iter=4, random_state=49)
    factors = vt.T * np.sqrt(singular)
    # Unit movie vectors make a shared ridge penalty meaningful for new users.
    factors /= np.maximum(np.linalg.norm(factors, axis=1, keepdims=True), 1e-8)
    return factors.astype(np.float32), baseline, counts

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data')
    parser.add_argument('--rank', type=int, default=48)
    args = parser.parse_args()
    start = time.time()
    args.output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.archive) as archive:
        movies = pd.read_csv(archive.open('ml-32m/movies.csv')).sort_values('movieId').reset_index(drop=True)
        log('Reading all 32 million ratings…')
        rows, cols, values = [], [], []
        digest = hashlib.md5()
        with archive.open('ml-32m/ratings.csv') as source:
            while block := source.read(8 * 1024 * 1024):
                digest.update(block)
        assert digest.hexdigest() == 'cf12b74f9ad4b94a011f079e26d4270a', 'Ratings checksum mismatch'
        for chunk in pd.read_csv(archive.open('ml-32m/ratings.csv'), usecols=['userId','movieId','rating'], dtype={'userId':'int32','movieId':'int32','rating':'float32'}, chunksize=1_000_000):
            rows.append(chunk.userId.to_numpy() - 1)
            cols.append(np.searchsorted(movies.movieId.to_numpy(), chunk.movieId).astype(np.int32))
            values.append(chunk.rating.to_numpy())
        r, c, v = np.concatenate(rows), np.concatenate(cols), np.concatenate(values)
        del rows, cols, values, chunk
        matrix = csr_matrix((v, (r,c)), shape=(int(r.max())+1,len(movies)))
        del r,c,v
        assert matrix.nnz == 32_000_204
        (args.output / 'MOVIELENS-README.txt').write_bytes(archive.read('ml-32m/README.txt'))
    log(f'Matrix: {matrix.shape}, {matrix.nnz:,} ratings. Holding out 5 ratings for 1,000 users.')
    rng = np.random.default_rng(49)
    users = rng.choice(matrix.shape[0], 1000, replace=False)
    held = [rng.choice(np.arange(matrix.indptr[u],matrix.indptr[u+1]),5,replace=False) for u in users]
    positions = np.concatenate(held)
    truth = matrix.data[positions].copy()
    validation = matrix.copy()
    validation.data[positions] = 0
    validation.eliminate_zeros()
    factors, baseline, _ = fit(validation, args.rank)
    predictions, base_predictions = [], []
    for u, pos in zip(users, held):
        row = validation.getrow(u)
        x = factors[row.indices]
        profile = np.linalg.solve(x.T @ x + np.eye(args.rank), x.T @ (row.data-baseline[row.indices]))
        indices = matrix.indices[pos]
        predictions.extend(np.clip(baseline[indices] + factors[indices] @ profile, .5, 5))
        base_predictions.extend(baseline[indices])
    rmse = float(np.sqrt(np.mean((truth-predictions)**2)))
    base_rmse = float(np.sqrt(np.mean((truth-base_predictions)**2)))
    log(f'Holdout RMSE: {rmse:.4f}; movie-mean baseline: {base_rmse:.4f}')
    del validation
    log('Refitting production model on ALL ratings…')
    factors, baseline, counts = fit(matrix, args.rank)
    factors.astype('<f4').tofile(args.output / 'factors.f32')
    catalog = [[int(m.movieId),m.title,m.genres,int(counts[i]),round(float(baseline[i]),5)] for i,m in movies.iterrows()]
    (args.output / 'movies.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    metadata = dict(version=1,dataset='MovieLens 32M',ratings=int(matrix.nnz),users=matrix.shape[0],movies=len(movies),rank=args.rank,seed=49,iterations=4,ridge=1.0,minRecommendationRatings=100,factorFormat='row-major little-endian float32',validation={'method':'5 random held-out ratings per 1000 seeded random users; factors and baselines trained without holdout; ridge profiles from remaining ratings','ratings':5000,'rmse':rmse,'movieMeanRmse':base_rmse},ratingsMD5=digest.hexdigest(),trainingSeconds=round(time.time()-start),factorsSHA256=hashlib.sha256((args.output/'factors.f32').read_bytes()).hexdigest())
    (args.output / 'model.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    log(json.dumps(metadata,indent=2))

if __name__ == '__main__':
    main()
