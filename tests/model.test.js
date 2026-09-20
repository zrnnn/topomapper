import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import JSZip from 'jszip';
import {buildModel,defaultModel,MODEL_PRESETS,terrainReliefHeight,validateModelSettings} from '../src/lib/model.js';
import {exportModel} from '../src/lib/model-export.js';
import {parseAreas,buildingHeight} from '../src/lib/buildings.js';
const engine=await init();engine.setup();
const ring=[[20,20],[40,20],[40,40],[20,40],[20,20]],hole=[[25,25],[25,35],[35,35],[35,25],[25,25]];
const state={wMm:100,hMm:80,shape:'rect',terrainData:{cols:2,rows:2,h:[0,10,0,10],delta:10},renderBbox:{sw:{lat:0,lng:0},ne:{lat:.01,lng:.01}},osmData:{buildings:[{id:'b',polygons:[[ring,hole]],height:buildingHeight({height:'15'})}],roadLines:[[[10,5],[50,65]]],waterAreas:[{polygons:[[[[60,10],[75,10],[75,25],[60,25],[60,10]]]]}],greenAreas:[{polygons:[[[[5,45],[20,45],[20,60],[5,60],[5,45]]]]}],waterLines:[[[75,25],[85,60]]]}};
function closed(mesh){const edges=new Map();for(const tri of mesh.t){assert.equal(new Set(tri).size,3);for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],k=[a,b].sort((x,y)=>x-y).join(':');const e=edges.get(k)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(k,e);}}for(const e of edges.values())assert.deepEqual(e,[2,0]);}
let model;
test('All physical layers fuse into a closed north-up surface with layer colors',async()=>{
  model=await buildModel(engine,state,{...defaultModel(),resolution:40,green:true,rivers:true});
  closed(model.mesh);assert.ok(model.volume>200*160*2);assert.equal(model.counts.buildings,1);assert.equal(new Set(model.mesh.colors).size,5);assert.ok(model.mesh.v.every(p=>p.every(Number.isFinite)));
});
test('All export formats use exactly the preview mesh',async()=>{
  const stl=await exportModel(model,'stl');assert.equal(stl.blob.size,84+50*model.triangles);
  const obj=await (await exportModel(model,'obj')).blob.text();assert.equal((obj.match(/^f /gm)||[]).length,model.triangles);
  const zip=await JSZip.loadAsync(await (await exportModel(model,'3mf')).blob.arrayBuffer());const xml=await zip.file('3D/3dmodel.model').async('string');assert.equal((xml.match(/<triangle /g)||[]).length,model.triangles);assert.match(xml,/<basematerials/);assert.match(xml,/unit="millimeter"/);
});
test('Flat city preset preserves a base and raised buildings',async()=>{const city=await buildModel(engine,state,{...defaultModel(),...MODEL_PRESETS.city,resolution:40});closed(city.mesh);assert.ok(Math.max(...city.mesh.v.map(p=>p[2]))<20);});
for(const shape of ['circle','hex'])test(`${shape}: clipped terrain and overlays fuse with no open edges`,async()=>{const result=await buildModel(engine,{...state,shape,hMm:100},{...defaultModel(),resolution:40,green:true,rivers:true});closed(result.mesh);assert.ok(result.volume>0);});
test('Invalid settings fail and dense building sets are reduced automatically',async()=>{assert.throws(()=>validateModelSettings({...defaultModel(),width:NaN}),/width/);const tiny={...state.osmData.buildings[0],polygons:[[[[20,20],[20.1,20],[20.1,20.1],[20,20.1],[20,20]]]]};const dense=await buildModel(engine,{...state,osmData:{...state.osmData,buildings:Array.from({length:2600},(_,i)=>({...tiny,id:String(i)}))}},{...defaultModel(),resolution:40});assert.equal(dense.buildingStats.shown,0);assert.equal(dense.buildingStats.omitted,2600);});
test('Terrain relief percentage preserves real proportions at 100 percent',()=>{
  const widthMetres=.01*Math.PI/180*6371008.8*Math.cos(.005*Math.PI/180);
  assert.ok(Math.abs(terrainReliefHeight(state,100)-10*100/widthMetres)<1e-9);
  assert.ok(Math.abs(terrainReliefHeight(state,500)-terrainReliefHeight(state,100)*5)<1e-9);
  assert.throws(()=>validateModelSettings({...defaultModel(),relief:9}),/relief/);
  assert.throws(()=>validateModelSettings({...defaultModel(),relief:501}),/relief/);
});
test('Landcover parsing preserves islands and incomplete relations are not fabricated',()=>{
  const geom=ring=>ring.map(([lon,lat])=>({lon,lat}));
  const relation={type:'relation',id:1,tags:{natural:'water'},members:[{type:'way',ref:1,role:'outer',geometry:geom(ring)},{type:'way',ref:2,role:'inner',geometry:geom(hole)}]};
  const result=parseAreas([relation],(lat,lon)=>[lon,lat],t=>t.natural==='water');assert.equal(result[0].polygons[0].length,2);
});
