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

// Sum all nearby item evidence; the joint profile breaks exact ties only.
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
    const positive=new Float64Array(eligible.length),negative=new Float64Array(eligible.length);
    const supportCount=new Uint32Array(eligible.length),oppositionCount=new Uint32Array(eligible.length);
    for(const [seeds,totals,counts] of [[likes,positive,supportCount],[dislikes,negative,oppositionCount]]) {
      for(const seed of seeds) {
        const sims=similarities(seed);
        for(let j=0;j<eligible.length;j++) if(sims[j]>0) {totals[j]+=sims[j];counts[j]++;}
        yield;
      }
    }
    for(let j=0;j<eligible.length;j++) {
      const i=eligible[j];if(unique.has(i)) continue;
      let prediction=movies[i][4];
      for(let k=0;k<n;k++) prediction+=factors[i*n+k]*profile[k];
      const prior=(Math.max(.5,Math.min(5,prediction))-.5)/4.5;
      // Sum all nearby evidence. No division by list length or contributor cap.
      // The fitted profile only breaks exact score ties when likes are present.
      const rankScore=likes.length ? positive[j]-negative[j] : prior-negative[j];
      results.push({index:i,prediction,score:Math.max(.5,Math.min(5,prediction)),rankScore,
        positiveScore:positive[j],negativeScore:negative[j],supportCount:supportCount[j],oppositionCount:oppositionCount[j]});
    }
    results.sort((a,b)=>b.rankScore-a.rankScore||b.prediction-a.prediction||movies[b.index][3]-movies[a.index][3]||a.index-b.index);
    const selected=results.slice(0,limit);
    // Recompute explanations only for returned movies, keeping long-list memory bounded.
    for(const result of selected) {
      result.contributions=[];
      for(const seed of likes) {
        let dot=0;for(let k=0;k<n;k++) dot+=factors[result.index*n+k]*factors[seed*n+k];
        const weight=Math.fround(Math.max(0,Math.min(1,(dot-.25)/.75)));
        if(weight>0) result.contributions.push({index:seed,weight});
      }
      result.contributions.sort((a,b)=>b.weight-a.weight||a.index-b.index);
      result.reasons=result.contributions.map(c=>c.index);
      yield;
    }
    return selected;
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

