import JSZip from 'jszip';
import {escapeXml} from './xml.js';

export async function create3mf(parts, credits = '') {
  if (!parts?.length) throw new Error('Prepare the printable map parts before exporting.');
  const assembly=parts.length+1,materialId=assembly+1,colorId=materialId+1;
  const colors=parts.map(({color='#D4D6C8'})=>color.toUpperCase());
  const palette=[...new Set(colors)];
  const colorIndexes=colors.map(color=>palette.indexOf(color));
  const colorResource=palette.map(color=>`<m:color color="${color}FF"/>`).join('');
  const materials = parts.map(({name, color = '#D4D6C8'}) =>
    `<base name="${escapeXml(name)}" displaycolor="${color}FF"/>`).join('');
  const objects = parts.map(({name, mesh}, index) => {
    const vertices = mesh.v.map(([x,y,z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('');
    // Keep the core object material and also bind an explicit surface color
    // to every face for importers that resolve colors from triangles.
    const triangles=mesh.t.map(([a,b,c])=>
      `<triangle v1="${a}" v2="${b}" v3="${c}" pid="${colorId}" p1="${colorIndexes[index]}"/>`).join('');
    return `<object id="${index+1}" name="${escapeXml(name)}" type="model" pid="${materialId}" pindex="${index}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
  }).join('');
  const components = parts.map((_, index) => `<component objectid="${index+1}"/>`).join('');
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
<metadata name="Title">Topomapper</metadata><metadata name="Copyright">${escapeXml(credits)}</metadata>
<resources><basematerials id="${materialId}">${materials}</basematerials><m:colorgroup id="${colorId}">${colorResource}</m:colorgroup>${objects}<object id="${assembly}" name="Topomapper" type="model"><components>${components}</components></object></resources>
<build><item objectid="${assembly}"/></build></model>`);
  // Keep named parts and match their filament slots to the exported palette.
  const partNames = parts.map(({name}, index) =>
    `<part id="${index+1}" subtype="normal_part"><metadata key="name" value="${escapeXml(name)}"/><metadata key="extruder" value="${colorIndexes[index]+1}"/></part>`).join('');
  zip.file('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?><config><object id="${assembly}"><metadata key="name" value="Topomapper"/>${partNames}</object></config>`);
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="config" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>');
  return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
