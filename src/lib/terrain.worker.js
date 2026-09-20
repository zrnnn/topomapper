import {loadTerrain} from './terrain.js';
import {buildTerrainMesh} from './mesh.js';
self.onmessage=async({data:{type,payload}})=>{
  try {
    let result;
    if(type==='terrain') result=await loadTerrain(payload,{progress:progress=>self.postMessage({progress})});
    else if(type==='mesh') {
      self.postMessage({progress:'Building printable terrain…'});
      const mesh=buildTerrainMesh(payload.state,payload.options);
      const {default:JSZip}=await import('jszip');
      const vertices=mesh.v.map(v=>`<vertex x="${v[0].toFixed(3)}" y="${v[1].toFixed(3)}" z="${v[2].toFixed(3)}"/>`).join('');
      const triangles=mesh.t.map(t=>`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('');
      const zip=new JSZip();
      zip.file('3D/3dmodel.model',`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" name="Terrain" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`);
      zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
      zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="3D/3dmodel.model"/></Relationships>');
      self.postMessage({progress:'Packaging 3MF…'});
      result=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    } else throw new Error('Unknown operation.');
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error.message}); }
};
