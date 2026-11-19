import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMapPointBudget,countMapPoints} from '../src/lib/map-lod.js';
const line=n=>Array.from({length:n},(_,i)=>[i/10,Math.sin(i/10)/100]);
const building=(id,n)=>({id,height:{metres:9,estimated:true},polygons:[[line(n).concat([[0,0]])]]});
test('Map geometry is simplified to a bounded, printable display budget',()=>{
  const source={buildings:[building('a',300),building('b',300)],roadLines:[line(2000)],waterLines:[line(1000)],waterAreas:[],greenAreas:[],labels:[]};
  const result=applyMapPointBudget(source,{maxPoints:800,minBuildingArea:0,maxBuildings:10});
  assert.ok(result.stats.originalPoints>result.stats.points);
  assert.ok(countMapPoints(result.data)<=800);
  assert.equal(result.data.buildings.length,2);
});
test('Budget refuses geometry that cannot be represented safely',()=>{
  const source={buildings:[],roadLines:Array.from({length:100},()=>[[0,0],[1,1]]),waterLines:[],waterAreas:[],greenAreas:[]};
  assert.throws(()=>applyMapPointBudget(source,{maxPoints:50}),/point display budget/);
});

test('Print-scale filtering retains long thin rivers and removes sub-0.2 mm islands and footprints',()=>{
  const ring=(w,h)=>[[0,0],[w,0],[w,h],[0,h],[0,0]];
  const data={buildings:[{polygons:[[ring(.19,3)]]}],roadLines:[[[0,0],[.1,.05]]],waterLines:[[[0,0],[3,0]]],waterAreas:[{polygons:[[ring(10,10),ring(.1,.1)],[ring(.05,1)]]}],greenAreas:[]};
  const {data:map}=applyMapPointBudget(data,{minSize:.2,minBuildingArea:0});
  assert.equal(map.buildings.length,0);assert.equal(map.roadLines.length,0);
  assert.equal(map.waterLines.length,1);assert.equal(map.waterAreas[0].polygons.length,1);
  assert.equal(map.waterAreas[0].polygons[0].length,1);
});
