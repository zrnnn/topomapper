import test from 'node:test';
import assert from 'node:assert/strict';
import {PbfWriter} from 'pbf';
import {decodeCityTile} from '../src/lib/city-tiles.js';
import {yLatitude} from '../src/lib/terrain.js';
import {previewBuffers} from '../src/lib/preview-buffers.js';
function polygonTile(rings,name='water'){
  const commands=[];let px=0,py=0;const zig=n=>n<0?-n*2-1:n*2;
  for(const ring of rings){
    commands.push(9,zig(ring[0][0]-px),zig(ring[0][1]-py));[px,py]=ring[0];
    commands.push(((ring.length-1)<<3)|2);
    for(const [x,y] of ring.slice(1)){commands.push(zig(x-px),zig(y-py));px=x;py=y;}
    commands.push(15);
  }
  const pbf=new PbfWriter();
  pbf.writeMessage(3,(_unused,layer)=>{
    layer.writeStringField(1,name);layer.writeVarintField(5,4096);layer.writeVarintField(15,2);
    layer.writeMessage(2,(_unused,feature)=>{feature.writeVarintField(3,3);feature.writePackedVarint(4,commands);},null);
  },null);return pbf.finish();
}
const state={wMm:100,hMm:100,shape:'rect',includeMinorRoads:false,renderBbox:{sw:{lat:0,lng:0},ne:{lat:yLatitude(.25),lng:90}}};
test('Vector water tiles preserve island holes and clip buffered geometry to the tile edge',()=>{
  const bytes=polygonTile([[[-10,-10],[4106,-10],[4106,4106],[-10,4106]],[[1024,1024],[1024,3072],[3072,3072],[3072,1024]]]);
  const result=decodeCityTile(bytes,{x:2,y:1,z:2},state);
  assert.equal(result.data.waterAreas.length,1);
  assert.equal(result.data.waterAreas[0].polygons[0].length,2);
  for(const [x,y] of result.data.waterAreas[0].polygons.flat(2)){assert.ok(x>=-1e-6&&x<=100.000001);assert.ok(y>=-1e-6&&y<=100.000001);}
});
test('Worker preview packing retains triangle positions and finite colors',()=>{
  const result=previewBuffers({v:[[0,0,0],[1,0,0],[0,1,0]],t:[[0,1,2]],colors:['#ffffff']});
  assert.deepEqual(Array.from(result.positions),[0,0,0,1,0,0,0,1,0]);
  assert.deepEqual(Array.from(result.colors),Array(9).fill(1));
});

test('An unresponsive city tile source releases the stage for its detailed fallback',async()=>{
  const {loadCityTiles}=await import('../src/lib/city-tiles.js');
  const fetchImpl=(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  await assert.rejects(loadCityTiles(state,{fetchImpl,stallMs:5}),/stalled/);
});

test('Native building tiles preserve holes and height fallback, and honor the building switch',()=>{
  const bytes=polygonTile([[[30,30],[4000,30],[4000,4000],[30,4000]],[[1000,1000],[1000,3000],[3000,3000],[3000,1000]]],'building');
  const tile={x:2,y:1,z:2};
  const {data}=decodeCityTile(bytes,tile,state,{neighborhood:true});
  assert.equal(data.buildings.length,1);
  assert.equal(data.buildings[0].polygons[0].length,2);
  assert.deepEqual(data.buildings[0].height,{metres:9,estimated:true,source:'fallback'});
  assert.equal(decodeCityTile(bytes,tile,{...state,loadLayers:{buildings:false}},{neighborhood:true}).data.buildings.length,0);
  assert.equal(decodeCityTile(bytes,tile,state).data.buildings.length,0);
});

test('Gateway failure switches to independent Shortbread tiles, including inland and ocean water',async()=>{
  const {loadCityTiles}=await import('../src/lib/city-tiles.js');
  const ring=[[[32,32],[2000,32],[2000,2000],[32,2000]]];
  const bytes=Buffer.concat(['water_polygons','ocean','buildings'].map(name=>polygonTile(ring,name)));
  const bounds={sw:{lat:49.377,lng:11.21},ne:{lat:49.378,lng:11.211}};
  const calls=[];
  // Use a full native tile frame so both polygon fixtures are in bounds.
  const {vectorTilePlan}=await import('../src/lib/city-tiles.js');
  const {x,y,z}=vectorTilePlan(bounds,{maxZoom:14,native:true}).tiles[0],n=2**z;
  const frame={sw:{lat:yLatitude((y+1)/n)+1e-8,lng:x/n*360-180+1e-8},ne:{lat:yLatitude(y/n)-1e-8,lng:(x+1)/n*360-180-1e-8}};
  const options={neighborhood:true,fetchImpl:async url=>{
    calls.push(url);
    if(url.includes('openfreemap'))return new Response(null,{status:502});
    if(url.endsWith('tiles.json'))return Response.json({tiles:['/tiles/osm/{z}/{x}/{y}'],maxzoom:14,vector_layers:[{id:'buildings',minzoom:14}]});
    assert.equal(url,`https://tiles.versatiles.org/tiles/osm/${z}/${x}/${y}`);
    return new Response(bytes);
  }};
  const result=await loadCityTiles({...state,renderBbox:frame},options);
  assert.equal(calls.length,3);
  assert.match(result.source,/VersaTiles/);
  assert.equal(result.data.waterAreas.length,2);assert.equal(result.data.buildings.length,1);
});
