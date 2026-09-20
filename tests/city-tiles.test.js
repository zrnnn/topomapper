import test from 'node:test';
import assert from 'node:assert/strict';
import {PbfWriter} from 'pbf';
import {decodeCityTile} from '../src/lib/city-tiles.js';
import {yLatitude} from '../src/lib/terrain.js';
import {previewBuffers} from '../src/lib/preview-buffers.js';
function waterTile(rings){
  const commands=[];let px=0,py=0;const zig=n=>n<0?-n*2-1:n*2;
  for(const ring of rings){
    commands.push(9,zig(ring[0][0]-px),zig(ring[0][1]-py));[px,py]=ring[0];
    commands.push(((ring.length-1)<<3)|2);
    for(const [x,y] of ring.slice(1)){commands.push(zig(x-px),zig(y-py));px=x;py=y;}
    commands.push(15);
  }
  const pbf=new PbfWriter();
  pbf.writeMessage(3,(_unused,layer)=>{
    layer.writeStringField(1,'water');layer.writeVarintField(5,4096);layer.writeVarintField(15,2);
    layer.writeMessage(2,(_unused,feature)=>{feature.writeVarintField(3,3);feature.writePackedVarint(4,commands);},null);
  },null);return pbf.finish();
}
const state={wMm:100,hMm:100,shape:'rect',includeMinorRoads:false,renderBbox:{sw:{lat:0,lng:0},ne:{lat:yLatitude(.25),lng:90}}};
test('Vector water tiles preserve island holes and clip buffered geometry to the tile edge',()=>{
  const bytes=waterTile([[[-10,-10],[4106,-10],[4106,4106],[-10,4106]],[[1024,1024],[1024,3072],[3072,3072],[3072,1024]]]);
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
