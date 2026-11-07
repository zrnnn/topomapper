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
    const data=await requestMapData('query',{fetchImpl:async()=>++calls===1?bad:{ok:true,json:async()=>({elements:[{type:'way',id:42}]})}});
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
test('Custom endpoint credentials never appear in provider errors or mirror progress', async()=>{
  const endpoint='https://private.test/secret-path?key=opaque-value';
  for (const fetchImpl of [async()=>{throw new TypeError('Cannot fetch '+endpoint);},
    async()=>({ok:true,json:async()=>({remark:'quota exceeded for '+endpoint})})]) {
    const messages=[];
    await assert.rejects(requestMapData('query',{endpoints:[endpoint],fetchImpl,progress:m=>messages.push(m)}),error=>{
      messages.push(error.message);return true;
    });
    assert.doesNotMatch(messages.join(' '),/secret-path|opaque-value/);
  }
});
test('Only validated responses supply their original bytes to the cache', async()=>{
  const valid='{"elements": [], "generator": "fixture"}';
  const saved=[];
  let attempts=0;
  await requestMapData('query',{endpoints:['https://a.cache.test','https://b.cache.test'],
    fetchImpl:async()=>new Response(++attempts===1?'{"remark":"timeout"}':valid),onBytes:b=>saved.push(b)});
  assert.deepEqual(saved.map(bytes=>new TextDecoder().decode(bytes)),[valid]);
});

test('A silent provider gives way early, while a responding mirror keeps its transfer time',async()=>{
  const urls=['https://silent.fixture','https://slow-body.fixture','https://unused.fixture'];
  const calls=[];
  const result=await requestMapData('query',{endpoints:urls,firstResponseMs:10,timeoutMs:250,
    fetchImpl:async(url,{signal})=>{
      calls.push(url);
      if(url===urls[0])return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      await new Promise(resolve=>setTimeout(resolve,1));
      return {ok:true,json:async()=>{
        await new Promise(resolve=>setTimeout(resolve,25));
        assert.equal(signal.aborted,false);
        return {elements:[]};
      }};
    }});
  assert.deepEqual(calls,urls.slice(0,2));
  assert.deepEqual(result.elements,[]);
});

test('A cancelled queued request releases promptly and never starts a second fetch',async()=>{
  const endpoints=['https://busy-cancel.fixture'];
  let unblock, calls=0;
  const fetchImpl=async()=>{
    calls++;
    await new Promise(resolve=>{unblock=resolve;});
    return new Response('{"elements":[]}');
  };
  const first=requestMapData('areas',{endpoints,fetchImpl});
  await new Promise(resolve=>setImmediate(resolve));
  const controller=new AbortController();
  const second=requestMapData('rivers',{endpoints,fetchImpl,signal:controller.signal});
  controller.abort();
  try { await assert.rejects(second,{name:'AbortError'}); }
  finally { unblock();await first; }
  assert.equal(calls,1);
});

test('An upstream 502 pauses that mirror for the following stage and a healthy mirror still answers',async()=>{
  const endpoints=['https://bad-gateway.fixture','https://available-gateway.fixture'],calls=[];
  const options={endpoints,preferLastSuccessful:false,fetchImpl:async url=>{
    calls.push(url);
    return url===endpoints[0]?new Response(null,{status:502}):new Response('{"elements":[]}');
  }};
  await requestMapData('water',options);
  await requestMapData('green',options);
  assert.deepEqual(calls,[endpoints[0],endpoints[1],endpoints[1]]);
});

test('HTML and malformed JSON never echo a private response or reach the cache',async()=>{
  for(const body of ['private-token gateway failure','null','{"elements":[null]}','{"elements":[{}]}','{"elements":[{"type":"way","id":"broken"}]}']){
    const endpoint='https://invalid-body.fixture';
    const log=[],saved=[];
    await assert.rejects(requestMapData('water',{endpoints:[endpoint],fetchImpl:async()=>new Response(body),
      progress:s=>log.push(s),onBytes:b=>saved.push(b)}),error=>{
      log.push(error.message);
      return /invalid-body\.fixture:.*(invalid|incomplete)/i.test(error.message);
    });
    assert.doesNotMatch(log.join(' '),/private-token/);assert.deepEqual(saved,[]);
  }
});

test('An invalid response that consumes the remaining bytes prevents a mirror download',async()=>{
  const body='not-json',calls=[];
  await assert.rejects(requestMapData('water',{budget:{bytes:0,maxBytes:body.length},
    endpoints:['https://budget-first.fixture','https://budget-second.fixture'],
    fetchImpl:async url=>{calls.push(url);return new Response(body);}
  }),/budget/);
  assert.deepEqual(calls,['https://budget-first.fixture']);
});
