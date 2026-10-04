import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {recommend,solve,createRecommender} from '../model.mjs';
import {favorites} from '../favorites.mjs';

test('ridge solve satisfies normal equations',()=>{
  const a=[4,1,1,3],b=[1,2],x=solve(a,b,2);
  assert.ok(Math.abs(4*x[0]+x[1]-1)<1e-10);
  assert.ok(Math.abs(x[0]+3*x[1]-2)<1e-10);
});

test('fourth and fifth likes count; the sixth adds no weight and dislikes also cap at five',()=>{
  const movies=Array.from({length:12},(_,i)=>[i,'Movie '+i,'',1000,3]);
  const factors=new Float32Array(12).fill(1),meta={rank:1,ridge:1,minRecommendationRatings:100};
  for(let count=3;count<=5;count++) {
    const result=recommend(movies,factors,meta,Array.from({length:count},(_,i)=>[i,5])).find(r=>r.index===5);
    assert.equal(result.rankScore,count);
    assert.equal(result.supportCount,count);
    assert.equal(result.contributions.length,count);
    assert.equal(result.contributions.reduce((s,c)=>s+c.weight,0),result.rankScore);
  }
  const capped=recommend(movies,factors,meta,Array.from({length:6},(_,i)=>[i,5])).find(r=>r.index===11);
  assert.equal(capped.rankScore,5);assert.equal(capped.supportCount,5);assert.equal(capped.contributions.length,5);
  const negative=recommend(movies,factors,meta,[[0,5],...[1,2,3,4,5,6].map(i=>[i,1])]).find(r=>r.index===11);
  assert.equal(negative.negativeScore,5);assert.equal(negative.oppositionCount,5);assert.equal(negative.rankScore,-4);
  const result=recommend(movies,factors,meta,[[0,5],[1,5],[2,5],[3,5],[4,1]])[0];
  assert.equal(result.rankScore,3);
  assert.equal(result.positiveScore,4);
  assert.equal(result.negativeScore,1);
});

test('two strong neighbors outrank five weak neighbors: weighted sums, not counts',()=>{
  const rank=8,movies=Array.from({length:9},(_,i)=>[i,'Movie '+i,'',1000,3]);
  const factors=new Float32Array(9*rank);
  for(let i=0;i<7;i++) factors[i*rank+i]=1;
  for(let k=0;k<5;k++) factors[7*rank+k]=.3;
  factors[7*rank+7]=Math.sqrt(1-5*.3*.3);
  factors[8*rank+5]=factors[8*rank+6]=1/Math.sqrt(2);
  const results=recommend(movies,factors,{rank,ridge:1,minRecommendationRatings:100},Array.from({length:7},(_,i)=>[i,5]));
  assert.equal(results[0].index,8);assert.equal(results[0].supportCount,2);
  assert.equal(results[1].index,7);assert.equal(results[1].supportCount,5);
  assert.ok(results[0].rankScore>results[1].rankScore);
});

test('agreement across three moderate neighbors beats a single exact match',()=>{
  const movies=Array.from({length:5},(_,i)=>[i,'Movie '+i,'',1000,3]);
  const v=1/Math.sqrt(3),factors=new Float32Array([1,0,0,0,1,0,0,0,1,1,0,0,v,v,v]);
  const results=recommend(movies,factors,{rank:3,ridge:1,minRecommendationRatings:100},[[0,5],[1,5],[2,5]]);
  assert.equal(results[0].index,4);
  assert.equal(results[0].reasons.length,3);
  assert.equal(results[1].reasons.length,1);
  const reduced=recommend(movies,factors,{rank:3,ridge:1,minRecommendationRatings:100},[[0,5],[1,1],[2,5]]);
  assert.ok(reduced.find(r=>r.index===4).rankScore<results[0].rankScore);
});

