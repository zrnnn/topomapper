import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapDrawing} from '../src/lib/dxf.js';
import {escapeXml} from '../src/lib/xml.js';

test('DXF preserves the last corner of both implicit and explicitly closed rings',()=>{
  const drawing = createMapDrawing(80);
  const points = [[4,8],[10,8],[10,20],[4,20]];
  drawing.writePolyline('WATER',points,'#225588',true);
  drawing.writePolyline('WATER',[...points,points[0]],'#225588',true);
  drawing.writeText('LABELS','München & <Ufer>\nNorth',6,10,3,'#333333');
  const text=drawing.serialize().replaceAll('\r','');
  const polygons=text.split('\nLWPOLYLINE\n').slice(1);
  assert.equal(polygons.length,2);
  for (const data of polygons) {
    assert.match(data,/AcDbPolyline\n90\n4\n70\n1\n/);
    assert.match(data,/10\n4\n20\n60\n/);
  }
  assert.match(text,/AC1021/);
  assert.match(text,/München & <Ufer> North/);
});

test('XML keeps accented names and supplementary characters while filtering invalid controls',()=>{
  assert.equal(escapeXml('München\u0001 & <🌍>'),'München &amp; &lt;🌍&gt;');
});
