import test from 'node:test';
import assert from 'node:assert/strict';
import {requestMapData,MAP_REQUEST_TIMEOUT_MS,MAP_QUERY_TIMEOUT_SECONDS,MAP_TOTAL_TIMEOUT_MS} from '../src/lib/map-service.js';
test('Third provider works and successful provider is reused for subsequent sections',async()=>{
  const endpoints=['https://one.test','https://two.test','https://three.test'],calls=[];
  const fetchImpl=async url=>{calls.push(url);return url===endpoints[2]?{ok:true,json:async()=>({elements:[]})}:{ok:false,status:503};};
  await requestMapData('query',{endpoints,fetchImpl});
  assert.deepEqual(calls,endpoints);calls.length=0;
  await requestMapData('query',{endpoints,fetchImpl});
  assert.deepEqual(calls,[endpoints[2]]);
});
test('Server timeout leaves room for transfer and fallback requests',()=>{
  assert.ok(MAP_REQUEST_TIMEOUT_MS>MAP_QUERY_TIMEOUT_SECONDS*1000);
  assert.ok(MAP_TOTAL_TIMEOUT_MS>MAP_REQUEST_TIMEOUT_MS*2);
});
test('Progress describes mirror selection and actual downloaded bytes',async()=>{
  const progress=[];let calls=0;
  await requestMapData('query',{endpoints:['https://failed.progress.test','https://working.progress.test'],preferLastSuccessful:false,progress:message=>progress.push(message),fetchImpl:async()=>++calls===1?{ok:false,status:503}:new Response('{"elements":[]}',{headers:{'Content-Encoding':'identity','Content-Length':'15'}})});
  assert.ok(progress.some(message=>/Looking for an available mirror/.test(message)));
  assert.ok(progress.some(message=>/Trying mirror working.progress.test/.test(message)));
  assert.ok(progress.some(message=>/15\/15 bytes loaded/.test(message)));
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
test('Concurrent tiles never send more than one request to the same provider',async()=>{
  let active=0,peak=0;
  const fetchImpl=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {ok:true,json:async()=>({elements:[]})};};
  await Promise.all([requestMapData('a',{endpoints:['https://one.concurrent.test'],preferLastSuccessful:false,fetchImpl}),requestMapData('b',{endpoints:['https://one.concurrent.test'],preferLastSuccessful:false,fetchImpl})]);
  assert.equal(peak,1);
});
