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

// Fit all observed preferences jointly; rank only by the resulting user vector.
export function createRecommender(movies,factors,meta) {
  const n=meta.rank;
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
    for(let i=0;i<movies.length;i++) {
      if(i%4096===0) yield;
      if(unique.has(i)||movies[i][3]<meta.minRecommendationRatings) continue;
      let prediction=movies[i][4];
      for(let j=0;j<n;j++) prediction+=factors[i*n+j]*profile[j];
      results.push({index:i,prediction,score:Math.max(.5,Math.min(5,prediction))});
    }
    results.sort((a,b)=>b.prediction-a.prediction||movies[b.index][3]-movies[a.index][3]||a.index-b.index);
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

