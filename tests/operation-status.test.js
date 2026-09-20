import test from 'node:test';
import assert from 'node:assert/strict';
import {describeError,terrainProgress} from '../src/lib/operation-status.js';

test('Errors are classified into actionable, bounded reports',()=>{
  assert.equal(describeError(new DOMException('Cancelled','AbortError'),'area').kind,'cancelled');
  assert.equal(describeError(new Error('This operation took too long'),'model').kind,'timeout');
  assert.match(describeError(new Error('HTTP 503'),'area').action,/retry/i);
  assert.equal(describeError(new Error('Check width: use a value between 50 and 400.'),'model').kind,'settings');
  assert.equal(describeError(new Error('Solid fusion failed'),'model').kind,'geometry');
  assert.ok(describeError(new Error('x'.repeat(500))).technical.length<=240);
});
test('Terrain progress maps provider counters into stable UI progress',()=>{
  assert.deepEqual(terrainProgress('Loading terrain 2/4'),{phase:'terrain',detail:'Loading terrain 2/4',percent:32});
  assert.equal(terrainProgress('Fallback terrain 256/512').percent,48);
});
