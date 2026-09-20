import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometry, simplifyPolyline } from '../src/lib/geometry.js';
import { buildTerrainMesh } from '../src/lib/mesh.js';
import { escapeXml } from '../src/lib/xml.js';
import { decodeTerrarium, normalizeTerrain, latitudeY, yLatitude, validateBounds, loadTiles, loadLookup, loadTerrain } from '../src/lib/terrain.js';

const bounds = {sw:{lat:47.5,lng:10.7},ne:{lat:47.6,lng:10.8}};
const terrain = normalizeTerrain([0,10,20,10,20,30,20,30,40],3,3,'fixture');
const state = shape => ({wMm:200,hMm:200,shape,terrainData:terrain,contour:{density:40,width:.2}});
test('Place names and quoted font families cannot break SVG markup',()=>{
  assert.equal(escapeXml('A & B <script>'), 'A &amp; B &lt;script&gt;');
  assert.equal(escapeXml('"Roboto Mono", "SF Mono"'), '&quot;Roboto Mono&quot;, &quot;SF Mono&quot;');
  assert.equal(escapeXml("O'Brien"), 'O&apos;Brien');
});
test('Terrarium decoding includes negative heights and fractional metres',()=>{
  assert.equal(decodeTerrarium(128,0,0),0);
  assert.equal(decodeTerrarium(127,255,128),-.5);
  assert.equal(decodeTerrarium(131,232,0),1000);
});
test('Mercator projection round trips and aligns high latitude samples',()=>{
  for(const lat of [-85,-60,0,47.5,60,85]) assert.ok(Math.abs(yLatitude(latitudeY(lat))-lat)<1e-10);
});
test('Bounds validation rejects inverted, date-line and polar selections',()=>{
  validateBounds(bounds);
  for(const bad of [{sw:{lat:10,lng:170},ne:{lat:20,lng:190}},{sw:{lat:86,lng:0},ne:{lat:88,lng:1}},{sw:{lat:20,lng:1},ne:{lat:10,lng:2}},{sw:{lat:0,lng:NaN},ne:{lat:1,lng:2}}]) assert.throws(()=>validateBounds(bad));
});
test('Terrain validation rejects incomplete, null and nonfinite responses',()=>{
  for(const heights of [[1,2,3],[1,2,3,null],[1,2,3,NaN],[1,2,3,Infinity],[1,2,3,-32768]]) assert.throws(()=>normalizeTerrain(heights,2,2,'bad'));
  assert.equal(normalizeTerrain([5,5,5,5],2,2,'flat').delta,0);
});
test('Tile sampling decodes constant terrain across tile boundaries with bounded concurrency',async()=>{
  let active=0,maxActive=0;
  const pixels=new Uint8ClampedArray(256*256*4);
  for(let i=0;i<pixels.length;i+=4) pixels.set([131,232,0,255],i);
  const result=await loadTiles(bounds,{rows:12,cols:12,fetchTile:async()=>{
    maxActive=Math.max(maxActive,++active); await Promise.resolve(); active--; return pixels;
  }});
  assert.ok(maxActive<=4); assert.equal(result.min,1000); assert.equal(result.delta,0); assert.equal(result.h.length,144);
});
test('Transparent or incomplete tiles are rejected',async()=>{
  await assert.rejects(loadTiles(bounds,{rows:4,cols:4,fetchTile:async()=>new Uint8Array(256*256*4)}));
  await assert.rejects(loadTiles(bounds,{rows:4,cols:4,fetchTile:async()=>new Uint8Array(4)}));
});
test('Fallback runs only after primary failure, and reports total failure',async()=>{
  let calls=0;
  const fallback=async()=>{calls++;return terrain;};
  assert.equal(await loadTerrain(bounds,{primary:async()=>terrain,fallback}),terrain); assert.equal(calls,0);
  assert.equal(await loadTerrain(bounds,{primary:async()=>{throw Error('offline');},fallback}),terrain); assert.equal(calls,1);
  await assert.rejects(loadTerrain(bounds,{primary:async()=>{throw Error();},fallback:async()=>{throw Error();}}),/previous preview is preserved/);
});
test('Lookup fallback batches requests and validates returned coordinates',async()=>{
  const sizes=[];
  const result=await loadLookup(bounds,{fetchBatch:async locations=>{sizes.push(locations.length);return {results:locations.map(p=>({...p,elevation:10}))};}});
  assert.equal(result.h.length,4096); assert.deepEqual(sizes,Array(8).fill(512));
  await assert.rejects(loadLookup(bounds,{fetchBatch:async()=>({results:[]})}),/Incomplete/);
  await assert.rejects(loadLookup(bounds,{fetchBatch:async locations=>({results:locations.map(p=>({...p,longitude:0,elevation:10}))})}),/coordinates/);
});
test('Smoothing preserves open contour endpoints and limits point growth',()=>{
  const g=createGeometry(state('rect')),line=[[0,0],[50,20],[100,0]];
  const smoothed=g.smoothPolyline(line,5);
  assert.deepEqual(smoothed[0],line[0]); assert.deepEqual(smoothed.at(-1),line.at(-1));
  assert.ok(smoothed.length<80);
  assert.deepEqual(simplifyPolyline([[0,0],[1,0],[2,0]]),[[0,0],[2,0]]);
});
test('Polygon area includes the closing edge',()=>{
  assert.equal(createGeometry(state('rect')).polygonArea([[10,10],[20,10],[20,20],[10,20]]),100);
});
for(const shape of ['rect','circle','hex']) {
  test(`${shape}: contour crossing boundary is clipped, not discarded`,()=>{
    const g=createGeometry(state(shape)),poly=g.getClipPolygon();
    const clipped=g.clipPolylineToPolygon([[-10,100],[210,100]],poly);
    assert.equal(clipped.length,1); assert.ok(clipped[0][0][0]>=-1e-6); assert.ok(clipped[0].at(-1)[0]<=200+1e-6);
    for(const p of clipped.flat()) assert.ok(g.isInShape(...p));
  });
  for(const flat of [false,true]) test(`${shape}: ${flat?'flat':'sloped'} 3MF mesh is closed and consistently outward`,()=>{
    const data=state(shape); if(flat) data.terrainData=normalizeTerrain(Array(9).fill(10),3,3,'flat');
    const mesh=buildTerrainMesh(data,{resolution:40,targetHeight:10});
    const edges=new Map(); let volume=0;
    for(const t of mesh.t) {
      const [a,b,c]=t.map(i=>mesh.v[i]);
      const cross=[(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])];
      assert.ok(Math.hypot(...cross)>1e-9,'no serialized degenerate triangle');
      if(a[2]===0&&b[2]===0&&c[2]===0) assert.ok(cross[2]<0,'bottom faces downward');
      volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
      for(let i=0;i<3;i++) {
        const u=t[i],v=t[(i+1)%3],key=[Math.min(u,v),Math.max(u,v)].join(',');
        const e=edges.get(key)||{count:0,direction:0}; e.count++;e.direction+=u<v?1:-1; edges.set(key,e);
      }
    }
    for(const edge of edges.values()) { assert.equal(edge.count,2);assert.equal(edge.direction,0); }
    assert.ok(volume>0,'positive enclosed volume');
  });
}
