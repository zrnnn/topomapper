import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorker,disposeWorkers} from '../src/lib/worker-client.js';

test('Worker completion, cancellation and startup failures release resources', async t => {
  let instance;
  class FakeWorker {
    constructor(){ instance=this;this.terminated=false; }
    postMessage(data){this.payload=data;}
    terminate(){this.terminated=true;}
  }
  t.mock.method(globalThis,'setTimeout',globalThis.setTimeout);
  const original=globalThis.Worker;
  globalThis.Worker=FakeWorker;
  try {
    const progress=[];
    const success=runWorker('terrain',{value:1},{progress:p=>progress.push(p)});
    instance.onmessage({data:{progress:'Loading'}});
    instance.onmessage({data:{result:42}});
    assert.equal(await success,42);assert.equal(instance.terminated,false);assert.deepEqual(progress,['Loading']);
    const reused=instance;
    const controller=new AbortController();
    const pending=runWorker('terrain',{}, {signal:controller.signal});
    assert.equal(instance,reused);
    controller.abort(); await assert.rejects(pending,{name:'AbortError'});assert.ok(instance.terminated);
    await assert.rejects(runWorker('terrain',{}, {signal:controller.signal}),{name:'AbortError'});
    const failed=runWorker('mesh',{});instance.onerror();await assert.rejects(failed,/Background processing failed/);assert.ok(instance.terminated);
    FakeWorker.prototype.postMessage=()=>{throw new Error('Cannot clone');};
    await assert.rejects(runWorker('mesh',{}),/Cannot clone/);assert.ok(instance.terminated);
  } finally { disposeWorkers();if(original===undefined) delete globalThis.Worker;else globalThis.Worker=original; }
});
