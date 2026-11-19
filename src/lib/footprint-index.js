import {ringBounds} from './geometry.js';

export function footprintBounds(record) {
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const [ring] of record.polygons){
    const box=ringBounds(ring);
    bounds.minX=Math.min(bounds.minX,box.minX);bounds.maxX=Math.max(bounds.maxX,box.maxX);
    bounds.minY=Math.min(bounds.minY,box.minY);bounds.maxY=Math.max(bounds.maxY,box.maxY);
  }
  return bounds;
}

// Both inputs use the same projected map coordinates. Index only occupied
// cells so matching a city block does not compare every pair of polygons.
export function footprintIndex(records,width,height) {
  const buckets=new Map();
  const cell=(value,span)=>Math.max(0,Math.min(15,Math.floor(16*value/span)));
  function visit(box,fn){
    for(let y=cell(box.minY,height);y<=cell(box.maxY,height);y++)
      for(let x=cell(box.minX,width);x<=cell(box.maxX,width);x++)fn(16*y+x);
  }
  for(const record of records){
    const box=footprintBounds(record),item={record,box};
    visit(box,key=>{
      if(!buckets.has(key))buckets.set(key,[]);
      buckets.get(key).push(item);
    });
  }
  return box=>{
    const hits=new Set();
    visit(box,key=>{
      for(const item of buckets.get(key)||[]){
        const b=item.box;
        if(b.minX<box.maxX && b.maxX>box.minX && b.minY<box.maxY && b.maxY>box.minY)hits.add(item.record);
      }
    });
    return hits;
  };
}
