const scales={motorway:1.8,trunk:1.6,primary:1.45,secondary:1.25,tertiary:1.08,residential:.82,unclassified:.72,service:.55};
export const roadClassScale=roadClass=>scales[roadClass]||.7;
export const isMinorRoad=roadClass=>['residential','unclassified','service'].includes(roadClass);
export const roadPoints=road=>Array.isArray(road)?road:road.points;
export const roadRecord=(points,roadClass='unclassified')=>({points,roadClass,scale:roadClassScale(roadClass)});
