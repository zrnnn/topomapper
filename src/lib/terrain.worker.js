import {loadTerrain} from './terrain.js';
import manifoldWasm from 'manifold-3d/manifold.wasm?url';
let enginePromise;
self.onmessage=async({data:{type,payload}})=>{
  try {
    let result;
    if(type==='terrain') result=await loadTerrain(payload,{rows:payload.samples||160,cols:payload.samples||160,progress:progress=>self.postMessage({progress})});
    else if(type==='map') {
      const {loadMapLayers}=await import('./map-pipeline.js');
      result=await loadMapLayers(payload.state,{...payload.options,progress:progress=>self.postMessage({progress})});
    } else if(type==='model-preview') {
      const {buildQuickModel}=await import('./quick-model.js');
      result=buildQuickModel(payload.state,payload.settings);
    } else if(type==='model') {
      self.postMessage({progress:{percent:2,detail:'Starting solid-modeling engine'}});
      const [{default:init},{buildModel}]=await Promise.all([import('manifold-3d'),import('./model.js')]);
      enginePromise??=init({locateFile:()=>manifoldWasm}).then(engine=>{engine.setup();return engine;});
      const engine=await enginePromise;
      result=await buildModel(engine,payload.state,payload.settings,progress=>self.postMessage({progress}));
    } else if(type==='model-export') {
      self.postMessage({progress:'Encoding model file…'});
      const {exportModel}=await import('./model-export.js');result=await exportModel(payload.model,payload.format);
    }
    else throw new Error('Unknown operation.');
    const transfers=[];
    if(type==='model-preview'||type==='model'){
      const {previewBuffers}=await import('./preview-buffers.js');
      result.display=previewBuffers(result.mesh);
      transfers.push(result.display.positions.buffer,result.display.colors.buffer);
      if(type==='model-preview')delete result.mesh;
    }
    if(type==='terrain')transfers.push(result.h.buffer);
    self.postMessage({result},transfers);
  } catch(error) { self.postMessage({error:error.message}); }
};
