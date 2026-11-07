import JSZip from 'jszip';
import {escapeXml} from './xml.js';

export async function create3mf(parts, credits = '') {
  if (!parts?.length) throw new Error('Prepare the printable map parts before exporting.');
  const assembly = parts.length + 1, materialId = assembly + 1;
  const materials = parts.map(({name, color = '#D4D6C8'}) =>
    `<base name="${escapeXml(name)}" displaycolor="${color}FF"/>`).join('');
  const objects = parts.map(({name, mesh}, index) => {
    const vertices = mesh.v.map(([x,y,z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('');
    const triangles = mesh.t.map(([a,b,c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');
    return `<object id="${index+1}" name="${escapeXml(name)}" type="model" pid="${materialId}" pindex="${index}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
  }).join('');
  const components = parts.map((_, index) => `<component objectid="${index+1}"/>`).join('');
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">Topomapper</metadata><metadata name="Copyright">${escapeXml(credits)}</metadata>
<resources><basematerials id="${materialId}">${materials}</basematerials>${objects}<object id="${assembly}" name="Topomapper" type="model"><components>${components}</components></object></resources>
<build><item objectid="${assembly}"/></build></model>`);
  // Bambu Studio reads core geometry and materials, but names volumes from this table.
  const partNames = parts.map(({name}, index) =>
    `<part id="${index+1}" subtype="normal_part"><metadata key="name" value="${escapeXml(name)}"/></part>`).join('');
  zip.file('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?><config><object id="${assembly}"><metadata key="name" value="Topomapper"/>${partNames}</object></config>`);
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="config" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="3D/3dmodel.model"/></Relationships>');
  return zip.generateAsync({type:'blob',compression:'DEFLATE'});
}
