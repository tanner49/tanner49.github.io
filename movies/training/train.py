"""MovieLens adapter for the shared observed-only SGD engine."""
import argparse
import hashlib
import sys
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from recommender_training.mf import train, export


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'data')
    parser.add_argument('--rank', type=int, default=48)
    parser.add_argument('--epochs', type=int, default=30)
    args = parser.parse_args()
    cache = args.archive.parent/'sgd-cache'
    cache.mkdir(exist_ok=True)
    with zipfile.ZipFile(args.archive) as archive:
        movies = pd.read_csv(archive.open('ml-32m/movies.csv')).sort_values('movieId').reset_index(drop=True)
        digest = hashlib.md5()
        with archive.open('ml-32m/ratings.csv') as source:
            while block := source.read(8*1024*1024): digest.update(block)
        assert digest.hexdigest() == 'cf12b74f9ad4b94a011f079e26d4270a', 'Ratings checksum mismatch'
        if not (cache/'complete').exists():
            users = np.lib.format.open_memmap(cache/'users.npy', mode='w+', dtype='int32', shape=(32000204,))
            items = np.lib.format.open_memmap(cache/'items.npy', mode='w+', dtype='int32', shape=(32000204,))
            ratings = np.lib.format.open_memmap(cache/'ratings.npy', mode='w+', dtype='float32', shape=(32000204,))
            offset = 0
            for chunk in pd.read_csv(archive.open('ml-32m/ratings.csv'), usecols=['userId','movieId','rating'], dtype={'userId':'int32','movieId':'int32','rating':'float32'}, chunksize=500000):
                end = offset+len(chunk)
                users[offset:end] = chunk.userId.to_numpy()-1
                items[offset:end] = np.searchsorted(movies.movieId.to_numpy(), chunk.movieId)
                ratings[offset:end] = chunk.rating.to_numpy()
                offset = end
            assert offset == 32000204
            for array in (users, items, ratings): array.flush()
            (cache/'complete').write_text(digest.hexdigest())
        assert (cache/'complete').read_text() == digest.hexdigest()
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output/'MOVIELENS-README.txt').write_bytes(archive.read('ml-32m/README.txt'))
    users, items, ratings = [np.load(cache/(name+'.npy'), mmap_mode='r') for name in ('users','items','ratings')]
    indptr = np.concatenate([[0], np.cumsum(np.bincount(users))])
    factors, baseline, counts, meta = train(users, items, ratings, indptr, len(movies), args.rank, args.epochs)
    catalog = [[int(m.movieId),m.title,m.genres,int(counts[i]),round(float(baseline[i]),5)] for i,m in movies.iterrows()]
    meta.update(dataset='MovieLens 32M', movies=len(movies), minRecommendationRatings=100, ratingsMD5=digest.hexdigest())
    export(args.output, 'movies.json', catalog, factors, meta)


if __name__ == '__main__': main()
