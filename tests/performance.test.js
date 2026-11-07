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
  assert.deepEqual(a.status.completed,['water','green','labels','roads']);assert.match(a.status.error,/429/);
  calls.length=0;
  const b=await loadMapLayers({...state,wMm:250},{request,endpoints:['https://cache-test.invalid']});
  assert.equal(calls.length,1);assert.deepEqual(b.status.completed,['water','green','labels','roads']);
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

test('Persistent cache requests use only the digest of a custom provider query',async()=>{
  const saved=[];
  const previous={caches:globalThis.caches,location:globalThis.location};
  try {
    globalThis.location={origin:'https://topomapper.invalid'};
    globalThis.caches={open:async()=>({put:async url=>saved.push(url),keys:async()=>[]})};
    const {cacheBytes}=await import('../src/lib/data-cache.js');
    await cacheBytes('osm-v2:https://provider.invalid/private?token=fixture',new Uint8Array([1,2]));
    assert.match(saved[0],/^https:\/\/topomapper\.invalid\/__topomapper_cache__\/[0-9a-f]{64}$/);
  } finally {
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    }
  }
});

test('Two detail stages overlap but publish in priority order; buildings start last',async()=>{
  const stages=['water','green','labels','rivers','roads','buildings'];
  const pending=new Map(),started=[],published=[];
  const run=loadMapLayers({...state,includeBuildings:true},{endpoints:['https://concurrency.fixture'],
    request:async query=>{
      const stage=query.includes('["building"]')?'buildings':query.includes('["highway"')?'roads':query.includes('["waterway"~')?'rivers':query.includes('forest')?'green':query.includes('node[')?'labels':'water';
      started.push(stage);
      return new Promise(resolve=>pending.set(stage,()=>resolve({elements:[]})));
    },progress:update=>{if(update.snapshot)published.push(update.snapshot.status.completed.at(-1));}});
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  await tick();assert.deepEqual(started,stages.slice(0,2));
  pending.get('green')();await tick();assert.deepEqual(published,[]);
  pending.get('water')();await tick();assert.deepEqual(started,stages.slice(0,4));
  pending.get('labels')();pending.get('rivers')();await tick();assert.deepEqual(started,stages);
  pending.get('buildings')();pending.get('roads')();
  await run;assert.deepEqual(published,stages);
});

test('Neighborhood layers share one query and preserve ordered output on cache hits',async()=>{
  const small={...state,renderBbox:{sw:{lat:47,lng:11},ne:{lat:47.002,lng:11.002}},includeBuildings:true};
  const queries=[],options={endpoints:['https://neighborhood.fixture'],request:async q=>{queries.push(q);return {elements:[]};}};
  for(let i=0;i<2;i++){
    const result=await loadMapLayers(small,options);
    assert.deepEqual(result.status.completed,['areas','rivers','roads','buildings']);
    assert.equal(result.status.error,null);
  }
  assert.equal(queries.length,1);
  for(const tag of ['natural','waterway','highway','building'])assert.ok(queries[0].includes('["'+tag+'"'));
});

test('A rejected neighborhood batch falls back to layers and retries only missing stages',async()=>{
  let calls=0;
  const small={...state,renderBbox:{sw:{lat:47,lng:11},ne:{lat:47.002,lng:11.002}}};
  const options={endpoints:['https://neighborhood-retry.fixture'],request:async q=>{
    calls++;if(q.includes('["highway"'))throw new Error('HTTP 429 quota exceeded');return {elements:[]};
  }};
  const first=await loadMapLayers(small,options);
  assert.deepEqual(first.status.completed,['water','green','labels','rivers']);assert.match(first.status.error,/429/);
  assert.equal(calls,6);
  await loadMapLayers(small,options);assert.equal(calls,7);
});

