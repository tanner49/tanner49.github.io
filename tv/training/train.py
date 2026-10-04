"""Build a conservative series catalog and matrix-factorization recommender from Amazon Reviews 2023.
Raw downloads/cache stay outside the website. No reviewer identifiers are exported.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','4')
import argparse
from collections import defaultdict
import gzip
import hashlib
import html
import json
from pathlib import Path
import re
import unicodedata
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, save_npz, load_npz

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

def main():
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from recommender_training.mf import train, export
    parser=argparse.ArgumentParser()
    parser.add_argument('--cache',type=Path,required=True)
    parser.add_argument('--rank',type=int,default=48)
    parser.add_argument('--epochs',type=int,default=30)
    args=parser.parse_args()
    out=Path(__file__).resolve().parents[1]/'data'
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
