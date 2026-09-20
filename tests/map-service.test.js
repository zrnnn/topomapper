import test from 'node:test';
import assert from 'node:assert/strict';
import {requestMapData,MAP_REQUEST_TIMEOUT_MS,MAP_QUERY_TIMEOUT_SECONDS,MAP_TOTAL_TIMEOUT_MS} from '../src/lib/map-service.js';
test('Server timeout leaves room for transfer and fallback requests',()=>{
  assert.ok(MAP_REQUEST_TIMEOUT_MS>MAP_QUERY_TIMEOUT_SECONDS*1000);
  assert.ok(MAP_TOTAL_TIMEOUT_MS>MAP_REQUEST_TIMEOUT_MS*2);
});
test('Unavailable or incomplete primary responses retry another provider',async()=>{
  for(const bad of [{ok:false,status:503},{ok:true,json:async()=>({remark:'runtime timeout',elements:[]})}]){
    let calls=0;
    const data=await requestMapData('query',{fetchImpl:async()=>++calls===1?bad:{ok:true,json:async()=>({elements:[{id:42}]})}});
    assert.equal(calls,2);assert.equal(data.elements[0].id,42);
  }
});
test('Timed-out requests fall back; cancellation does not start another request',async()=>{
  let calls=0;
  const stalled=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  await requestMapData('query',{timeoutMs:5,fetchImpl:(...args)=>++calls===1?stalled(...args):Promise.resolve({ok:true,json:async()=>({elements:[]})})});
  assert.equal(calls,2);
  const controller=new AbortController();controller.abort();calls=0;
  await assert.rejects(requestMapData('query',{signal:controller.signal,fetchImpl:async()=>{calls++;}}),{name:'AbortError'});
  assert.equal(calls,0);
});