test('Automatic native tiles provide every selected layer without a separate building request',async()=>{
  const small={...state,renderBbox:{sw:{lat:47,lng:11},ne:{lat:47.002,lng:11.002}},includeBuildings:true};
  const building={id:'b',name:'Building',height:{metres:10,estimated:true,source:'tile'},polygons:[[[[0,0],[4,0],[4,4],[0,4],[0,0]]]]};
  const calls=[];
  const result=await loadMapLayers(small,{cityLoader:async(_state,options)=>{
    calls.push(options.neighborhood);
    return {data:{...emptyMapData(),buildings:[building]},tiles:1,source:'OpenFreeMap'};
  },request:async()=>{throw Error('Unexpected Overpass request');}});
  assert.deepEqual(calls,[true]);assert.equal(result.status.error,null);
  assert.equal(result.data.buildings[0].height.metres,10);assert.equal(result.status.tiles,1);
});

test('A sub-city frame that exceeds 16 native tiles still gets its geographic layers from overview tiles',async()=>{
  const frame={...state,renderBbox:{sw:{lat:47,lng:11},ne:{lat:47.002,lng:11.42}}};
  assert.ok(vectorTilePlan(frame.renderBbox,{maxZoom:14,native:true}).z<14);
  const result=await loadMapLayers(frame,{
    cityLoader:async(_state,options)=>{
      assert.equal(options.neighborhood,false);
      return {data:emptyMapData(),tiles:2,source:'tile fixture'};
    },
    request:async()=>{assert.fail('This selection needs no Overpass requests');}
  });
  assert.deepEqual(result.status.completed,['areas','rivers','roads']);
  assert.equal(result.status.error,null);
  assert.equal(result.status.source,'tile fixture');
});

test('An oversized native batch keeps base overlays and requests only the remaining detail from Overpass',async()=>{
  const frame={...state,includeBuildings:true,includeMinorRoads:true,
    renderBbox:{sw:{lat:48,lng:12},ne:{lat:48.003,lng:12.003}}};
  const modes=[],queries=[];
  const result=await loadMapLayers(frame,{cityLoader:async(s,{neighborhood})=>{
    modes.push(neighborhood);
    if(neighborhood)throw Object.assign(new Error('geometry limit'),{code:'size'});
    assert.equal(s.loadLayers.buildings,false);
    assert.equal(s.loadLayers.roads,false);
    return {data:emptyMapData(),tiles:2,source:'tile fixture'};
  },request:async query=>{queries.push(query);return {elements:[]};}});
  assert.deepEqual(modes,[true,false]);
  assert.equal(queries.length,2);
  assert.ok(queries.some(q=>q.includes('["building"]')));
  assert.ok(queries.some(q=>q.includes('residential')));
  assert.equal(result.status.error,null);
  assert.match(result.status.source,/tile fixture.*Overpass/);
});

test('Tile outage followed by complete Overpass recovery clears the missing-layer warning',async()=>{
  const result=await loadMapLayers({...state,cityOverview:true},{cityLoader:async()=>{throw Error('HTTP 502');},
    request:async()=>({elements:[]})});
  assert.equal(result.status.error,null);
  assert.equal(result.status.source,'OpenStreetMap / Overpass');
  assert.deepEqual(result.status.completed,['water','green','labels','rivers','roads']);
});

test('Timeout and gateway failures on water keep green geometry and place names; retry fetches only water',async()=>{
  const frame={...state,loadLayers:{water:true,green:true,labels:true,rivers:false,roads:false,buildings:false}};
  const queries=[];
  const options={endpoints:['https://layer-retry.fixture'],request:async q=>{
    queries.push(q);
    if(q.includes('coastline') && queries.length===1)throw Error('provider: request timed out · mirror: HTTP 502 · last: HTTP 504');
    if(q.includes('node['))return {elements:[{type:'node',id:1,lat:47.04,lon:11.01,tags:{place:'town',name:'Town'}}]};
    const geometry=[[47.01,11.01],[47.02,11.01],[47.02,11.02],[47.01,11.01]].map(([lat,lon])=>({lat,lon}));
    return {elements:[{type:'way',id:2,geometry,tags:q.includes('forest')?{landuse:'forest'}:{natural:'water'}}]};
  }};
  const first=await loadMapLayers(frame,options);
  assert.deepEqual(first.status.completed,['green','labels']);
  assert.match(first.status.error,/water areas: .*timed out.*502.*504/);
  assert.equal(first.data.greenAreas.length,1);assert.equal(first.data.labels[0].name,'Town');
  queries.length=0;
  // Allow water to succeed on the second generation.
  const retry=await loadMapLayers(frame,{...options,request:async q=>{
    queries.push(q);return {elements:[]};
  }});
  assert.equal(queries.length,1);assert.match(queries[0],/coastline/);
  assert.equal(retry.status.error,null);assert.equal(retry.data.greenAreas.length,1);
});

