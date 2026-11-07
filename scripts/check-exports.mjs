// Run against the production site. Only third-party map responses use fixtures.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import JSZip from 'jszip';

const url = process.env.TOPOMAPPER_URL || 'http://127.0.0.1:4173/topomapper/';
const directory = process.env.EXPORT_DIR || await mkdtemp(join(tmpdir(), 'topomapper-exports-'));
await mkdir(directory, {recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROME_BIN,
  args:['--enable-unsafe-swiftshader']});
try {
  const context = await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const tile = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0,0,256,256);
    gradient.addColorStop(0,'rgb(128,0,0)');
    gradient.addColorStop(1,'rgb(128,150,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0,0,256,256);
    return canvas.toDataURL().split(',')[1];
  });
  const geometry = points => points.map(([x,y])=>({lon:10.7498+x*.001,lat:47.5576+y*.001}));
  const rectangle = (x,y,w,h) => geometry([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]);
  const elements = [
    {type:'relation',id:1,tags:{natural:'water',type:'multipolygon'},members:[
      {type:'way',ref:20,role:'outer',geometry:rectangle(-1,-1,2,2)},
      {type:'way',ref:21,role:'inner',geometry:rectangle(-.7,-.7,.4,.5)}]},
    {type:'way',id:2,tags:{landuse:'forest'},geometry:rectangle(-2,-1,1.4,2)},
    {type:'way',id:3,tags:{highway:'primary'},geometry:geometry([[-3,0],[3,0]])},
    {type:'way',id:4,tags:{building:'yes',height:'18'},geometry:rectangle(1,.5,.6,.5)},
    {type:'way',id:5,tags:{waterway:'river'},geometry:geometry([[0,0],[2,2]])},
    {type:'node',id:6,lat:47.5576,lon:10.7498,tags:{place:'town',name:'München & <Ufer>'}}
  ];
  await context.route('**/*', async route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin === new URL(url).origin) return route.continue();
    if (request.method()==='POST') return route.fulfill({json:{elements}});
    if (target.pathname.endsWith('.png')) return route.fulfill({contentType:'image/png',body:Buffer.from(tile,'base64')});
    return route.abort();
  });
  await page.goto(url,{waitUntil:'networkidle'});
  const click = selector => page.locator(selector).click();
  const ready = () => page.waitForFunction(()=>document.querySelector('#modal').classList.contains('open') && !document.querySelector('#btnGen').disabled);
  const step = target => click(`#modal [data-workspace-step="${target}"]`);
  await click('#btnGen');
  for (const box of await page.locator('#purposeDialog input[type=checkbox]:enabled').all()) await box.check();
  await click('#btnGen');
  await ready();
  async function download(selector, name) {
    const pending = page.waitForEvent('download');
    await click(selector);
    await (await pending).saveAs(join(directory,name));
    const file = await readFile(join(directory,name));
    assert.ok(file.length>0,name);
    return file;
  }
  await step('export');
  const original = await download('#btnDXF','map.dxf');
  await step('2d');
  await page.locator('#refreshPreview').evaluate(button=>button.click());
  await page.locator('#contourDensity').evaluate(slider=>{
    slider.value='10';
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await step('export');
  const edited = await download('#btnDXF','edited.dxf');
  const lines = file => file.toString().split('\nLWPOLYLINE\n').length-1;
  assert.ok(lines(edited)>0 && lines(edited)<lines(original),'Export must read the edited contour density');
  const png = await download('#btnPNG','map.png');
  assert.equal(png.readUInt32BE(0),0x89504e47);
  for (const preset of ['contours','buildings','shaded']) {
    await step('2d');
    await page.locator(`[data-preset="${preset}"]`).evaluate(button=>button.click());
    await step('export');
    const svg = await download('#btnSVG',preset+'.svg');
    const image = await page.evaluate(text => {
      const doc = new DOMParser().parseFromString(text,'image/svg+xml');
      return {errors:doc.getElementsByTagName('parsererror').length,width:doc.documentElement.getAttribute('width'),
        paths:doc.querySelectorAll('path').length,shading:doc.querySelector('image')?.getAttributeNS('http://www.w3.org/1999/xlink','href')?.startsWith('data:image/png')};
    },svg.toString());
    assert.equal(image.errors,0); assert.equal(image.width,'200mm'); assert.ok(image.paths>1);
    if (preset==='shaded') assert.equal(image.shading,true);
  }
  await step('3d');
  await page.waitForFunction(()=>document.querySelector('#modelTitle').textContent.includes('Quick preview ready'));
  await page.locator('#prepareModel').evaluate(button=>button.click());
  await page.waitForFunction(()=>!document.querySelector('#exportModel').disabled,null,{timeout:90000});
  await step('export');
  for (const format of ['3mf','stl','obj']) {
    await page.selectOption('#model-format',format);
    const file = await download('#exportModel','map.'+format);
    if (format==='stl') assert.equal(file.length,84+50*file.readUInt32LE(80));
    if (format==='obj') assert.match(file.toString(),/^f \d+ \d+ \d+$/m);
    if (format==='3mf') {
      const zip = await JSZip.loadAsync(file);
      const names = await zip.file('Metadata/model_settings.config').async('string');
      for (const name of ['Terrain','Green areas','Water','Rivers','Roads','Buildings']) assert.ok(names.includes(`value="${name}"`));
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Verified SVG, DXF, PNG, 3MF, STL and OBJ downloads in',directory);
} finally {
  await browser.close();
}
