"""Build a conservative series catalog and SVD recommender from Amazon Reviews 2023.
Raw downloads/cache stay outside the website. No reviewer identifiers are exported.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','4')
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import html
import json
from pathlib import Path
import re
import time
import unicodedata
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, save_npz, load_npz
from sklearn.utils.extmath import randomized_svd
from threadpoolctl import threadpool_limits

TV_CATEGORIES={'TV','Television','TV Series','TV & Miniseries','British Television','Classic TV'}
GENRES={'Comedy','Drama','Action','Adventure','Action & Adventure','Suspense','Thriller','Mystery','Crime','Science Fiction','Science Fiction & Fantasy','Fantasy','Animation','Anime','Documentary','Kids & Family','Romance','Horror','Military & War','Western','Reality TV'}
SEASON=re.compile(r'\b(?:(?:the\s+)?complete\s+)?(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final|[0-9]+(?:st|nd|rd|th))\s+)?seasons?\b|\b(?:the\s+)?complete\s+series\b|\bseries\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|[IVX]+)\b',re.I)

def clean_title(title):
    title=html.unescape(title or '').replace('\u2013','-').replace('\u2014','-')
    title=re.sub(r'\[[^\]]*\]','',title)
    title=re.sub(r'\((?:[^)]*(?:DVD|Blu.?ray|Region|Import|Digital|format|subtitled)[^)]*)\)','',title,flags=re.I)
    title=re.sub(r'\bcomplete\s+(original|animated|classic|TV)\s+series\b',r'\1 Series',title,flags=re.I)
    match=SEASON.search(title)
    evidence=bool(match)
    if match: title=title[:match.start()]
    # Combined seasons and compound ordinals leave suffix fragments after the
    # season marker is cut. Remove the whole marketing prefix, not just a number.
    title=re.sub(r'\s*[:,-]?\s+(?:the\s+)?complete\b.*$','',title,flags=re.I)
    title=re.sub(r'\s*\(?\b(?:DVD|Blu.?ray|VHS|4K UHD|box set|collection|vol(?:ume)?\.?\s*\d+|episodes?\s*\d+).*$', '', title, flags=re.I)
    title=re.sub(r'\b(?:the\s+)?complete\s*$','',title,flags=re.I)
    title=re.sub(r'^Masterpiece(?:\s+Classic|\s+Mystery)?\s*:\s*','',title,flags=re.I)
    title=re.sub(r',\s*The\s*$', '',title,flags=re.I)
    title=title.strip(' :-.,;(|')
    title=re.sub(r'\s*[-:]\s*The$','',title,flags=re.I)
    title=re.sub(r'\bOriginal TV Series\b','Original Series',title,flags=re.I)
    title=re.sub(r'\s+',' ',title)
    return title,evidence

def key(title):
    value=unicodedata.normalize('NFKD',title).encode('ascii','ignore').decode().lower().replace('&',' and ')
    value=re.sub(r'^the\s+','',value)
    return re.sub(r'[^a-z0-9]+','',value)

def catalog(cache):
    path=cache/'catalog-v2.json'
    if path.exists(): return json.loads(path.read_text(encoding='utf-8'))
    products=[];anchors=set()
    with gzip.open(cache/'meta_Movies_and_TV.jsonl.gz','rt',encoding='utf-8') as source:
        for line in source:
            product=json.loads(line);title,evidence=clean_title(product.get('title'))
            categories=product.get('categories') or []
            evidence=evidence or bool(TV_CATEGORIES.intersection(categories))
            if len(title)<2 or len(title)>110 or re.search(r'\b(?:clip|trailer|workout|fitness)\b',title,re.I): continue
            normalized=key(title)
            if evidence: anchors.add(normalized)
            products.append([product['parent_asin'],title,normalized,sorted(GENRES.intersection(categories)),int(product.get('rating_number') or 0),evidence,product.get('main_category')=='Prime Video'])
    groups=defaultdict(list)
    for p in products:
        # Untagged streaming listings must exactly match a TV anchor. Untagged
        # physical movies with the same name are deliberately not added.
        if p[2] in anchors and (p[5] or p[6]): groups[p[2]].append(p)
    result=[]
    for normalized,items in sorted(groups.items()):
        preferred=max(items,key=lambda p:(p[4],p[6],-len(p[1])))
        result.append({'id':normalized,'title':preferred[1],'genres':sorted(set(g for p in items for g in p[3])),
                       'products':[p[0] for p in items],'examples':sorted(set(p[1] for p in items))[:5]})
    path.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    print(f'Catalog: {len(result):,} candidate series / {sum(len(g["products"]) for g in result):,} products',flush=True)
    return result

def prepare(cache,groups):
    if (cache/'ratings-v2.npz').exists():
        return load_npz(cache/'ratings-v2.npz'),json.loads((cache/'selected-v2.json').read_text(encoding='utf-8'))
    mapping={asin:i for i,g in enumerate(groups) for asin in g['products']};frames=[];total=0
    for chunk in pd.read_csv(cache/'Movies_and_TV.csv.gz',chunksize=500000,dtype={'rating':'float32'},usecols=['user_id','parent_asin','rating']):
        total+=len(chunk);chunk['series']=chunk.parent_asin.map(mapping)
        frames.append(chunk.dropna(subset=['series'])[['user_id','series','rating']])
    frame=pd.concat(frames,ignore_index=True);del frames
    raw=len(frame)
    # One person contributes once to a series, regardless of seasons/editions.
    frame=frame.groupby(['user_id','series'],sort=False,as_index=False).rating.mean()
    for _ in range(20):
        old=len(frame)
        frame=frame[frame.groupby('series').series.transform('size')>=50]
        frame=frame[frame.groupby('user_id').user_id.transform('size')>=3]
        if len(frame)==old: break
    selected_ids=sorted(frame.series.unique().astype(int));selected=[groups[i] for i in selected_ids]
    cols=frame.series.map({v:i for i,v in enumerate(selected_ids)}).to_numpy(dtype=np.int32)
    rows,users=pd.factorize(frame.user_id,sort=True)
    matrix=csr_matrix((frame.rating.to_numpy(dtype=np.float32),(rows,cols)),shape=(len(users),len(selected)))
    save_npz(cache/'ratings-v2.npz',matrix)
    (cache/'selected-v2.json').write_text(json.dumps(selected,ensure_ascii=False),encoding='utf-8')
    stats={'sourceRatings':total,'matchedProductRatings':raw,'seriesRatings':matrix.nnz,'users':matrix.shape[0],'series':matrix.shape[1]}
    (cache/'preparation-v2.json').write_text(json.dumps(stats,indent=2))
    print(stats,flush=True)
    return matrix,selected

def fit(matrix,kind,rank):
    counts=np.bincount(matrix.indices,minlength=matrix.shape[1]);mean=float(matrix.data.mean())
    baseline=(np.asarray(matrix.sum(axis=0)).ravel()+25*mean)/(counts+25)
    x=matrix.copy()
    if kind=='residual': x.data-=baseline[x.indices].astype(np.float32)
    else:
        x.data=np.maximum(0,(x.data-3)/2);x.eliminate_zeros()
        frequencies=np.bincount(x.indices,minlength=x.shape[1])
        x.data*=np.log1p(x.shape[0]/(1+frequencies[x.indices])).astype(np.float32)
        lengths=np.sqrt(np.asarray(x.multiply(x).sum(axis=1)).ravel())
        x=x.multiply((1/np.maximum(lengths,1e-8))[:,None]).tocsr()
    with threadpool_limits(limits=4):
        _,s,vt=randomized_svd(x,n_components=rank,n_iter=5,random_state=49)
    factors=vt.T*np.sqrt(s)
    factors/=np.maximum(np.linalg.norm(factors,axis=1,keepdims=True),1e-8)
    return factors.astype(np.float32),baseline,counts

def evaluate(matrix,users,held,factors):
    hits20=hits100=0;ranks=[]
    for u,target in zip(users,held):
        row=matrix.getrow(u);liked=row.indices[row.data>=4];disliked=row.indices[row.data<=2]
        if not len(liked):continue
        weights=np.maximum(0,(factors@factors[liked].T-.25)/.75)
        sims=np.sort(weights,axis=1)[:,-5:].sum(axis=1)
        if len(disliked):
            weights=np.maximum(0,(factors@factors[disliked].T-.25)/.75)
            sims-=np.sort(weights,axis=1)[:,-5:].sum(axis=1)
        sims[row.indices]=-np.inf
        order=np.lexsort((np.arange(len(sims)),-sims));rank=int(np.flatnonzero(order==target)[0])+1
        ranks.append(rank);hits20+=rank<=20;hits100+=rank<=100
    return {'users':len(ranks),'hitRate20':hits20/len(ranks),'hitRate100':hits100/len(ranks),'medianRank':float(np.median(ranks))}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--rank',type=int,default=48)
    args=parser.parse_args();start=time.time();out=Path(__file__).resolve().parents[1]/'data';out.mkdir(parents=True,exist_ok=True)
    groups=catalog(args.cache);matrix,groups=prepare(args.cache,groups)
    candidates=[]
    for u in range(matrix.shape[0]):
        row=matrix.getrow(u)
        if np.sum(row.data>=4)>=5:candidates.append(u)
    rng=np.random.default_rng(49);users=rng.choice(candidates,min(500,len(candidates)),replace=False)
    validation=matrix.copy();held=[]
    for u in users:
        positions=np.arange(matrix.indptr[u],matrix.indptr[u+1]);position=rng.choice(positions[matrix.data[positions]>=4]);held.append(matrix.indices[position]);validation.data[position]=0
    validation.eliminate_zeros();metrics={}
    for kind in ['residual','positive-idf']:
        print(f'Training/evaluating {kind}',flush=True);factors,baseline,counts=fit(validation,kind,args.rank)
        with threadpool_limits(limits=4):metrics[kind]=evaluate(validation,users,held,factors)
        print(metrics[kind],flush=True)
    pop=np.bincount(validation.indices,minlength=matrix.shape[1]);hits20=hits100=0
    for u,target in zip(users,held):
        scores=pop.copy();scores[validation.getrow(u).indices]=-1
        order=np.lexsort((np.arange(len(scores)),-scores));rank=int(np.flatnonzero(order==target)[0])+1;hits20+=rank<=20;hits100+=rank<=100
    metrics['popularity']={'users':len(users),'hitRate20':hits20/len(users),'hitRate100':hits100/len(users)}
    best=max(['residual','positive-idf'],key=lambda k:metrics[k]['hitRate20'])
    print(f'Refitting {best} on all retained ratings',flush=True);factors,baseline,counts=fit(matrix,best,args.rank)
    factors.astype('<f4').tofile(out/'factors.f32')
    shows=[[g['id'],g['title'],'|'.join(g['genres']) or 'TV series',int(counts[i]),round(float(baseline[i]),5),len(g['products'])] for i,g in enumerate(groups)]
    (out/'shows.json').write_text(json.dumps(shows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    # Product mapping is inspectable but carries no reviewer identifiers/text.
    (out/'series-map.json').write_text(json.dumps(groups,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    stats=json.loads((args.cache/'preparation-v2.json').read_text())
    metadata=dict(version=1,dataset='Amazon Reviews 2023 Movies & TV',**stats,rank=args.rank,ridge=1.0,neighborLimit=5,minRecommendationRatings=50,model=best,seed=49,validation={'method':'Seeded one-positive-series holdout for up to 500 users with at least five positive series; model selection on this validation set, not an independent test','models':metrics},factorFormat='row-major little-endian float32',factorsSHA256=hashlib.sha256((out/'factors.f32').read_bytes()).hexdigest(),trainingSeconds=round(time.time()-start),sourceFiles={})
    for name in ['meta_Movies_and_TV.jsonl.gz','Movies_and_TV.csv.gz']:
        digest=hashlib.sha256()
        with open(args.cache/name,'rb') as f:
            while block:=f.read(8*1024*1024):digest.update(block)
        metadata['sourceFiles'][name]=digest.hexdigest()
    (out/'model.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8');print(json.dumps(metadata,indent=2),flush=True)

if __name__=='__main__':main()
