import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBuildingLod,separateBuildingParts,footprintArea,limitCityFootprints} from '../src/lib/buildings.js';
import {applyMapPointBudget} from '../src/lib/map-lod.js';
import {parseMapStage,buildOverpassQuery,mapProjection,emptyMapData} from '../src/lib/map-parser.js';
import {addNYCHeights,useNYCHeights} from '../src/lib/nyc-buildings.js';
import {personalEndpoint,keyedProviders,regionalEndpoint} from '../src/lib/map-providers.js';
import {loadMapLayers} from '../src/lib/map-pipeline.js';

const state={wMm:200,hMm:140,shape:'rect',renderBbox:{sw:{lat:40.7474,lng:-73.9865},ne:{lat:40.7489,lng:-73.9848}},
  cityOverview:false,outputMode:'3d',loadLayers:{buildings:true,roads:false,water:false,rivers:false,green:false,labels:false},mapFeatures:{buildings:{minArea:0}}};
const rect=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const feature=(id,tags)=>({id,type:'way',tags,geometry:rect(-73.986,40.748,.0002,.0003).map(([lon,lat])=>({lon,lat}))});
const b=(id,width,props={})=>({id,polygons:[[rect(0,0,width,2)]],...props});

test('Printable landmarks and known heights survive both city cutoffs',()=>{
  const records=[b('warehouse',40),b('landmark',3,{landmark:true}),b('measured',4,{height:{estimated:false}}),b('tiny',.01,{landmark:true})];
  const result=prepareBuildingLod(records,{minArea:.2,maxBuildings:3}).buildings;
  assert.deepEqual(result.map(b=>b.id),['landmark','measured','warehouse']);
  assert.deepEqual(limitCityFootprints(result,10).map(b=>b.id),['landmark','measured']);
  const limited=applyMapPointBudget({...emptyMapData(),buildings:records},{maxPoints:10,minBuildingArea:.2,fitBuildings:true});
  assert.equal(limited.stats.omittedForBudget,1);assert.equal(limited.stats.points,10);
});

test('Only detailed local 3D building queries request grounded, height-bearing sections',()=>{
  assert.match(buildOverpassQuery(state,'bbox',0,'buildings'),/"building:part"/);
  for(const patch of [{outputMode:'2d'},{cityOverview:true},{renderBbox:{sw:{lat:40,lng:1},ne:{lat:41,lng:2}}}])
    assert.doesNotMatch(buildOverpassQuery({...state,...patch},'bbox',0,'buildings'),/"building:part"/);
  const tags={'building:part':'yes',height:'15'};
  const records=[feature(1,{building:'yes'}),feature(2,tags),feature(3,{...tags,min_height:'3 m'}),feature(4,{'building:part':'roof',height:'15'}),feature(5,{'building:part':'yes'}),feature(6,{...tags,'building:min_level':'unknown'})];
  const parts=parseMapStage(records,state,'buildings').buildings;
  assert.deepEqual(parts.map(b=>[b.id,!!b.part]),[['way/1',false],['way/2',true]]);
  assert.equal(parseMapStage(records,{...state,outputMode:'2d'},'buildings').buildings.length,1);
});

test('A lower wing cuts its own area from the parent after print filtering',()=>{
  const outline=b('parent',10),wing=b('wing',3,{part:true,footprint:6});
  const result=separateBuildingParts([outline,wing],100,100);
  assert.equal(footprintArea(result[0].polygons[0]),14);
  assert.equal(footprintArea(result[1].polygons[0]),6);
  assert.deepEqual(separateBuildingParts([outline],100,100),[outline]);
});

test('City roofs match unambiguous footprints, convert feet, cache and preserve mapped heights',async()=>{
  const ring=rect(-73.986,40.748,.0002,.0003),project=mapProjection(state);
  const roof={type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{height_roof:'50',name:'Test'}};
  const building={id:'a',polygons:[[ring.map(([lng,lat])=>project(lat,lng))]],height:{estimated:true,source:'tile'}};
  const measured={...building,height:{estimated:false,source:'height'}};
  let calls=0;
  const options={progress(){},fetchImpl:async()=>{calls++;return Response.json({type:'FeatureCollection',features:[roof]});}};
  const first=await addNYCHeights(state,[building,measured],options);
  assert.equal(first.count,1);assert.equal(first.buildings[0].height.metres,15.24);assert.equal(first.buildings[1],measured);
  assert.equal((await addNYCHeights(state,[building,{...building,id:'b'}],options)).count,0);
  assert.equal(calls,1);assert.equal(useNYCHeights(state),true);assert.equal(useNYCHeights({...state,outputMode:'2d'}),false);
});

test('An unavailable city height service preserves a completed building layer and warning',async()=>{
  const data={...emptyMapData(),buildings:[b('building',5,{height:{estimated:true,source:'tile'}})]};
  const result=await loadMapLayers(state,{cityLoader:async()=>({data,source:'test tiles',tiles:1}),roofLoader:async()=>{throw Error('HTTP 429 rate limit exceeded');}});
  assert.deepEqual(result.status.completed,['buildings']);assert.equal(result.data.buildings.length,1);assert.match(result.status.error,/429/);
});

test('Regional routing checks the entire frame and each global key stays on its selected host',()=>{
  assert.match(regionalEndpoint(state.renderBbox),/api-na/);
  assert.match(regionalEndpoint({sw:{lat:48,lng:10},ne:{lat:49,lng:11}}),/api\/interpreter/);
  assert.equal(regionalEndpoint({sw:{lat:48,lng:10},ne:{lat:56,lng:40}}),null);
  for(const [name,template] of keyedProviders){
    const url=new URL(personalEndpoint(name,'demo/?#'));
    assert.equal(url.hostname,new URL(template).hostname);assert.equal(url.search,'');assert.match(url.pathname,/demo%2F%3F%23/);
    assert.equal(personalEndpoint(name,''),null);
  }
});