test('A dense neighborhood splits immediately after an oversized response without repeating the whole query',async()=>{
  const frame={...state,loadLayers:{water:true,green:false,labels:false,rivers:false,roads:false,buildings:false},
    renderBbox:{sw:{lat:47,lng:11},ne:{lat:47.001,lng:11.001}}};
  const queries=[];
  const result=await loadMapLayers(frame,{endpoints:['https://small-size.fixture'],request:async query=>{
    queries.push(query);
    if(query===queries[0])throw Object.assign(new Error('Oversized response'),{code:'size'});
    return {elements:[]};
  }});
  assert.equal(result.status.error,null);
  assert.deepEqual(result.status.completed,['water']);
  assert.equal(new Set(queries).size,5);assert.equal(queries.length,5);
});

test('An exhausted download budget still publishes ready tiles and skips uncached detailed requests',async()=>{
  const calls=[];
  const result=await loadMapLayers({...state,cityOverview:true,includeBuildings:true},{
    cityLoader:async(_s,{budget})=>{
      budget.bytes=budget.maxBytes;
      return {data:emptyMapData(),tiles:2,source:'cached overview'};
    },request:async q=>{calls.push(q);return {elements:[]};}
  });
  assert.deepEqual(result.status.completed,['areas','rivers','roads']);
  assert.match(result.status.error,/buildings:.*budget/);assert.equal(calls.length,0);
});

test('An interrupted road never connects across missing coordinates; other features remain usable',async()=>{
  const point=i=>({lat:47.02,lon:11+i*.01});
  const elements=[
    {type:'relation',id:1,tags:{highway:'primary'},members:[null,{geometry:[point(0),point(1),null,point(3),point(4)]}]},
    {type:'way',id:2,tags:{building:'yes'},geometry:[point(0),null,point(1)]},
    {type:'way',id:3,tags:{building:'yes'},geometry:[point(0),point(1),{lat:47.03,lon:11.02},point(0)]},
    {type:'node',id:4,tags:{place:'town',name:'Missing coordinates'}}
  ];
  const result=await loadMapLayers({...state,includeBuildings:true},{endpoints:['https://gaps.fixture'],request:async()=>({elements})});
  assert.equal(result.status.error,null);assert.equal(result.data.labels.length,0);
  assert.equal(result.data.buildings.length,1);
  assert.deepEqual(result.data.roadLines.map(road=>road.points.length),[2,2]);
  assert.ok(result.data.roadLines[1].points[0][0]>result.data.roadLines[0].points[1][0]);
});

test('A valid empty response replaces a damaged cached query and can be reused offline',async()=>{
  const {cacheBytes}=await import('../src/lib/data-cache.js');
  const {buildOverpassQuery}=await import('../src/lib/map-parser.js');
  const frame={...state,loadLayers:{water:false,green:false,labels:true,rivers:false,roads:false,buildings:false}};
  const endpoints=['https://cache-repair.fixture'];
  const query=buildOverpassQuery(frame,'47,11,47.1,11.1',0,'labels');
  const key='osm-v2:'+JSON.stringify(endpoints)+':'+query;
  for(const bad of ['not JSON','{"elements":[null]}','{"remark":"timeout","elements":[]}']){
    await cacheBytes(key,new TextEncoder().encode(bad));
    let calls=0;
    for(let i=0;i<2;i++){
      const result=await loadMapLayers(frame,{endpoints,request:async()=>{calls++;return {elements:[]};}});
      assert.equal(result.status.error,null);assert.deepEqual(result.status.completed,['labels']);
    }
    assert.equal(calls,1);
  }
});
