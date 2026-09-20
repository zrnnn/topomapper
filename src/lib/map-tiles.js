import {areaPlan,splitArea} from './area-plan.js';
import {mapFailure} from './data-budget.js';

// Sequential requests respect public service capacity. Keep a resumable checkpoint
// for the current selection, rather than redownloading completed tiles on retry.
export function createMapTileSession(bounds,{tileAreaKm2=9}={}) {
  const side=Math.max(1,Math.ceil(Math.sqrt(areaPlan(bounds).km2/tileAreaKm2)));
  if(side>16)throw new Error('This area needs more than 256 map tiles. Select a smaller region for browser loading.');
  const tiles=splitArea(bounds,side*side);
  return {pending:tiles.map(bounds=>({bounds,depth:0,weight:1/tiles.length})),elements:new Map(),done:0,covered:0,total:tiles.length,bytes:0};
}

export async function loadMapTiles(session,{request,signal,progress=()=>{},concurrency=1}={}) {
  const check=()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};
  let fatal=null;
  const worker=async lane=>{while(session.pending.length&&!fatal){
    check();
    const tile=session.pending.shift();
    const report=detail=>progress({done:session.done,total:session.total,covered:session.covered,detail});
    report('Requesting next tile');
    let data;
    try{
      data=await request(tile.bounds,report,lane);
      check();
      if(data.remark||!Array.isArray(data.elements))throw new Error('Incomplete map tile');
    }catch(error){
      if(signal?.aborted)session.pending.unshift(tile);
      check();
      if(mapFailure(error)!=='size'||tile.depth>=1||session.total+3>16){session.pending.unshift(tile);fatal=error;break;}
      const children=splitArea(tile.bounds,4).map(bounds=>({bounds,depth:tile.depth+1,weight:tile.weight/4}));
      session.pending.unshift(...children);session.total+=3;
      report('Tile unavailable · splitting only this tile into four smaller requests');
      continue;
    }
    // Account for retained payload size and deduplicate complete OSM objects by
    // type/id. Keep full relation geometry so polygons crossing tiles stay valid.
    const fresh=new Map();let bytes=0;
    for(const element of data.elements){
      const key=`${element.type}/${element.id}`;
      if(!session.elements.has(key)&&!fresh.has(key)){fresh.set(key,element);bytes+=JSON.stringify(element).length*2;}
    }
    if(session.bytes+bytes>64*1024*1024)throw new Error('Map data exceeds the 64 MB browser budget. Use city overview or select a smaller region.');
    for(const [key,element] of fresh)session.elements.set(key,element);
    session.bytes+=bytes;session.done++;session.covered+=tile.weight;
    report('Tile loaded and retained');
  }};
  await Promise.all(Array.from({length:Math.max(1,Math.min(3,concurrency,session.pending.length))},(_,lane)=>worker(lane)));
  if(fatal)throw fatal;
  return Array.from(session.elements.values());
}
