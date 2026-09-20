import {loadTerrain} from './terrain.js';
import manifoldWasm from 'manifold-3d/manifold.wasm?url';
self.onmessage=async({data:{type,payload}})=>{
  try {
    let result;
    if(type==='terrain') result=await loadTerrain(payload,{progress:progress=>self.postMessage({progress})});
    else if(type==='model') {
      self.postMessage({progress:{percent:2,detail:'Starting solid-modeling engine'}});
      const [{default:init},{buildModel}]=await Promise.all([import('manifold-3d'),import('./model.js')]);
      const engine=await init({locateFile:()=>manifoldWasm});engine.setup();
      result=await buildModel(engine,payload.state,payload.settings,progress=>self.postMessage({progress}));
    } else if(type==='model-export') {
      self.postMessage({progress:'Encoding model file…'});
      const {exportModel}=await import('./model-export.js');result=await exportModel(payload.model,payload.format);
    }
    else throw new Error('Unknown operation.');
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error.message}); }
};