test('long mixed histories, deterministic ranking, cached updates, and cancellation',async()=>{
  const read=path=>readFileSync(new URL('../data/'+path,import.meta.url));
  const movies=JSON.parse(read('movies.json')),meta=JSON.parse(read('model.json')),buffer=read('factors.f32');
  const factors=new Float32Array(buffer.buffer,buffer.byteOffset,buffer.byteLength/4),engine=createRecommender(movies,factors,meta);
  const indices=movies.map((m,i)=>i).filter(i=>movies[i][3]>=100).sort((a,b)=>movies[b][3]-movies[a][3]).slice(0,1000);
  const prefs=indices.map((i,j)=>[i,j%3?5:1]),excluded=new Set(indices),liked=new Set(prefs.filter(p=>p[1]===5).map(p=>p[0]));
  const started=performance.now(),results=engine.recommend(prefs);
  console.log(`1,000-preference production benchmark: ${Math.round(performance.now()-started)} ms`);
  assert.equal(results.length,20);
  assert.ok(results.every((r,i)=>i===0||r.rankScore<=results[i-1].rankScore));
  for(const r of results) { assert.ok(!excluded.has(r.index));assert.ok(Number.isFinite(r.prediction)); }
  const seed=favorites.filter(f=>f.id!==null).map(f=>[movies.findIndex(m=>m[0]===f.id),5]);
  assert.equal(seed.length,28);assert.ok(seed.every(([i])=>i>=0));
  const first=engine.recommend(seed);
  const extended=engine.recommend(seed,500);
  assert.equal(extended.length,500);
  assert.equal(new Set(extended.map(r=>r.index)).size,500);
  assert.deepEqual(extended.slice(0,20),first);
  const seedSet=new Set(seed.map(p=>p[0]));
  for(const r of extended) {
    assert.ok(!seedSet.has(r.index));
    assert.ok(r.reasons.every(i=>seedSet.has(i)));
    assert.equal(r.reasons.length,r.supportCount);
    assert.ok(Math.abs(r.contributions.reduce((s,c)=>s+c.weight,0)-r.positiveScore)<1e-8);
    assert.equal(r.rankScore,r.positiveScore-r.negativeScore);
  }
  assert.ok(extended.some(r=>r.supportCount===5));
  assert.ok(extended.every(r=>r.supportCount<=5&&r.oppositionCount<=5));
  assert.deepEqual(engine.recommend([...seed].reverse()),first);
  assert.deepEqual(await engine.recommendAsync(seed),first);
  assert.equal(await engine.recommendAsync(prefs,20,()=>true),null);
  let cancelled=false;
  setTimeout(()=>{cancelled=true;},0);
  assert.equal(await engine.recommendAsync(prefs,20,()=>cancelled),null);
});
test('likes promote shared factors; dislikes demote them; picks are excluded',()=>{
  const movies=[[1,'Seed','',200,3],[2,'Similar','',200,3],[3,'Opposite','',200,3],[4,'Too rare','',1,5]];
  const factors=new Float32Array([1,1,-1,1]),meta={rank:1,ridge:1,minRecommendationRatings:100};
  assert.equal(recommend(movies,factors,meta,[[0,5]])[0].index,1);
  assert.equal(recommend(movies,factors,meta,[[0,1]])[0].index,2);
  assert.deepEqual(recommend(movies,factors,meta,[]),[]);
  assert.deepEqual(recommend(movies,factors,meta,[[0,5],[1,1]]).map(r=>r.index),[2]);
});
test('production artifact integrity and real personalized ranking',()=>{
  const read=path=>readFileSync(new URL('../data/'+path,import.meta.url));
  const movies=JSON.parse(read('movies.json')),meta=JSON.parse(read('model.json')),buffer=read('factors.f32');
  assert.equal(createHash('sha256').update(buffer).digest('hex'),meta.factorsSHA256);
  assert.equal(buffer.byteLength,meta.movies*meta.rank*4);
  const factors=new Float32Array(buffer.buffer,buffer.byteOffset,buffer.byteLength/4);
  assert.ok(factors.every(Number.isFinite));
  assert.equal(new Set(movies.map(m=>m[0])).size,meta.movies);
  assert.equal(meta.model,'observed-only-biased-sgd');
  assert.equal(meta.version,2);
  assert.ok(meta.test.rmse<meta.test.movieMeanRmse);
  assert.ok(meta.validation.rmse<meta.validation.movieMeanRmse);
  assert.equal(movies.reduce((s,m)=>s+m[3],0),32000204);
  const matrix=movies.findIndex(m=>m[0]===2571), toy=movies.findIndex(m=>m[0]===1);
  const liked=recommend(movies,factors,meta,[[matrix,5],[toy,1]]);
  const disliked=recommend(movies,factors,meta,[[matrix,1],[toy,5]]);
  assert.equal(liked.length,20);
  assert.notDeepEqual(liked.map(r=>r.index),disliked.map(r=>r.index));
  for(const r of [...liked,...disliked]) {
    assert.ok(r.index!==matrix&&r.index!==toy);
    assert.ok(r.score>=.5&&r.score<=5&&Number.isFinite(r.score));
    assert.ok(movies[r.index][3]>=100);
  }
});
