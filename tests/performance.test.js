import test from 'node:test';
import assert from 'node:assert/strict';
import {readBounded,mapFailure} from '../src/lib/data-budget.js';
import {vectorTilePlan} from '../src/lib/city-tiles.js';
import {loadMapLayers} from '../src/lib/map-pipeline.js';
import {emptyMapData} from '../src/lib/map-parser.js';
import {buildQuickModel} from '../src/lib/quick-model.js';
import {defaultModel} from '../src/lib/model.js';
import {exportModel} from '../src/lib/model-export.js';
import {countMapPoints} from '../src/lib/map-lod.js';

test('Oversized streams are cancelled before parsing, and aggregate bytes include failed responses',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(100));},cancel(){cancelled=true;}}));
  const budget={bytes:0,maxBytes:1000};
  await assert.rejects(readBounded(response,{maxBytes:150,budget}),/data budget/);
  assert.equal(cancelled,true);assert.equal(budget.bytes,200);
  assert.equal(mapFailure(new Error('HTTP 429')), 'quota');
  assert.equal(mapFailure(new Error('offline')), 'unavailable');
});
test('City requests remain bounded from city to continental extents and grow in detail for small selections',()=>{
  const bounds=span=>({sw:{lat:40,lng:0},ne:{lat:40+span,lng:span}});
  const small=vectorTilePlan(bounds(.1)),large=vectorTilePlan(bounds(20));
  assert.ok(small.z>large.z);
  for(const span of [.01,.1,1,10,40])assert.ok(vectorTilePlan(bounds(span)).tiles.length<=16);
});
const state={wMm:200,hMm:140,shape:'rect',renderBbox:{sw:{lat:47,lng:11},ne:{lat:47.1,lng:11.1}},terrainData:{cols:2,rows:2,h:new Float32Array([0,10,0,10]),delta:10},cityOverview:false,includeBuildings:false,includeMinorRoads:false,mapFeatures:{buildings:{minArea:.5}},outputMode:'2d'};
test('Stage failures preserve earlier bounded data; a retry reuses completed geographic stages',async()=>{
  const calls=[];
  const request=async query=>{
    calls.push(query);
    if(query.includes('"waterway"~"river|stream|canal"'))throw new Error('HTTP 429 rate limit exceeded');
    return {elements:[]};
  };
  const a=await loadMapLayers(state,{request,endpoints:['https://cache-test.invalid']});
  assert.deepEqual(a.status.completed,['areas','roads']);assert.match(a.status.error,/429/);
  calls.length=0;
  const b=await loadMapLayers({...state,wMm:250},{request,endpoints:['https://cache-test.invalid']});
  assert.equal(calls.length,1);assert.deepEqual(b.status.completed,['areas','roads']);
});
test('An oversized later layer never escapes into the published map',async()=>{
  const city=emptyMapData();
  city.waterAreas=[{polygons:[[[[0,0],[20,0],[20,20],[0,20],[0,0]]]]}];
  city.roadLines=Array.from({length:31000},()=>({points:[[0,0],[1,1]],scale:1}));
  const snapshots=[];
  const result=await loadMapLayers({...state,cityOverview:true},{cityLoader:async()=>({data:city,tiles:4,source:'fixture'}),progress:p=>{if(p.snapshot)snapshots.push(p.snapshot);}});
  assert.match(result.status.error,/budget/);
  assert.equal(result.data.waterAreas.length,1);assert.equal(result.data.roadLines.length,0);
  for(const snapshot of snapshots)assert.ok(countMapPoints(snapshot.data)<=60000);
});
test('Quick 3D previews retain dimensions and relief but cannot be exported as printable solids',async()=>{
  const settings={...defaultModel(),buildings:false,roads:false,water:false};
  const result=buildQuickModel({...state,osmData:emptyMapData()},settings);
  assert.equal(result.previewOnly,true);assert.equal(result.width,settings.width);
  assert.ok(result.mesh.t.length>0);assert.ok(result.reliefHeight>0);
  await assert.rejects(exportModel(result,'stl'),/Prepare the printable model/);
});
