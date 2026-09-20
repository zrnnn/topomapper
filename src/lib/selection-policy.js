import {areaPlan} from './area-plan.js';

export function selectionPolicy(bounds,mode='2d') {
  const {km2}=areaPlan(bounds);
  const buildingLimit=mode==='3d'?25:80;
  return {
    km2,
    buildingLimit,
    buildingsRecommended:km2<=buildingLimit,
    minorRoadLimit:40,
    minorRoadsRecommended:km2<=40,
    overviewRecommended:km2>25,
    maxMapPoints:km2>25?60000:120000,
    terrainSamples:km2<1?256:km2>25?128:160
  };
}
