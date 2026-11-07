import test from 'node:test';
import assert from 'node:assert/strict';
import init from 'manifold-3d';
import JSZip from 'jszip';
import {buildModel,defaultModel,MODEL_PRESETS,terrainReliefHeight,validateModelSettings} from '../src/lib/model.js';
import {exportModel} from '../src/lib/model-export.js';
import {parseAreas,buildingHeight} from '../src/lib/buildings.js';
const engine=await init();engine.setup();
const ring=[[20,20],[40,20],[40,40],[20,40],[20,20]],hole=[[25,25],[25,35],[35,35],[35,25],[25,25]];
const state={wMm:100,hMm:80,shape:'rect',terrainData:{cols:2,rows:2,h:[0,10,0,10],delta:10,source:'Mapterhorn terrain'},renderBbox:{sw:{lat:0,lng:0},ne:{lat:.01,lng:.01}},osmData:{buildings:[{id:'b',polygons:[[ring,hole]],height:buildingHeight({height:'15'})}],roadLines:[[[10,5],[50,65]]],waterAreas:[{polygons:[[[[60,10],[75,10],[75,25],[60,25],[60,10]]]]}],greenAreas:[{polygons:[[[[5,45],[20,45],[20,60],[5,60],[5,45]]]]}],waterLines:[[[75,25],[85,60]]]}};
function closed(mesh){const edges=new Map();for(const tri of mesh.t){assert.equal(new Set(tri).size,3);for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3],k=[a,b].sort((x,y)=>x-y).join(':');const e=edges.get(k)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(k,e);}}for(const e of edges.values())assert.deepEqual(e,[2,0]);}
let model;
test('All physical layers fuse into a closed north-up surface with layer colors',async()=>{
  model=await buildModel(engine,state,{...defaultModel(),resolution:40,green:true,rivers:true});
  closed(model.mesh);assert.ok(model.volume>200*160*2);assert.equal(model.counts.buildings,1);assert.equal(new Set(model.mesh.colors).size,5);assert.ok(model.mesh.v.every(p=>p.every(Number.isFinite)));
});
test('STL and OBJ use the fused surface and 3MF preserves six aligned materials',async()=>{
  const stl=await exportModel(model,'stl');assert.equal(stl.blob.size,84+50*model.triangles);
  const obj=await (await exportModel(model,'obj')).blob.text();assert.equal((obj.match(/^f /gm)||[]).length,model.triangles);
  const zip=await JSZip.loadAsync(await (await exportModel(model,'3mf')).blob.arrayBuffer());const xml=await zip.file('3D/3dmodel.model').async('string');assert.equal((xml.match(/<triangle /g)||[]).length,model.parts.reduce((n,p)=>n+p.mesh.t.length,0));
  assert.deepEqual(model.parts.map(p=>p.name),['Terrain','Green areas','Water','Rivers','Roads','Buildings']);
  const solids = model.parts.map(({name,mesh},index)=>{
    assert.ok(xml.includes(`name="${name}" type="model" pid="${model.parts.length+2}" pindex="${index}"`));
    closed(mesh);
    return new engine.Manifold(new engine.Mesh({numProp:3,vertProperties:Float32Array.from(mesh.v.flat()),triVerts:Uint32Array.from(mesh.t.flat())}));
  });
  try {
    let sum=0;
    for (const [i,solid] of solids.entries()) {
      assert.equal(solid.status(),'NoError'); sum+=solid.volume();
      for (const other of solids.slice(i+1)) {
        const overlap=solid.intersect(other);
        try { assert.ok(Math.abs(overlap.volume()) < .01); } finally { overlap.delete(); }
      }
    }
    assert.ok(Math.abs(sum-model.volume) < .05);
    const union=engine.Manifold.union(solids);
    try { assert.ok(Math.abs(union.volume()-model.volume)<.05); } finally { union.delete(); }
  } finally { solids.forEach(s=>s.delete()); }
  assert.match(xml,/Mapterhorn terrain/);assert.doesNotMatch(xml,/Mapzen/);assert.match(xml,/<basematerials/);assert.match(xml,/unit="millimeter"/);
});
test('Flat city preset preserves a base and raised buildings',async()=>{const city=await buildModel(engine,state,{...defaultModel(),...MODEL_PRESETS.city,resolution:40});closed(city.mesh);assert.equal(city.reliefHeight,0);assert.match(city.credits,/Flat base/);assert.ok(Math.max(...city.mesh.v.map(p=>p[2]))<20);});
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

