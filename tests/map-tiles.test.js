import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapTileSession,loadMapTiles} from '../src/lib/map-tiles.js';
import {areaPlan} from '../src/lib/area-plan.js';
const bounds={sw:{lat:0,lng:0},ne:{lat:.05,lng:.05}};
test('Initial tiles cover the whole selection and each is at most nine square km',()=>{
  const session=createMapTileSession(bounds);
  assert.equal(session.total,4);
  assert.ok(session.pending.every(tile=>areaPlan(tile.bounds).km2<=9));
  const planar=b=>(b.ne.lat-b.sw.lat)*(b.ne.lng-b.sw.lng);
  assert.ok(Math.abs(session.pending.reduce((n,t)=>n+planar(t.bounds),0)-planar(bounds))<1e-12);
  assert.throws(()=>createMapTileSession({sw:{lat:0,lng:0},ne:{lat:10,lng:10}}),/256/);
});
test('City overview can use fewer 36 square km tiles',()=>{
  const session=createMapTileSession({sw:{lat:0,lng:0},ne:{lat:.1,lng:.1}},{tileAreaKm2:36});
  assert.equal(session.total,4);
  assert.ok(session.pending.every(tile=>areaPlan(tile.bounds).km2<=36));
});
test('Only failing tiles subdivide, objects deduplicate and progress reaches full coverage',async()=>{
  const session=createMapTileSession(bounds),first=session.pending[0].bounds,second=session.pending[1].bounds,calls=[];
  const elements=await loadMapTiles(session,{request:async bbox=>{
    calls.push(bbox);if(bbox===second)throw new Error('query too large');
    return {elements:[{type:'way',id:1},{type:'relation',id:1}]};
  }});
  assert.equal(calls.filter(b=>b===first).length,1);
  assert.equal(session.done,7);assert.equal(session.total,7);
  assert.equal(elements.length,2);assert.equal(session.covered,1);
});
test('Cancellation retains completed tiles and retry resumes without downloading them again',async()=>{
  const session=createMapTileSession(bounds),controller=new AbortController(),calls=[];
  await assert.rejects(loadMapTiles(session,{signal:controller.signal,request:async bbox=>{
    calls.push(bbox);if(calls.length===2)controller.abort();return {elements:[{type:'way',id:calls.length}]};
  }}),{name:'AbortError'});
  assert.equal(session.done,1);
  const first=calls[0];
  await loadMapTiles(session,{request:async bbox=>{assert.notEqual(bbox,first);return {elements:[]};}});
  assert.equal(session.done,4);assert.equal(session.elements.size,1);
});
test('Repeated failures have bounded subdivision and preserve the failed tile for retry',async()=>{
  const session=createMapTileSession({sw:{lat:0,lng:0},ne:{lat:.001,lng:.001}});
  let calls=0;
  await assert.rejects(loadMapTiles(session,{request:async()=>{calls++;throw new Error('offline');}}),/offline/);
  assert.equal(calls,1);assert.equal(session.total,1);assert.equal(session.pending[0].depth,0);
});
test('Concurrent loading uses independent lanes without exceeding three requests',async()=>{
  const session=createMapTileSession(bounds),lanes=new Set();let active=0,peak=0;
  await loadMapTiles(session,{concurrency:3,request:async(_bbox,_progress,lane)=>{
    lanes.add(lane);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {elements:[]};
  }});
  assert.deepEqual([...lanes].sort(),[0,1,2]);assert.equal(peak,3);
});
