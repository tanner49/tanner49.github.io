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
