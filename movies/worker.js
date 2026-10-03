import {createRecommender} from './model.mjs';
let movies, factors, meta, engine, latestRequest=0;
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'load') {
      const responses = await Promise.all(['data/movies.json','data/model.json','data/factors.f32'].map(path => fetch(new URL(path,import.meta.url))));
      if (responses.some(r => !r.ok)) throw new Error('Could not download the recommendation files.');
      [movies, meta] = await Promise.all([responses[0].json(),responses[1].json()]);
      const buffer = await responses[2].arrayBuffer();
      if (buffer.byteLength !== meta.movies*meta.rank*4 || movies.length !== meta.movies) throw new Error('Model files do not match. Please reload.');
      const hash = await crypto.subtle.digest('SHA-256',buffer);
      const checksum = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2,'0')).join('');
      if (checksum !== meta.factorsSHA256) throw new Error('Model verification failed. Please reload.');
      factors = new Float32Array(buffer);
      engine = createRecommender(movies,factors,meta);
      self.postMessage({type:'ready',movies});
    } else if (data.type === 'recommend') {
      latestRequest=data.id;
      const results=await engine.recommendAsync(data.preferences,20,()=>latestRequest!==data.id);
      if(results && latestRequest===data.id) self.postMessage({type:'results',id:data.id,results});
    } else if (data.type === 'cancel') {
      latestRequest=data.id;
    }
  } catch (error) { self.postMessage({type:'error',message:error.message}); }
};
