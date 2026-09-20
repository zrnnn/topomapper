import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYER_CHOICES,requestedStages,layerWarning,filterSelectedLayers} from '../src/lib/layer-selection.js';
import {buildOverpassQuery,emptyMapData} from '../src/lib/map-parser.js';
import {loadMapLayers} from '../src/lib/map-pipeline.js';
import {loadTiles,loadTerrain,normalizeTerrain} from '../src/lib/terrain.js';
import {MAP_PROVIDERS,rankProviders,requestMapData} from '../src/lib/map-service.js';

const off=Object.fromEntries(LAYER_CHOICES.map(([key])=>[key,false]));
const state={wMm:200,hMm:140,shape:'rect',renderBbox:{sw:{lat:47,lng:11},ne:{lat:47.1,lng:11.1}},cityOverview:false,mapFeatures:{buildings:{minArea:.5}},loadLayers:off};
test('A terrain-only selection makes zero overlay or city tile requests',async()=>{
  let calls=0;
  const result=await loadMapLayers({...state,loadLayers:{...off,terrain:true},cityOverview:true},{request:async()=>{calls++;},cityLoader:async()=>{calls++;}});
  assert.equal(calls,0);assert.equal(result.status.loaded,true);assert.equal(result.status.error,null);assert.deepEqual(result.status.completed,[]);
});
test('Queries only contain selected area layers, including green city fallbacks',()=>{
  for(const cityOverview of [false,true]){
    const green=buildOverpassQuery({...state,cityOverview,loadLayers:{...off,green:true}},'1,2,3,4',100,'areas');
    assert.match(green,/forest/);assert.doesNotMatch(green,/coastline|reservoir|node\[/);
    const water=buildOverpassQuery({...state,cityOverview,loadLayers:{...off,water:true}},'1,2,3,4',100,'areas');
    assert.match(water,/coastline/);assert.doesNotMatch(water,/forest|grass|node\[/);
  }
  assert.deepEqual(requestedStages({...state,loadLayers:{...off,buildings:true,roads:true}}),['roads','buildings']);
  const major=buildOverpassQuery({...state,loadLayers:{...off,roads:true}},'1,2,3,4',100,'roads');
  assert.doesNotMatch(major,/residential|service/);
});
test('Shared city tiles cannot reintroduce unselected layers',async()=>{
  const data=emptyMapData();data.labels=[{name:'Town',lat:47.05,lon:11.05}];data.roadLines=[{points:[[1,1],[2,2]],scale:1}];
  const result=await loadMapLayers({...state,cityOverview:true,loadLayers:{...off,labels:true}},{cityLoader:async()=>({data,source:'fixture',tiles:1})});
  assert.equal(result.data.labels.length,1);assert.deepEqual(result.data.roadLines,[]);
  assert.deepEqual(filterSelectedLayers(data,state),emptyMapData());
});
test('Large selections warn without silently deselecting requested detail',()=>{
  const bounds={sw:{lat:47,lng:11},ne:{lat:48,lng:12}},layers={...off,buildings:true,roads:true,minorRoads:true};
  assert.match(layerWarning(bounds,'3d',layers),/buildings and smaller streets/);
  assert.deepEqual(requestedStages({...state,loadLayers:layers}),['roads','buildings']);
});
test('512-pixel terrain tiles decode correctly at tile boundaries',async()=>{
  const pixels=new Uint8ClampedArray(512*512*4);
  for(let i=0;i<pixels.length;i+=4)pixels.set([131,232,0,255],i);
  const result=await loadTiles(state.renderBbox,{tileSize:512,source:'Mapterhorn fixture',rows:12,cols:12,fetchTile:async()=>pixels});
  assert.equal(result.min,1000);assert.equal(result.delta,0);assert.equal(result.h.length,144);assert.match(result.source,/Mapterhorn/);
});
test('Secondary terrain runs before point lookup; quota reasons survive total failure',async()=>{
  const flat=normalizeTerrain([0,0,0,0],2,2,'fixture'),calls=[];
  const result=await loadTerrain(state.renderBbox,{primary:async()=>{calls.push('primary');throw Error('HTTP 429 rate limit exceeded');},secondary:async()=>{calls.push('secondary');return flat;},fallback:async()=>{calls.push('lookup');return flat;}});
  assert.equal(result,flat);assert.deepEqual(calls,['primary','secondary']);
  await assert.rejects(loadTerrain(state.renderBbox,{primary:async()=>{throw Error('HTTP 429 rate limit exceeded');},secondary:null,fallback:async()=>{throw Error('offline');}}),/429 rate limit exceeded/);
});
test('Provider ranking keeps .ru last even after it succeeds; custom endpoint stays first',async()=>{
  const ru=MAP_PROVIDERS.at(-1);
  await requestMapData('fixture',{endpoints:[ru],fetchImpl:async()=>({ok:true,json:async()=>({elements:[]})})});
  const ranked=rankProviders([ru,MAP_PROVIDERS[1],'https://custom.example/api/interpreter',MAP_PROVIDERS[0]]);
  assert.equal(ranked[0],'https://custom.example/api/interpreter');assert.equal(ranked.at(-1),ru);
});
