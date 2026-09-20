import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionPolicy} from '../src/lib/selection-policy.js';

const boundsForKm2=km2=>({sw:{lat:0,lng:0},ne:{lat:Math.sqrt(km2)/111.195,lng:Math.sqrt(km2)/111.195}});

test('Area policy protects dense 3D buildings before 2D buildings',()=>{
  assert.equal(selectionPolicy(boundsForKm2(30),'3d').buildingsRecommended,false);
  assert.equal(selectionPolicy(boundsForKm2(30),'2d').buildingsRecommended,true);
});

test('Whole-city policy excludes minor roads and reduces the display budget',()=>{
  const policy=selectionPolicy(boundsForKm2(50),'2d');
  assert.equal(policy.minorRoadsRecommended,false);
  assert.equal(policy.maxMapPoints,60000);
});
