import test from 'node:test';
import assert from 'node:assert/strict';
import {areaPlan,splitArea,detailPlan} from '../src/lib/area-plan.js';
test('City selections warn and split the entire extent without gaps',()=>{
  for(const [span,count] of [[.01,1],[.1,4],[1,16]]){
    const bounds={sw:{lat:0,lng:0},ne:{lat:span,lng:span}};
    const plan=areaPlan(bounds),tiles=splitArea(bounds,plan.sections);
    assert.equal(tiles.length,count);assert.equal(plan.large,count>1);
    assert.deepEqual(tiles[0].sw,bounds.sw);assert.deepEqual(tiles.at(-1).ne,bounds.ne);
    const total=tiles.reduce((s,t)=>s+(t.ne.lat-t.sw.lat)*(t.ne.lng-t.sw.lng),0);
    assert.ok(Math.abs(total-span*span)<1e-8);
  }
});
test('Small selections load finer terrain; larger prints request more detail',()=>{
  const small={sw:{lat:0,lng:0},ne:{lat:.001,lng:.001}},city={sw:{lat:0,lng:0},ne:{lat:.1,lng:.1}};
  assert.ok(detailPlan(small).samples>detailPlan(city).samples);
  assert.ok(detailPlan(city,400,280).samples>detailPlan(city).samples);
  assert.equal(detailPlan(small).minPerimeter,0);
  assert.ok(detailPlan(city,200,140,true).minPerimeter>0);
  assert.ok(detailPlan(city,400,280,true).minPerimeter<detailPlan(city,200,140,true).minPerimeter);
});
