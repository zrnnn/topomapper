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
