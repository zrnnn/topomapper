// Mapzen Terrarium: https://github.com/tilezen/joerd/blob/master/docs/formats.md
export const latitudeY = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2;
export const yLatitude = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
export function validateBounds({sw, ne}) {
  if(![sw?.lat, sw?.lng, ne?.lat, ne?.lng].every(Number.isFinite) ||
    sw.lat >= ne.lat || sw.lng >= ne.lng || ne.lng - sw.lng > 180 ||
    sw.lng < -180 || ne.lng > 180 || sw.lat < -85 || ne.lat > 85) {
    throw new Error('Choose a smaller area between 85°S and 85°N, without crossing the date line.');
  }
}
export const decodeTerrarium = (r,g,b) => r * 256 + g + b / 256 - 32768;
export function normalizeTerrain(heights, rows, cols, source) {
  if(heights.length !== rows * cols || !Array.from(heights).every(v => Number.isFinite(v) && v > -12000 && v < 10000)) {
    throw new Error('The elevation service returned incomplete or invalid terrain.');
  }
  let min=Infinity, max=-Infinity;
  for(const v of heights) { min=Math.min(min,v); max=Math.max(max,v); }
  return { rows, cols, min, max, delta:max-min, h:Float32Array.from(heights,v=>v-min), source };
}
async function request(url, options={}) {
  const response = await fetch(url, {...options, signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw new Error(`Elevation service returned HTTP ${response.status}.`);
  return response;
}
async function decodeImage(blob) {
  const bitmap=await createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'});
  try {
    if(bitmap.width!==256 || bitmap.height!==256) throw new Error('Invalid terrain tile.');
    const canvas=new OffscreenCanvas(256,256), ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0);
    return ctx.getImageData(0,0,256,256).data;
  } finally { bitmap.close(); }
}
export async function loadTiles(bounds, {rows=160, cols=160, fetchTile, progress=()=>{}}={}) {
  validateBounds(bounds);
  const {sw,ne}=bounds, north=latitudeY(ne.lat), south=latitudeY(sw.lat);
  const west=(sw.lng+180)/360, east=(ne.lng+180)/360;
  const zoom=Math.max(0,Math.min(13,Math.ceil(Math.log2(Math.max(cols/(east-west),rows/(south-north))/256))));
  const n=2**zoom, size=n*256;
  const x0=west*size, x1=Math.min(size-1,east*size), y0=north*size, y1=Math.min(size-1,south*size);
  const tiles=new Map(), jobs=[];
  for(let y=Math.floor(y0/256);y<=Math.floor((y1+1)/256);y++) {
    for(let x=Math.floor(x0/256);x<=Math.floor((x1+1)/256);x++) {
      if(x<n && y<n) jobs.push({x,y});
    }
  }
  if(jobs.length>64) throw new Error('Choose a less elongated frame for terrain generation.');
  let done=0, cursor=0;
  const getTile=fetchTile || (async (z,x,y)=>decodeImage(await (await request(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`)).blob()));
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
    while(cursor<jobs.length) {
      const {x,y}=jobs[cursor++];
      const pixels=await getTile(zoom,x,y);
      if(pixels.length!==256*256*4) throw new Error('Invalid terrain tile.');
      tiles.set(`${x},${y}`,pixels);progress(`Loading terrain ${++done}/${jobs.length}`);
    }
  }));
  const sample=(x,y)=>{
    x=Math.max(0,Math.min(size-1,x)); y=Math.max(0,Math.min(size-1,y));
    const pixels=tiles.get(`${Math.floor(x/256)},${Math.floor(y/256)}`);
    const i=((y%256)*256+x%256)*4;
    if(!pixels || pixels[i+3]!==255) throw new Error('Terrain coverage is incomplete in this area.');
    return decodeTerrarium(pixels[i],pixels[i+1],pixels[i+2]);
  };
  const heights=new Float32Array(rows*cols);
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) {
    const x=x0+(x1-x0)*c/(cols-1), y=y0+(y1-y0)*r/(rows-1);
    const ix=Math.floor(x),iy=Math.floor(y),tx=x-ix,ty=y-iy;
    heights[r*cols+c]=(sample(ix,iy)*(1-tx)+sample(ix+1,iy)*tx)*(1-ty)+(sample(ix,iy+1)*(1-tx)+sample(ix+1,iy+1)*tx)*ty;
  }
  return normalizeTerrain(heights,rows,cols,`Mapzen terrain · ${cols} × ${rows} samples`);
}
export async function loadLookup(bounds, {progress=()=>{}, fetchBatch}={}) {
  validateBounds(bounds);
  const rows=64,cols=64,locations=[],heights=[];
  const north=latitudeY(bounds.ne.lat),south=latitudeY(bounds.sw.lat);
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) locations.push({latitude:yLatitude(north+(south-north)*r/(rows-1)),longitude:bounds.sw.lng+(bounds.ne.lng-bounds.sw.lng)*c/(cols-1)});
  const lookup=fetchBatch || (async locations=>(await request('https://api.open-elevation.com/api/v1/lookup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locations})})).json());
  for(let i=0;i<locations.length;i+=512) {
    const batch=locations.slice(i,i+512), data=await lookup(batch);
    if(!Array.isArray(data.results) || data.results.length!==batch.length) throw new Error('Incomplete elevation response.');
    data.results.forEach((point,j)=>{
      if(Math.abs(point.latitude-batch[j].latitude)>1e-4 || Math.abs(point.longitude-batch[j].longitude)>1e-4 || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) throw new Error('Elevation coordinates do not match the requested area.');
      heights.push(point.elevation);
    });
    progress(`Fallback terrain ${Math.min(i+512,locations.length)}/${locations.length}`);
  }
  return normalizeTerrain(heights,rows,cols,'Open-Elevation fallback · 64 × 64 samples');
}
export async function loadTerrain(bounds, {primary=loadTiles,fallback=loadLookup,progress=()=>{}}={}) {
  validateBounds(bounds);
  try { return await primary(bounds,{progress}); }
  catch { progress('Primary terrain unavailable. Trying fallback…'); }
  try { return await fallback(bounds,{progress}); }
  catch { throw new Error('Elevation services could not be reached or returned invalid data. Your previous preview is preserved. Check your connection and retry.'); }
}
