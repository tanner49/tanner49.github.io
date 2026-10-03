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

// Item-neighborhood consensus is primary; the joint user profile is a small prior.
export function createRecommender(movies,factors,meta) {
  const n=meta.rank;
  const eligible=movies.flatMap((m,i)=>m[3]>=meta.minRecommendationRatings?[i]:[]),cache=new Map();
  function similarities(seed) {
    if(cache.has(seed)) {const value=cache.get(seed);cache.delete(seed);cache.set(seed,value);return value;}
    const values=Float32Array.from(eligible,i=>{
      let dot=0;for(let k=0;k<n;k++) dot+=factors[i*n+k]*factors[seed*n+k];
      return Math.max(0,Math.min(1,(dot-.25)/.75));
    });
    cache.set(seed,values);if(cache.size>128) cache.delete(cache.keys().next().value);
    return values;
  }
  function* steps(preferences,limit) {
    if(!preferences.length || limit<=0) return [];
    const unique=new Map();
    for(const [index,rating] of preferences) {
      if(!Number.isInteger(index)||!movies[index]||![1,5].includes(rating)) throw new Error('Invalid preference');
      unique.set(index,rating);
    }
    const a=new Float64Array(n*n),b=new Float64Array(n);
    for(let j=0;j<n;j++) a[j*n+j]=meta.ridge;
    let processed=0;
    // Stable order makes results independent of the order picks were entered.
    for(const [index,rating] of [...unique].sort((a,b)=>a[0]-b[0])) {
      const target=rating-movies[index][4];
      for(let j=0;j<n;j++) {
        const q=factors[index*n+j];b[j]+=q*target;
        for(let k=0;k<=j;k++) a[j*n+k]+=q*factors[index*n+k];
      }
      if(++processed%32===0) yield;
    }
    for(let j=0;j<n;j++) for(let k=0;k<j;k++) a[k*n+j]=a[j*n+k];
    const profile=solve(a,b,n),results=[];
    const likes=[...unique].filter(p=>p[1]===5).map(p=>p[0]).sort((a,b)=>a-b);
    const dislikes=[...unique].filter(p=>p[1]===1).map(p=>p[0]).sort((a,b)=>a-b);
    const positive=new Float32Array(eligible.length*3),negative=new Float32Array(eligible.length*3);
    const sources=new Int32Array(eligible.length*3).fill(-1);
    for(const [seeds,values,keepSources] of [[likes,positive,true],[dislikes,negative,false]]) {
      for(const seed of seeds) {
        const sims=similarities(seed);
        for(let j=0;j<eligible.length;j++) {
          const offset=j*3,value=sims[j];if(value<=values[offset+2]) continue;
          for(let k=0;k<3;k++) if(value>values[offset+k]) {
            for(let t=2;t>k;t--){values[offset+t]=values[offset+t-1];if(keepSources)sources[offset+t]=sources[offset+t-1];}
            values[offset+k]=value;if(keepSources)sources[offset+k]=seed;break;
          }
        }
        yield;
      }
    }
    for(let j=0;j<eligible.length;j++) {
      const i=eligible[j];if(unique.has(i)) continue;
      let prediction=movies[i][4];
      for(let j=0;j<n;j++) prediction+=factors[i*n+j]*profile[j];
      const offset=j*3;
      const consensus=(positive[offset]+positive[offset+1]+positive[offset+2])/Math.min(3,likes.length||1);
      const opposition=(negative[offset]+negative[offset+1]+negative[offset+2])/Math.min(3,dislikes.length||1);
      const prior=(Math.max(.5,Math.min(5,prediction))-.5)/4.5;
      const rankScore=likes.length ? .9*consensus+.1*prior-.35*opposition-.15*negative[offset] : prior-.5*opposition;
      const reasons=Array.from(sources.slice(offset,offset+3)).filter(i=>i>=0);
      results.push({index:i,prediction,score:Math.max(.5,Math.min(5,prediction)),rankScore,consensus,reasons});
    }
    results.sort((a,b)=>b.rankScore-a.rankScore||movies[b.index][3]-movies[a.index][3]||a.index-b.index);
    return results.slice(0,limit);
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

