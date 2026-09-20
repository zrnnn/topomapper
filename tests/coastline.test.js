import test from 'node:test';
import assert from 'node:assert/strict';
import {coastlineAreas,joinCoastlines,buildingPath} from '../src/lib/buildings.js';
import {buildModel,defaultModel} from '../src/lib/model.js';
import {exportModel} from '../src/lib/model-export.js';
import init from 'manifold-3d';

const frame=[[0,0],[100,0],[100,100],[0,100]];
const signed=r=>r.reduce((sum,p,i)=>{const q=r[(i+1)%r.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
const size=records=>records.reduce((sum,r)=>sum+r.polygons.reduce((s,p)=>s+Math.abs(signed(p[0]))-p.slice(1).reduce((a,h)=>a+Math.abs(signed(h)),0),0),0);
const bay=[[0,20],[50,20],[50,80],[0,80]];
test('Same-edge coastlines retain both the bay and its complementary sea',()=>{
  assert.equal(size(coastlineAreas([bay],frame)),3000);
  assert.equal(size(coastlineAreas([bay.slice().reverse()],frame)),7000);
  assert.equal(size(coastlineAreas([bay.slice().reverse()],frame.slice().reverse())),7000);
});
test('Separated bays and a sea channel preserve land between shorelines',()=>{
  const upper=[[0,10],[40,10],[40,30],[0,30]];
  const lower=[[0,60],[30,60],[30,90],[0,90]];
  const result=coastlineAreas([upper,lower],frame);
  assert.equal(result.length,2);assert.equal(size(result),1700);
  assert.equal(size(coastlineAreas([[[0,30],[100,30]],[[100,70],[0,70]]],frame)),4000);
});
test('Islands remain dry, including when an open coastline is present',()=>{
  const island=[[60,40],[60,60],[80,60],[80,40],[60,40]];
  assert.equal(size(coastlineAreas([island],frame)),9600);
  const water=coastlineAreas([bay.slice().reverse(),island],frame);
  assert.equal(size(water),6600);assert.match(buildingPath(water[0]),/Z/);
});
test('Coastline assembly preserves direction and removes duplicate tile results',()=>{
  const a=bay.slice(0,2),b=bay.slice(1,3),c=bay.slice(2);
  const joined=joinCoastlines([c,a,b,a]);assert.deepEqual(joined,[bay]);
  assert.equal(size(coastlineAreas(joined,frame)),3000);
});
test('Corrected sea footprint survives 3D fusion and every model export',async()=>{
  const engine=await init();engine.setup();
  const state={wMm:100,hMm:100,shape:'rect',terrainData:{cols:2,rows:2,h:[0,0,0,0],delta:0},renderBbox:{sw:{lat:0,lng:0},ne:{lat:.01,lng:.01}},osmData:{waterAreas:coastlineAreas([bay.slice().reverse()],frame)}};
  const model=await buildModel(engine,state,{...defaultModel(),width:100,resolution:40,buildings:false,roads:false,water:true,terrain:false});
  assert.ok(Math.abs(model.volume-(10000*2+7000*.3))<.1);
  for(const format of ['3mf','stl','obj'])assert.ok((await exportModel(model,format)).blob.size>0);
  const edges=new Map();for(const tri of model.mesh.t)for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3],k=[a,b].sort((x,y)=>x-y).join(':');edges.set(k,(edges.get(k)||0)+1);}
  assert.ok([...edges.values()].every(n=>n===2));
});