test('Binary STL omits seams whose vertices coincide at file precision',async()=>{
  const mesh={v:[[100,10,2],[100+1e-7,10,2],[0,5,2],[0,0,0]],t:[[0,1,2],[0,2,3]]};
  const file=await exportModel({mesh},'stl');
  const view=new DataView(await file.blob.arrayBuffer());
  assert.equal(view.getUint32(80,true),1);
  assert.equal(view.byteLength,134);
});

for (const source of ['Mapzen terrain','Open-Elevation fallback']) {
  test('Terrain-only 3MF credits '+source, async()=>{
    const result=await buildModel(engine,{...state,terrainData:{...state.terrainData,source}},
      {...defaultModel(),...MODEL_PRESETS.relief,resolution:40});
    assert.deepEqual(result.parts.map(part=>part.name),['Terrain']);
    assert.equal(result.credits,source);
  });
}

test('Exported 3MF inlays stop 1 mm below the local surface and meet the ground without a gap',async()=>{
  // Read the serialized meshes so coordinate transforms and part assignment are covered.
  async function readParts(result) {
    const file=await exportModel(result,'3mf');
    const zip=await JSZip.loadAsync(await file.blob.arrayBuffer());
    const xml=await zip.file('3D/3dmodel.model').async('string');
    const parts=new Map();
    for(const match of xml.matchAll(/<object id="\d+" name="([^"]+)"[^>]*><mesh>([\s\S]*?)<\/mesh><\/object>/g)){
      const vertices=[...match[2].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].flatMap(v=>v.slice(1).map(Number));
      const faces=[...match[2].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap(t=>t.slice(1).map(Number));
      parts.set(match[1],new engine.Manifold(new engine.Mesh({numProp:3,vertProperties:Float32Array.from(vertices),triVerts:Uint32Array.from(faces)})));
    }
    return parts;
  }
  const settings={...defaultModel(),width:100,resolution:40,green:true,rivers:true,relief:500};
  const samples=[['Green areas',12,52],['Water',67,16],['Rivers',80,42.5],['Roads',14,11],['Buildings',22,29],['Buildings',38,29]];
  for(const [terrain,base] of [[true,4],[false,4],[false,1]]){
    const configured={...settings,terrain,base,roadRise:3};
    const reference=await buildModel(engine,state,{...configured,green:false,water:false,rivers:false,roads:false,buildings:false});
    const source=await readParts(reference);
    const parts=await readParts(await buildModel(engine,state,configured));
    const ground=parts.values().next().value, original=source.values().next().value;
    const lower=original.translate([0,0,-1]);
    try {
      for(const [name,part] of parts){
        if(part===ground)continue;
        const intrusion=part.intersect(lower);
        try { assert.ok(Math.abs(intrusion.volume())<.001,name+' enters deep ground'); }
        finally { intrusion.delete(); }
      }
      for(const [name,x,y] of samples){
        const from=[x,state.hMm-y,-1],to=[x,state.hMm-y,100];
        const hits=solid=>solid.rayCast(from,to).map(h=>h.position[2]);
        const surface=hits(original).at(-1), boundary=Math.max(.2,surface-1);
        const z=hits(parts.get(name));
        assert.ok(Math.abs(z[0]-boundary)<.001,`${name} starts at ${z[0]}, expected ${boundary}`);
        assert.ok(z.at(-1)>surface,name+' retains its raised geometry');
        assert.ok(Math.abs(hits(ground).at(-1)-boundary)<.001,name+' socket');
      }
    } finally {
      lower.delete();for(const solid of [...source.values(),...parts.values()])solid.delete();
    }
  }
});
