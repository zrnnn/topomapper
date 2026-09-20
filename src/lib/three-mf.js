import JSZip from 'jszip';
import {escapeXml} from './xml.js';

export async function create3mf(objects) {
  const palette=[...new Set(objects.flatMap(o=>o.mesh.colors||[]))],materialId=objects.length+2;
  const materials=palette.length?`<basematerials id="${materialId}">${palette.map((color,i)=>`<base name="Layer ${i+1}" displaycolor="${color}FF"/>`).join('')}</basematerials>`:'';
  const resources=objects.map(({name,mesh},i)=>{
    const vertices=mesh.v.map(v=>`<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('');
    const triangles=mesh.t.map((t,i)=>`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${mesh.colors?.[i]?` pid="${materialId}" p1="${palette.indexOf(mesh.colors[i])}"`:''}/>`).join('');
    return `<object id="${i+1}" name="${escapeXml(name)}" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
  }).join('');
  const assembly=objects.length+1;
  const components=objects.map((_,i)=>`<component objectid="${i+1}"/>`).join('');
  const zip=new JSZip();
  zip.file('3D/3dmodel.model',`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Topomapper terrain and buildings</metadata><metadata name="Description">Topomapper model. Building roofs are flat; missing heights are estimated.</metadata><metadata name="Copyright">Terrain: Mapzen data sources. Buildings: OpenStreetMap contributors, https://www.openstreetmap.org/copyright</metadata><resources>${materials}${resources}<object id="${assembly}" name="Topomapper assembly" type="model"><components>${components}</components></object></resources><build><item objectid="${assembly}"/></build></model>`);
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="3D/3dmodel.model"/></Relationships>');
  return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
