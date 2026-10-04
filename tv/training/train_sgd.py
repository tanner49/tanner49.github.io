"""Experimental TV adapter for the shared observed-only SGD engine.
Outputs to the external cache by default; does not overwrite the deployed model.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from train import catalog, prepare

def main():
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from recommender_training.mf import train, export
    parser=argparse.ArgumentParser()
    parser.add_argument('--cache',type=Path,required=True)
    parser.add_argument('--rank',type=int,default=48)
    parser.add_argument('--epochs',type=int,default=30)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    out=args.output or args.cache/'sgd-artifacts'
    groups=catalog(args.cache)
    matrix,groups=prepare(args.cache,groups)
    users=np.repeat(np.arange(matrix.shape[0],dtype=np.int32),np.diff(matrix.indptr))
    factors,baseline,counts,meta=train(users,matrix.indices,matrix.data,matrix.indptr,matrix.shape[1],args.rank,args.epochs)
    shows=[[g['id'],g['title'],'|'.join(g['genres']) or 'TV series',int(counts[i]),round(float(baseline[i]),5),len(g['products'])] for i,g in enumerate(groups)]
    meta.update(json.loads((args.cache/'preparation-v2.json').read_text()))
    meta.update(dataset='Amazon Reviews 2023 Movies & TV',minRecommendationRatings=50,sourceFiles={})
    for name in ['meta_Movies_and_TV.jsonl.gz','Movies_and_TV.csv.gz']:
        digest=hashlib.sha256()
        with open(args.cache/name,'rb') as f:
            while block:=f.read(8*1024*1024):digest.update(block)
        meta['sourceFiles'][name]=digest.hexdigest()
    export(out,'shows.json',shows,factors,meta)
    (out/'series-map.json').write_text(json.dumps(groups,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

if __name__=='__main__':main()
