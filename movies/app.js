import {favorites} from './favorites.mjs';
const $ = id => document.getElementById(id);
const storageKey = 'movie-night-preferences-v1';
let movies = [], titles = [], idToIndex = new Map(), preferences = new Map(), selected = null, matches = [], active = -1, requestId = 0, worker;
let rankedResults=[],visibleCount=20;
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function element(tag, text, className) { const e = document.createElement(tag); if(text !== undefined) e.textContent=text; if(className) e.className=className; return e; }
function button(text, label, action) { const b = element('button',text); b.type='button'; b.setAttribute('aria-label',label); b.addEventListener('click',action); return b; }
function closeSearch() { $('suggestions').hidden=true; $('search').setAttribute('aria-expanded','false'); $('search').removeAttribute('aria-activedescendant'); active=-1; }
function choose(index) {
  selected=index; $('search').value=movies[index][1]; $('selected-title').textContent=movies[index][1];
  $('like').disabled=$('dislike').disabled=movies[index][3]===0;
  $('search-help').textContent=movies[index][3] ? 'Add this movie to Like or Dislike.' : 'This movie has no ratings in the dataset. Choose another movie.';
  closeSearch();
}
function search() {
  selected=null; $('like').disabled=$('dislike').disabled=true; $('selected-title').textContent='Choose a movie to add';
  const query=normalize($('search').value.trim());
  if(!query) { closeSearch(); return; }
  const words=query.split(/\s+/);
  matches=[];
  for(let i=0;i<movies.length;i++) if(words.every(w=>titles[i].includes(w))) matches.push(i);
  matches.sort((a,b)=>Number(titles[b].startsWith(query))-Number(titles[a].startsWith(query)) || movies[b][3]-movies[a][3]);
  matches=matches.slice(0,15); active=-1;
  $('suggestions').replaceChildren();
  for(const [position,index] of matches.entries()) {
    const li=element('li',movies[index][1]); li.id=`option-${position}`; li.setAttribute('role','option'); li.setAttribute('aria-selected','false');
    li.append(element('small',movies[index][2].replaceAll('|',' · ')));
    li.addEventListener('mousedown',e=>e.preventDefault()); li.addEventListener('click',()=>choose(index)); $('suggestions').append(li);
  }
  $('search-help').textContent=matches.length ? 'Use arrow keys and Enter, or select a title.' : 'No matching movies. Try a shorter title; the catalog ends in 2023.';
  $('suggestions').hidden=!matches.length; $('search').setAttribute('aria-expanded',String(!!matches.length)); $('search').removeAttribute('aria-activedescendant');
}
function save() { try { localStorage.setItem(storageKey,JSON.stringify([...preferences])); } catch { document.querySelector('.privacy').textContent='Your picks work here, but this browser cannot save them between visits.'; } }
function setPreference(index,rating) { preferences.set(movies[index][0],rating); save(); renderPreferences(); update(); }
function renderPreferences() {
  for(const [rating,list,count,empty] of [[5,'likes','like-count','likes-empty'],[1,'dislikes','dislike-count','dislikes-empty']]) {
    $(list).replaceChildren(); let total=0;
    for(const [id,value] of preferences) if(value===rating) {
      const index=idToIndex.get(id), title=movies[index][1], li=element('li'); li.append(element('span',title));
      const actions=element('div',undefined,'preference-actions');
      actions.append(button(rating===5?'−':'＋',`Move ${title} to ${rating===5?'Dislike':'Like'}`,()=>setPreference(index,rating===5?1:5)),button('×',`Remove ${title}`,()=>{preferences.delete(id); save(); renderPreferences(); update();}));
      li.append(actions); $(list).append(li); total++;
    }
    $(count).textContent=total; $(empty).hidden=!!total;
  }
  $('clear').disabled=!preferences.size;
}
function update() {
  rankedResults=[];visibleCount=20;$('show-more').hidden=true;
  requestId++; $('results').replaceChildren(); $('result-count').textContent=''; $('results-empty').hidden=!!preferences.size;
  worker.postMessage({type:'cancel',id:requestId});
  $('recommendation-status').textContent=preferences.size ? 'Finding movies for your taste…' : 'Your recommendations will appear here.';
  if(preferences.size) worker.postMessage({type:'recommend',id:requestId,preferences:[...preferences].map(([id,rating])=>[idToIndex.get(id),rating])});
}
function renderResults(results) {
  rankedResults=results;
  $('results').replaceChildren(); $('result-count').textContent=`${Math.min(visibleCount,results.length)} OF ${results.length} PICKS`;
  $('show-more').hidden=visibleCount>=results.length;
  $('show-more').textContent=`Show ${Math.min(20,results.length-visibleCount)} more`;
  $('recommendation-status').textContent=`Based on ${preferences.size} ${preferences.size===1?'movie':'movies'} you’ve rated. Add more to refine your picks.`;
  results.slice(0,visibleCount).forEach(({index,reasons=[],contributions=[],supportCount=0,oppositionCount=0,rankScore=0,positiveScore=0,negativeScore=0},position)=>{
    const movie=movies[index], li=element('li',undefined,'movie'); li.append(element('span',String(position+1).padStart(2,'0'),'rank'));
    const body=element('div'), h3=element('h3'), a=element('a',movie[1]); a.href=`https://movielens.org/movies/${movie[0]}`; a.target='_blank'; a.rel='noopener noreferrer'; h3.append(a);
    body.append(h3,element('p',movie[2].replaceAll('|',' · '),'genres'));
    body.append(element('p',reasons.length ? `Closest matches: ${reasons.slice(0,3).map(i=>movies[i][1]).join(' · ')}${reasons.length>3?` · and ${reasons.length-3} more`:''}` : 'Based on your overall preferences and dislikes.','explanation'));
    const details=element('details',undefined,'match-details');
    details.append(element('summary',`${supportCount} supporting ${supportCount===1?'like':'likes'}${oppositionCount?` · ${oppositionCount} nearby dislikes`:''}`));
    details.append(element('p',`Liked similarity sum: ${positiveScore.toFixed(3)}. Disliked similarity sum: ${negativeScore.toFixed(3)}.`));
    const sources=element('ul');
    for(const contribution of contributions) sources.append(element('li',`${movies[contribution.index][1]}: +${contribution.weight.toFixed(3)}`));
    details.append(sources);body.append(details);
    const actions=element('div',undefined,'actions'); actions.append(button('＋ Like',`Like ${movie[1]}`,()=>setPreference(index,5)),button('− Dislike',`Dislike ${movie[1]}`,()=>setPreference(index,1))); body.append(actions);
    const support=element('div',rankScore.toFixed(2),'score'); support.append(element('small','match score')); li.append(body,support); $('results').append(li);
  });
}
function fail(message) { $('load-status').textContent=message+' Check your connection and try again.'; $('load-status').classList.add('error'); $('retry').hidden=false; $('search').disabled=true; $('favorites').disabled=true; $('like').disabled=$('dislike').disabled=true; }
function load() {
  if(worker) worker.terminate(); $('retry').hidden=true; $('load-status').classList.remove('error'); $('load-status').textContent='Loading catalog and model (about 24 MB on your first visit)…';
  try { worker=new Worker(new URL('./worker.js?v=6',import.meta.url),{type:'module'}); } catch { fail('This browser could not start the recommendation engine.'); return; }
  worker.onerror=()=>fail('The recommendation engine could not start.');
  worker.onmessage=({data})=>{
    if(data.type==='ready') {
      movies=data.movies; titles=movies.map(m=>normalize(m[1])); idToIndex=new Map(movies.map((m,i)=>[m[0],i]));
      try { const stored=JSON.parse(localStorage.getItem(storageKey)||'[]'); if(Array.isArray(stored)) preferences=new Map(stored.filter(p=>Array.isArray(p)&&idToIndex.has(p[0])&&movies[idToIndex.get(p[0])][3]>0&&[1,5].includes(p[1]))); } catch { preferences=new Map(); }
      $('load-status').textContent=`Ready to explore ${movies.length.toLocaleString()} movies · Trained on 32,000,204 ratings`; $('search').disabled=false; $('favorites').disabled=false; renderPreferences(); update();
    } else if(data.type==='results' && data.id===requestId) renderResults(data.results);
    else if(data.type==='error') fail(data.message);
  };
  worker.postMessage({type:'load'});
}
$('search').addEventListener('input',search);
$('search').addEventListener('focus',()=>{if($('search').value && selected===null) search();});
$('search').addEventListener('blur',closeSearch);
$('search').addEventListener('keydown',event=>{
  if(event.key==='Escape') { closeSearch(); return; }
  if(event.key==='ArrowDown'||event.key==='ArrowUp') {
    event.preventDefault(); if($('suggestions').hidden) search(); if(!matches.length) return;
    active=(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;
    [...$('suggestions').children].forEach((li,i)=>li.setAttribute('aria-selected',String(i===active)));
    const option=$(`option-${active}`); $('search').setAttribute('aria-activedescendant',option.id); option.scrollIntoView({block:'nearest'});
  } else if(event.key==='Enter' && active>=0 && !$('suggestions').hidden) { event.preventDefault(); choose(matches[active]); }
});
for(const [id,rating] of [['like',5],['dislike',1]]) $(id).addEventListener('click',()=>{
  if(selected===null) return; setPreference(selected,rating); selected=null; $('search').value=''; $('selected-title').textContent='Choose a movie to add'; $('like').disabled=$('dislike').disabled=true; $('search').focus();
});
$('clear').addEventListener('click',()=>{preferences.clear();save();renderPreferences();update();});
$('favorites').addEventListener('click',()=>{
  let loaded=0;const missing=[];
  for(const favorite of favorites) {
    if(favorite.id!==null && idToIndex.has(favorite.id) && movies[idToIndex.get(favorite.id)][3]>0) { preferences.set(favorite.id,5);loaded++; }
    else missing.push(favorite.title);
  }
  save();renderPreferences();update();
  $('favorites-status').textContent=`Loaded ${loaded} favorites into Like. Other picks are kept. Unavailable in this dataset: ${missing.join('; ')}.`;
});
$('retry').addEventListener('click',load);
$('show-more').addEventListener('click',()=>{visibleCount+=20;renderResults(rankedResults);});
load();
