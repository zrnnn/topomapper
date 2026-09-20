import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasPreview} from '../src/lib/preview2d.js';

test('Returning to the current canvas cancels an older pending render',async()=>{
  const originals={document:globalThis.document,Image:globalThis.Image,ResizeObserver:globalThis.ResizeObserver};
  const images=[],drawn=[];
  const canvas={setAttribute(){},getContext:()=>({drawImage:image=>drawn.push(image)})};
  globalThis.document={createElement:()=>canvas};
  globalThis.Image=class {constructor(){images.push(this);}};
  globalThis.ResizeObserver=class {observe(){}disconnect(){}};
  const container={clientWidth:300,clientHeight:200,replaceChildren(child){child.parentNode=this;}};
  const preview=createCanvasPreview(container);
  try{
    preview.set('<svg width="100" height="100">A</svg>');
    images[0].onload();await Promise.resolve();await Promise.resolve();
    assert.equal(canvas.width,600);assert.equal(canvas.height,400);
    preview.set('<svg width="100" height="100">B</svg>');
    preview.set('<svg width="100" height="100">A</svg>');
    images[1].onload();await Promise.resolve();await Promise.resolve();
    assert.equal(drawn.length,1,'Stale B must not overwrite restored A');
  }finally{preview.dispose();Object.assign(globalThis,originals);}
});
