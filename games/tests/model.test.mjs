import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRecommender} from '../../movies/model.mjs';
const read=name=>readFileSync(new URL('../data/'+name,import.meta.url));
const games=JSON.parse(read('games.json')),meta=JSON.parse(read('model.json')),bytes=read('factors.f32');
const factors=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
const engine=createRecommender(games,factors,meta);
const prefs=ids=>ids.map(id=>{
  const index=games.findIndex(g=>g[0]===id);assert.ok(index>=0,`Missing Steam app ${id}`);return [index,5];
});

test('Steam export integrity, recent-game coverage, neutral baselines and retained counts',()=>{
  assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.factorsSHA256);
  assert.equal(bytes.byteLength,meta.games*meta.rank*4);
  assert.equal(games.length,meta.games);
  assert.equal(new Set(games.map(g=>g[0])).size,meta.games);
  assert.equal(games.reduce((sum,g)=>sum+g[3],0),meta.playedInteractions);
  assert.ok(games.every(g=>g[3]>=50&&g[4]===3));
  assert.ok(factors.every(Number.isFinite));
  for(let i=0;i<games.length;i++){
    let norm=0;for(let j=0;j<meta.rank;j++)norm+=factors[i*meta.rank+j]**2;
    assert.ok(Math.abs(norm-1)<1e-5);
  }
  prefs([1086940,1245620,553850,1623730]);
  assert.equal(meta.test.model.users,300);
  assert.equal(meta.test.popularity.users,300);
});

test('Different game tastes, long histories, exclusions and five weighted contributors',async()=>{
  const souls=prefs([1245620,374320,814380,1325200,570940,1627720]);
  const rpg=prefs([1086940,435150,291650]);
  const results=engine.recommend(souls,500),other=engine.recommend(rpg,20);
  assert.equal(results.length,500);
  assert.equal(new Set(results.map(r=>r.index)).size,500);
  assert.notDeepEqual(results.slice(0,20).map(r=>r.index),other.map(r=>r.index));
  assert.ok(results.some(r=>r.supportCount===5));
  for(const r of results){
    assert.ok(!souls.some(p=>p[0]===r.index));
    assert.ok(r.supportCount<=5&&r.oppositionCount<=5);
    assert.ok(r.contributions.every(c=>souls.some(p=>p[0]===c.index)));
    assert.ok(Math.abs(r.positiveScore-r.contributions.reduce((s,c)=>s+c.weight,0))<1e-7);
    assert.equal(r.rankScore,r.positiveScore-r.negativeScore);
  }
  assert.deepEqual(await engine.recommendAsync(souls,500),results);
  const long=games.slice(0,1000).map((_,i)=>[i,i%3===0?1:5]);
  const many=engine.recommend(long,500);
  assert.equal(many.length,500);
  assert.ok(many.every(r=>r.index>=1000));
  const negative=engine.recommend([[souls[0][0],1]],20);
  assert.equal(negative.length,20);
  assert.ok(negative.every(r=>r.index!==souls[0][0]));
  console.log('Souls-like sample:',results.slice(0,10).map(r=>games[r.index][1]));
  console.log('RPG sample:',other.slice(0,10).map(r=>games[r.index][1]));
});
