import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRecommender} from '../../movies/model.mjs';
const read=name=>readFileSync(new URL('../data/'+name,import.meta.url));
const shows=JSON.parse(read('shows.json')),meta=JSON.parse(read('model.json')),buffer=read('factors.f32');
const factors=new Float32Array(buffer.buffer,buffer.byteOffset,buffer.byteLength/4);
const engine=createRecommender(shows,factors,meta);
const index=id=>shows.findIndex(s=>s[0]===id);

test('Amazon artifacts, coverage and trained factors are consistent',()=>{
  assert.equal(buffer.byteLength,meta.series*meta.rank*4);
  assert.equal(createHash('sha256').update(buffer).digest('hex'),meta.factorsSHA256);
  assert.equal(shows.length,meta.series);
  assert.equal(meta.model,'positive-idf');
  assert.ok(shows.length>500);
  assert.equal(new Set(shows.map(s=>s[0])).size,shows.length);
  assert.equal(shows.reduce((total,s)=>total+s[3],0),meta.seriesRatings);
  assert.ok(factors.every(Number.isFinite));
  assert.ok(shows.every(s=>s[3]>=50));
  assert.ok(shows.every(s=>!/\bcomplete\s+(?:fifth|seventh|eleventh)\b/i.test(s[1])));
  for(const id of ['office','parksandrecreation','community','breakingbad','wire','sopranos']) assert.ok(index(id)>=0,id);
});

test('TV profiles produce distinct rankings and exclude entered series',()=>{
  const comedy=['office','parksandrecreation','community'].map(id=>[index(id),5]);
  const crime=['breakingbad','wire','sopranos'].map(id=>[index(id),5]);
  const a=engine.recommend(comedy,500),b=engine.recommend(crime,500);
  assert.equal(a.length,500);assert.equal(new Set(a.map(r=>r.index)).size,500);
  assert.notDeepEqual(a.slice(0,20).map(r=>r.index),b.slice(0,20).map(r=>r.index));
  for(const r of a) {
    assert.ok(!comedy.some(p=>p[0]===r.index));
    assert.ok(r.reasons.every(i=>comedy.some(p=>p[0]===i)));
    assert.ok(Number.isFinite(r.rankScore));
  }
  console.log('Comedy top 10:',a.slice(0,10).map(r=>shows[r.index][1]));
  console.log('Crime top 10:',b.slice(0,10).map(r=>shows[r.index][1]));
  const negative=engine.recommend([[index('office'),1]],20);
  assert.equal(negative.length,20);assert.ok(negative.every(r=>r.index!==index('office')));
});
