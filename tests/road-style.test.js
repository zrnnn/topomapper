import test from 'node:test';
import assert from 'node:assert/strict';
import {isMinorRoad,roadClassScale,roadPoints,roadRecord} from '../src/lib/road-style.js';

test('Road hierarchy keeps one layer while scaling major and minor streets',()=>{
  assert.ok(roadClassScale('motorway')>roadClassScale('primary'));
  assert.ok(roadClassScale('primary')>roadClassScale('residential'));
  assert.equal(isMinorRoad('service'),true);
  assert.equal(isMinorRoad('secondary'),false);
  const road=roadRecord([[0,0],[1,1]],'trunk');
  assert.deepEqual(roadPoints(road),[[0,0],[1,1]]);
});
