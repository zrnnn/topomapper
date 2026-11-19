import test from 'node:test';
import assert from 'node:assert/strict';
import {describeError,terrainProgress,batchProgress} from '../src/lib/operation-status.js';

test('Errors are classified into actionable, bounded reports',()=>{
  assert.equal(describeError(new DOMException('Cancelled','AbortError'),'area').kind,'cancelled');
  assert.equal(describeError(new Error('This operation took too long'),'model').kind,'timeout');
  assert.match(describeError(new Error('HTTP 503'),'area').action,/retry/i);
  assert.equal(describeError(new Error('Check width: use a value between 50 and 400.'),'model').kind,'settings');
  assert.equal(describeError(new Error('Solid fusion failed'),'model').kind,'geometry');
  assert.ok(describeError(new Error('x'.repeat(500))).technical.length<=240);
});
test('Measured batch progress uses completed units and leaves unknown waits open-ended',()=>{
  assert.deepEqual(batchProgress(2,8,4000),{percent:25,etaSeconds:12});
  assert.deepEqual(batchProgress(1,8,4000),{percent:12,etaSeconds:null});
  assert.deepEqual(batchProgress(8,8,4000),{percent:100,etaSeconds:null});
  assert.equal(terrainProgress('Looking for a provider').percent,undefined);
});
test('Provider quota responses are reported as limits with a fallback action',()=>{
  const report=describeError(new Error('Map service HTTP 429: rate limit exceeded'),'area');
  assert.equal(report.kind,'limit');
  assert.match(report.action,/another Overpass endpoint/i);
});
