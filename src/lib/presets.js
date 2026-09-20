export const DESIGN_PRESETS = {
  topographic: {
    name:'Alpine Atlas', kind:'Topographic', description:'Fine contours, quiet buildings and soft water. A balanced map for print.',
    background:'#F7F5EF', line:'#465852', density:30, width:0.12, contours:true,
    buildings:'#ABB8AD', outline:'#65796C', roads:'#83938D', water:'#B4D1D3', rivers:'#6E9EA5', green:'#DEE6D8', labels:'#30483F',
    buildingsEnabled:true, greenEnabled:true, layered:false
  },
  buildings: {
    name:'Urban Figureground', kind:'Building map', description:'Solid footprints and open courtyards. Buildings take centre stage; contours are off.',
    background:'#FAF8F2', line:'#B4BCB5', density:20, width:0.10, contours:false,
    buildings:'#263E38', outline:'#263E38', roads:'#B4BCB5', water:'#BAD3D5', rivers:'#89AFB5', green:'#E4EADF', labels:'#263E38',
    buildingsEnabled:true, greenEnabled:true, layered:false
  },
  blueprint: {
    name:'Midnight Blueprint', kind:'Building map', description:'Pale architectural outlines on deep teal, with subtle street context.',
    background:'#112B32', line:'#708F93', density:20, width:0.10, contours:false,
    buildings:'#24464D', outline:'#D3E4DC', roads:'#65868B', water:'#173B46', rivers:'#83B7C1', green:'#1C3A36', labels:'#E8ECE4',
    buildingsEnabled:true, greenEnabled:false, layered:false
  },
  contours: {
    name:'Contour Study', kind:'Minimal', description:'Clean ink contours on paper. No bold bands, building fills or road clutter.',
    background:'#FFFFFF', line:'#26332D', density:30, width:0.12, contours:true,
    buildings:'#D0D4CE', outline:'#8E9990', roads:'#9BA79D', water:'#E0EBEB', rivers:'#A9C4C5', green:'#EDF0E8', labels:'#26332D',
    buildingsEnabled:false, greenEnabled:false, roadsEnabled:false, waterEnabled:false, layered:false
  }
};

DESIGN_PRESETS.shaded={...DESIGN_PRESETS.topographic,name:'Shaded Landscape',kind:'Raster poster',description:'Elevation color and shaded relief beneath fine map layers. Export as PNG for paper or a raster workflow.',contours:false,layered:true};
DESIGN_PRESETS.laser={...DESIGN_PRESETS.contours,name:'Laser Linework',kind:'DXF / SVG',description:'Fine monochrome contours and building outlines. Vector geometry in millimetres; set laser power and cut/engrave operations in your laser software.',buildingsEnabled:true,outline:'#26332D'};

export function applyDesignPreset(state, key) {
  const p=DESIGN_PRESETS[key];
  if(!p) throw new Error('Unknown design preset.');
  Object.assign(state.theme,{preset:key,background:p.background,line:p.line});
  Object.assign(state.contour,{enabled:p.contours,density:p.density,width:p.width,color:p.line,smooth:2,opacity:100,emphasisEvery:0});
  Object.assign(state.mapFeatures.buildings,{enabled:p.buildingsEnabled,color:p.buildings,outline:p.outline,width:key==='blueprint'?0.14:0.1,opacity:100,filled:!['blueprint','laser'].includes(key)});
  Object.assign(state.mapFeatures.roads,{enabled:p.roadsEnabled??true,color:p.roads,width:0.14,opacity:100});
  Object.assign(state.mapFeatures.waterAreas,{enabled:p.waterEnabled??true,color:p.water,opacity:100});
  Object.assign(state.mapFeatures.rivers,{enabled:p.waterEnabled??true,color:p.rivers,width:0.12,opacity:100});
  Object.assign(state.mapFeatures.greenAreas,{enabled:p.greenEnabled,color:p.green,opacity:100});
  Object.assign(state.mapFeatures.labels,{enabled:false,color:p.labels,opacity:100,size:0.7,weight:'normal',style:'normal'});
  Object.assign(state.mapFeatures.labels.background,{enabled:true,color:p.background});
  Object.assign(state.png,{layered:p.layered,scheme:'color',blend:'normal',gradientOpacity:35,gradientShift:0,gradientScale:100});
  state.layerOrder=['labels','buildings','roads','rivers','contours','water','green'];
}
