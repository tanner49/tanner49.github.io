// Cholesky solve of the positive-definite ridge normal equations.
export function solve(a, b, n) {
  const l = new Float64Array(n * n), y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = a[i*n+j];
    for (let k = 0; k < j; k++) s -= l[i*n+k] * l[j*n+k];
    l[i*n+j] = i === j ? Math.sqrt(s) : s / l[j*n+j];
  }
  for (let i = 0; i < n; i++) {
    let s = b[i]; for (let j = 0; j < i; j++) s -= l[i*n+j]*y[j];
    y[i] = s/l[i*n+i];
  }
  for (let i = n-1; i >= 0; i--) {
    let s = y[i]; for (let j = i+1; j < n; j++) s -= l[j*n+i]*x[j];
    x[i] = s/l[i*n+i];
  }
  return x;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The same engine serves synchronous tests and cancellable worker requests.
// Cache individual similarities, never an averaged taste embedding.
export function createRecommender(movies, factors, meta) {
  const n = meta.rank;
  const eligible = movies.flatMap((m,i) => m[3] >= meta.minRecommendationRatings ? [i] : []);
  const cache = new Map();
  function dot(i,j) {
    let value=0;
    for(let k=0;k<n;k++) value+=factors[i*n+k]*factors[j*n+k];
    return clamp(value,-1,1);
  }
  function similarities(index) {
    if(cache.has(index)) { const hit=cache.get(index); cache.delete(index); cache.set(index,hit); return hit; }
    const values=Float32Array.from(eligible,i=>dot(index,i));
    cache.set(index,values);
    if(cache.size>128) cache.delete(cache.keys().next().value);
    return values;
  }
  function* steps(preferences, limit) {
    if(!preferences.length || limit<=0) return [];
    const unique=new Map();
    for(const [index,rating] of preferences) {
      if(!Number.isInteger(index)||!movies[index]||![1,5].includes(rating)) throw new Error('Invalid preference');
      unique.set(index,rating); // Last feedback wins, matching the UI.
    }
    const a=new Float64Array(n*n),b=new Float64Array(n),likes=[],dislikes=[];
    for(let j=0;j<n;j++) a[j*n+j]=meta.ridge;
    let processed=0;
    for(const [index,rating] of unique) {
      (rating===5?likes:dislikes).push(index);
      const target=rating-movies[index][4];
      for(let j=0;j<n;j++) {
        const q=factors[index*n+j]; b[j]+=q*target;
        for(let k=0;k<=j;k++) a[j*n+k]+=q*factors[index*n+k];
      }
      if(++processed%32===0) yield;
    }
    for(let j=0;j<n;j++) for(let k=0;k<j;k++) a[k*n+j]=a[j*n+k];
    const profile=solve(a,b,n);
    const candidates=eligible.map(index=>{
      let prediction=movies[index][4];
      for(let j=0;j<n;j++) prediction+=factors[index*n+j]*profile[j];
      return {index,prediction,positive:0,second:0,negative:0,source:null,secondSource:null,group:-1};
    });
    const pool=new Set();
    // SVD candidates can surface discoveries beyond a single seed's neighbors.
    candidates.filter(c=>!unique.has(c.index)).sort((a,b)=>b.prediction-a.prediction||a.index-b.index).slice(0,400).forEach(c=>pool.add(c.index));
    // Group liked seeds only for coverage during reranking. Every liked movie
    // independently contributes neighbors, even inside a large interest group.
    likes.sort((a,b)=>movies[b][3]-movies[a][3]||a-b);
    const anchors=[],groups=new Map();
    for(const seed of likes) {
      let group=-1,best=.60;
      anchors.forEach((anchor,i)=>{const similarity=dot(seed,anchor);if(similarity>best){best=similarity;group=i;}});
      if(group===-1){group=anchors.length;anchors.push(seed);}
      groups.set(seed,group);
      const sim=similarities(seed), neighbors=[];
      for(let j=0;j<candidates.length;j++) {
        const c=candidates[j],value=Math.max(0,sim[j]);
        if(value>c.positive) { c.second=c.positive;c.secondSource=c.source;c.positive=value;c.source=seed;c.group=group; }
        else if(value>c.second) { c.second=value;c.secondSource=seed; }
        if(unique.has(c.index)||value<=.2) continue;
        // Only eight local candidates per seed; no full sort for long lists.
        if(neighbors.length<8||value>neighbors[neighbors.length-1].value) {
          neighbors.push({index:c.index,value});neighbors.sort((a,b)=>b.value-a.value||a.index-b.index);
          if(neighbors.length>8) neighbors.pop();
        }
      }
      neighbors.forEach(c=>pool.add(c.index));
      yield;
    }
    for(const seed of dislikes) {
      const sim=similarities(seed);
      for(let j=0;j<candidates.length;j++) candidates[j].negative=Math.max(candidates[j].negative,sim[j]);
      yield;
    }
    const ranked=candidates.filter(c=>pool.has(c.index)&&!unique.has(c.index));
    for(const c of ranked) {
      const personalized=(clamp(c.prediction,.5,5)-.5)/4.5;
      const local=likes.length===1?c.positive:.85*c.positive+.15*c.second;
      // Negative neighborhoods cannot be washed out by a long list of likes.
      c.blend=(likes.length?.60:1)*personalized+(likes.length?.40:0)*local-.30*Math.max(0,c.negative-.2)/.8;
      c.redundancy=0;
    }
    const results=[],coverage=new Map();
    while(results.length<limit && ranked.length) {
      let best=-Infinity,position=0;
      ranked.forEach((c,i)=>{
        const coverageBonus=c.source!==null&&c.positive>.25 ? .16/(1+(coverage.get(c.group)||0)) : 0;
        const value=c.blend+coverageBonus-.10*c.redundancy;
        if(value>best || (value===best && c.index<ranked[position].index)){best=value;position=i;}
      });
      const chosen=ranked.splice(position,1)[0];
      coverage.set(chosen.group,(coverage.get(chosen.group)||0)+1);
      const reasons=[];
      if(chosen.source!==null && chosen.positive>.25) reasons.push(chosen.source);
      if(chosen.secondSource!==null && chosen.second>.35 && groups.get(chosen.secondSource)!==chosen.group) reasons.push(chosen.secondSource);
      results.push({index:chosen.index,score:clamp(chosen.prediction,.5,5),reasons,interest:chosen.group,blend:chosen.blend});
      for(const c of ranked) c.redundancy=Math.max(c.redundancy,Math.max(0,dot(chosen.index,c.index)));
    }
    return results;
  }
  return {
    recommend(preferences,limit=20) {
      const iterator=steps(preferences,limit);let step;
      do {step=iterator.next();} while(!step.done);
      return step.value;
    },
    async recommendAsync(preferences,limit=20,cancelled=()=>false) {
      const iterator=steps(preferences,limit);let batch=0;
      while(!cancelled()) {
        const step=iterator.next();if(step.done) return step.value;
        if(++batch%8===0) await new Promise(resolve=>setTimeout(resolve,0));
      }
      return null;
    }
  };
}

export function recommend(movies,factors,meta,preferences,limit=20) {
  return createRecommender(movies,factors,meta).recommend(preferences,limit);
}

