import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowAvailability,createWorkspaceStatus} from '../src/lib/workspace-status.js';
import {readBounded,downloadDetail} from '../src/lib/data-budget.js';

test('Workflow steps are unavailable until ready, and locked during work',()=>{
  let result=workflowAvailability();
  assert.equal(result.area.current,true);assert.equal(result.area.disabled,false);
  for(const key of ['2d','3d','export'])assert.equal(result[key].disabled,true);
  result=workflowAvailability({ready:true,view:'preview',mode:'3d'});
  assert.equal(result['3d'].current,true);assert.equal(result.export.disabled,false);
  result=workflowAvailability({ready:true,busy:true});
  assert.equal(result.export.disabled,true);assert.equal(result.area.disabled,false);
  result=workflowAvailability({ready:true,exportBusy:true});
  assert.ok(Object.values(result).every(item=>item.disabled));
  assert.equal(workflowAvailability({ready:true,view:'preview',step:'3'}).export.current,true);
});
test('Stream progress reports real byte counts without inventing compressed totals',async()=>{
  const updates=[];
  const response=new Response(new Uint8Array(256),{headers:{'Content-Length':'64','Content-Encoding':'gzip'}});
  await readBounded(response,{onProgress:p=>updates.push(p)});
  assert.deepEqual(updates[0],{loaded:0,total:null});
  assert.deepEqual(updates.at(-1),{loaded:256,total:null});
  assert.match(downloadDetail('https://example.org/api',updates.at(-1)),/example.org.*256 bytes loaded.*unknown/);
  const known=[];await readBounded(new Response(new Uint8Array(100),{headers:{'Content-Length':'100','Content-Encoding':'identity'}}),{onProgress:p=>known.push(p)});
  assert.deepEqual(known.at(-1),{loaded:100,total:100});
});
test('Active loading takes priority over ready previews, and context restores after navigation',()=>{
  const nodes=new Map();
  const card={dataset:{},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:'',value:0,setAttribute(){},removeAttribute(){this.value=null;}});return nodes.get(selector);}};
  const status=createWorkspaceStatus({querySelectorAll:selector=>selector==='.workspace-activity'?[card]:[]});
  try{
    status.update('area',{title:'Downloading terrain',detail:'source.test',percent:12});
    status.update('model',{state:'success',title:'Quick preview ready'});
    assert.equal(nodes.get('[data-activity-title]').textContent,'Downloading terrain');
    status.update('area',{state:'success',title:'Area ready',percent:100});
    status.update('export',{state:'success',title:'Export ready',percent:100});
    status.focus('model');assert.equal(nodes.get('[data-activity-title]').textContent,'Quick preview ready');
    status.update('preview',{title:'Rendering'});assert.equal(nodes.get('progress').value,null);
    status.clear('preview');status.focus('area');assert.equal(nodes.get('[data-activity-title]').textContent,'Area ready');
  }finally{status.dispose();}
});
