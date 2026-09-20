import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {buildingHeight,parseBuildings,clipBuildings,buildingPath} from '../src/lib/buildings.js';
import {extrudeBuilding,buildBuildingMeshes} from '../src/lib/building-mesh.js';
import {create3mf} from '../src/lib/three-mf.js';
import {DESIGN_PRESETS,applyDesignPreset} from '../src/lib/presets.js';

const square=[[0,0],[10,0],[10,10],[0,10],[0,0]],hole=[[3,3],[3,7],[7,7],[7,3],[3,3]];
const way=(id,ring,tags={building:'yes'})=>({type:'way',id,tags,geometry:ring.map(([lon,lat])=>({lat,lon}))});
const project=(lat,lon)=>[lon,lat];
function checkSolid(mesh) {
  const edges=new Map();let volume=0;
  for(const t of mesh.t) {
    const [a,b,c]=t.map(i=>mesh.v[i]);
    assert.ok(a.concat(b,c).every(Number.isFinite));
    const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    assert.ok(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])>1e-10);
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let i=0;i<3;i++) {const u=t[i],v=t[(i+1)%3],key=[Math.min(u,v),Math.max(u,v)].join(',');const e=edges.get(key)||[0,0];e[0]++;e[1]+=u<v?1:-1;edges.set(key,e);}
  }
  for(const e of edges.values()) assert.deepEqual(e,[2,0]);
  assert.ok(volume>0);return volume;
}
test('Building heights use measured metres/feet, levels, then an explicit fallback',()=>{
  assert.equal(buildingHeight({height:'12 m'}).metres,12);
  assert.ok(Math.abs(buildingHeight({height:'30 ft'}).metres-9.144)<1e-8);
  assert.deepEqual(buildingHeight({'building:levels':'3'}),{metres:9,estimated:true,source:'levels'});
  assert.equal(buildingHeight({height:'unknown','building:levels':'-2'}).source,'fallback');
  assert.equal(buildingHeight({height:'999999'}).metres,9);
});
test('Parser preserves courtyard holes and suppresses duplicate member ways',()=>{
  const outer=way(1,square),inner=way(2,hole);
  const relation={type:'relation',id:3,tags:{building:'yes'},members:[{type:'way',ref:1,role:'outer',geometry:outer.geometry},{type:'way',ref:2,role:'inner',geometry:inner.geometry}]};
  const result=parseBuildings([outer,inner,relation],project);
  assert.equal(result.length,1);assert.equal(result[0].polygons[0].length,2);
  assert.equal((buildingPath(result[0]).match(/M /g)||[]).length,2);
});
test('Parser joins reversed relation fragments and ignores incomplete/no buildings',()=>{
  const relation={type:'relation',id:7,tags:{building:'yes'},members:[{role:'outer',geometry:way(1,square.slice(0,3)).geometry},{role:'outer',geometry:way(2,square.slice(2).reverse()).geometry}]};
  assert.equal(parseBuildings([relation],project).length,1);
  assert.equal(parseBuildings([way(1,square.slice(0,3)),way(2,square,{building:'no'})],project).length,0);
});
test('Building clipping retains holes and splits disconnected concave intersections',()=>{
  const building={id:'test',polygons:[[square,hole]]};
  const clipped=clipBuildings([building],[[1,1],[9,1],[9,9],[1,9]]);
  assert.equal(clipped[0].polygons[0].length,2);
  for(const p of clipped[0].polygons.flat(2)) assert.ok(p[0]>=1&&p[0]<=9&&p[1]>=1&&p[1]<=9);
  const u=[[0,0],[10,0],[10,10],[7,10],[7,3],[3,3],[3,10],[0,10],[0,0]];
  const split=clipBuildings([{polygons:[[u]]}],[[0,5],[10,5],[10,10],[0,10]]);
  assert.equal(split[0].polygons.length,2);
});
for(const [name,polygon,area] of [['rectangle',[square],100],['courtyard',[square,hole],84],['concave',[[[0,0],[10,0],[10,3],[3,3],[3,10],[0,10],[0,0]]],51]]) {
  test(`${name}: extruded building has outward, closed walls and correct volume`,()=>{
    assert.ok(Math.abs(checkSolid(extrudeBuilding(polygon,0,5))-area*5)<1e-6);
  });
}
test('Height scale and fallback control raised solids, and invalid settings fail safely',()=>{
  const state={wMm:100,hMm:100,terrainData:{rows:2,cols:2,h:[0,0,0,0],delta:0},renderBbox:{sw:{lat:0,lng:0},ne:{lat:.001,lng:.001}}};
  const building={polygons:[[square]],name:'Test',height:buildingHeight({})};
  const options={targetHeight:10,resolution:40,buildingScale:1,fallbackHeight:12};
  const a=buildBuildingMeshes(state,[building],options)[0].mesh;
  const b=buildBuildingMeshes(state,[building],{...options,buildingScale:2})[0].mesh;
  assert.ok(Math.max(...b.v.map(v=>v[2]))>Math.max(...a.v.map(v=>v[2])));
  checkSolid(a);checkSolid(b);
  assert.throws(()=>buildBuildingMeshes(state,[building],{...options,buildingScale:NaN}));
});
test('3MF packages terrain/buildings as one assembly and escapes object names',async()=>{
  const blob=await create3mf([{name:'Terrain',mesh:extrudeBuilding([square],0,2)},{name:'A & "B"',mesh:extrudeBuilding([square,hole],0,5)}]);
  const zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const xml=await zip.file('3D/3dmodel.model').async('string');
  assert.match(xml,/unit="millimeter"/);assert.match(xml,/A &amp; &quot;B&quot;/);
  assert.equal((xml.match(/<component objectid=/g)||[]).length,2);
  assert.match(xml,/<build><item objectid="3"\/><\/build>/);
  assert.ok(zip.file('_rels/.rels'));assert.ok(zip.file('[Content_Types].xml'));
});
test('Purpose-based presets reset layer visibility and disable bold contours',()=>{
  const state={theme:{},contour:{},png:{},mapFeatures:{buildings:{},roads:{},waterAreas:{},rivers:{},greenAreas:{},labels:{background:{}}}};
  for(const key of Object.keys(DESIGN_PRESETS)) {
    applyDesignPreset(state,key);assert.equal(state.contour.emphasisEvery,0);assert.ok(state.contour.width<=.12);assert.ok(state.layerOrder.includes('buildings'));
  }
  applyDesignPreset(state,'buildings');assert.equal(state.mapFeatures.buildings.enabled,true);assert.equal(state.contour.enabled,false);
  applyDesignPreset(state,'topographic');assert.equal(state.contour.enabled,true);assert.equal(state.contour.width,.12);
});
