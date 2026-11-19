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
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  const errors = [];
  const downloads = [];
  page.on('download', file => downloads.push(file.suggestedFilename()));
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
  let waterAvailable=false;
  const retryQueries=[];
  await context.route('**/*', async route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin === new URL(url).origin) return route.continue();
    if (request.method()==='POST') {
      const query=new URLSearchParams(request.postData()).get('data');
      if(waterAvailable)retryQueries.push(query);
      if(!waterAvailable && query.includes('coastline')){
        if(target.hostname==='overpass-api.de')return route.fulfill({status:502,body:''});
        if(target.hostname==='maps.mail.ru')return route.fulfill({status:504,body:''});
        return route.fulfill({json:{remark:'runtime error: Query timed out',elements:[]}});
      }
      return route.fulfill({json:{elements}});
    }
    if (target.pathname.endsWith('.png')) return route.fulfill({contentType:'image/png',body:Buffer.from(tile,'base64')});
    return route.abort();
  });
  await page.goto(url,{waitUntil:'networkidle'});
  const click = selector => page.locator(selector).click();
  const ready = () => page.waitForFunction(()=>document.querySelector('#modal').classList.contains('open') && !document.querySelector('#btnGen').disabled);
  const step = target => click(`#modal [data-workspace-step="${target}"]`);
  await click('#advancedControls > summary');
  await page.selectOption('#overpassProvider','NextGIS');
  await page.fill('#overpassKey','test-only');
  await page.selectOption('#overpassProvider','Geofabrik');
  assert.equal(await page.inputValue('#overpassKey'),'');
  await page.selectOption('#overpassProvider','');
  assert.equal(await page.locator('#overpassKey').count(),0);
  await click('#advancedControls > summary');
  await click('#btnGen');
  for (const box of await page.locator('#purposeDialog input[type=checkbox]:enabled').all()) await box.check();
  await click('#btnGen');
  await ready();
  const source=page.locator('#terrainSource');
  assert.match(await source.textContent(),/water areas:.*timed out.*504/);
  assert.ok(await page.locator('#retryMapLayers').isVisible());
  async function preparePrintable(){
    await page.waitForFunction(()=>document.querySelector('#modelTitle').textContent.includes('Quick preview ready'));
  const zoom=page.locator('#previewZoomValue');
  await click('#previewZoomIn');
  assert.equal(await zoom.textContent(),'120%');
  await page.locator('#preview3d canvas').hover();
  await page.mouse.wheel(0,100);
  await page.waitForFunction(()=>parseInt(document.querySelector('#previewZoomValue').textContent)<120);
  await click('#previewZoomFit');
  assert.equal(await zoom.textContent(),'100%');

    await page.locator('#prepareModel').evaluate(button=>button.click());
    await page.waitForFunction(()=>!document.querySelector('#exportModel').disabled || !document.querySelector('#modelError').hidden,null,{timeout:90000});
  }
  await step('3d');
  await page.waitForFunction(()=>document.querySelector('#modelTitle').textContent.includes('Quick preview ready'));
  await step('export');
  const warning=page.locator('#exportCoverageWarning');
  assert.match(await warning.innerText(),/Incomplete map coverage for water areas\./);
  const partial=await JSZip.loadAsync(await download('#prepareExportModel','partial.3mf'));
  const partialParts=await partial.file('Metadata/model_settings.config').async('string');
  for(const name of ['Terrain','Green areas','Rivers','Roads','Buildings'])assert.ok(partialParts.includes('value="'+name+'"'));
  assert.doesNotMatch(partialParts,/value="Water"/);
  assert.ok(await warning.isVisible());
  assert.ok(await page.locator('#modelError').isHidden());
  await step('2d');
  await step('export');
  assert.match(await warning.innerText(),/water areas/);
  const partialSvg=await download('#btnSVG','partial.svg');
  assert.match(partialSvg.toString(),/<svg/);
  await step('2d');
  waterAvailable=true;
  await click('#retryMapLayers');
  await ready();
  assert.equal(await page.locator('#retryMapLayers').isVisible(),false);
  assert.doesNotMatch(await source.textContent(),/unavailable|timed out|502|504/);
  assert.equal(retryQueries.length,1,'Retry should fetch only the failed water layer');
  assert.match(retryQueries[0],/coastline/);
  async function download(selector, name) {
    const pending = page.waitForEvent('download',{timeout:90000});
    await click(selector);
    await (await pending).saveAs(join(directory,name));
    const file = await readFile(join(directory,name));
    assert.ok(file.length>0,name);
    return file;
  }
  await step('export');
  assert.ok(await warning.isHidden(),'Retry should clear the incomplete coverage warning');
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
  const density=png.indexOf(Buffer.from('pHYs'));
  assert.ok(density>0);
  assert.ok(Math.abs(png.readUInt32BE(16)*1000/png.readUInt32BE(density+4)-200)<.05);
  assert.ok(Math.abs(png.readUInt32BE(20)*1000/png.readUInt32BE(density+8)-140)<.05);
  const fullSvg=(await download('#btnSVG','all-layers.svg')).toString();
  for(const group of ['waterAreas','greenAreas','roads','rivers','buildings'])assert.ok(fullSvg.includes('id="'+group+'"'),group);
  await step('2d');
  await page.locator('#waterAreaToggle').evaluate(b=>b.click());
  await step('export');
  assert.doesNotMatch((await download('#btnSVG','without-water.svg')).toString(),/id="waterAreas"/);
  const dry=await download('#btnPNG','without-water.png');
  const changed=await page.evaluate(async files=>{
    const pixels=await Promise.all(files.map(async base64=>{
      const image=await createImageBitmap(await (await fetch('data:image/png;base64,'+base64)).blob());
      const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');
      ctx.drawImage(image,0,0);image.close();return ctx.getImageData(0,0,canvas.width,canvas.height).data;
    }));
    let n=0;
    for(let i=0;i<pixels[0].length;i+=4)if([0,1,2].some(c=>pixels[0][i+c]!==pixels[1][i+c]))n++;
    return n;
  },[png,dry].map(file=>file.toString('base64')));
  assert.ok(changed>10,'Water visibility must change pixels in the downloaded PNG');
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
  await step('export');
  assert.ok(await page.locator('#prepareExportModel').isVisible());
  assert.equal(await page.locator('#exportStatusLabel').textContent(),'Ready to prepare');
  const previousDownloads=downloads.length;
  await page.locator('#prepareExportModel').evaluate(button=>{
    button.click();
    const cancel=document.querySelector('#cancelExportPreparation');
    if(cancel.hidden)throw new Error('Cancel action missing during preparation');
    cancel.click();
  });
  await page.waitForFunction(()=>document.querySelector('#modelTitle').textContent==='Cancelled');
  assert.equal(downloads.length,previousDownloads);
  assert.ok(await page.locator('#prepareExportModel').isEnabled());
  for (const format of ['3mf','stl','obj']) {
    await page.selectOption('#model-format',format);
    const action=format==='3mf'?'#prepareExportModel':'#exportModel';
    assert.equal(await page.locator(action).textContent(),(format==='3mf'?'Prepare & download ':'Download ')+format.toUpperCase());
    const file = await download(action,'map.'+format);
    if (format==='stl') assert.equal(file.length,84+50*file.readUInt32LE(80));
    if (format==='obj') assert.match(file.toString(),/^f \d+ \d+ \d+$/m);
    if (format==='3mf') {
      const second=await download('#modelFileLink','download-again.3mf');
      assert.ok(file.equals(second),'The download link should reuse the generated file');
      const zip = await JSZip.loadAsync(file);
      const names = await zip.file('Metadata/model_settings.config').async('string');
      for (const name of ['Terrain','Green areas','Water','Rivers','Roads','Buildings']) assert.ok(names.includes(`value="${name}"`));
    }
  }
  assert.equal(downloads.length-previousDownloads,4);
  await click('#closePreview');
  await page.setViewportSize({width:390,height:844});
  await click('#btnGen');
  await click('#choose3d');
  for(const box of await page.locator('#purposeDialog input[type=checkbox]').all()){
    if(await box.isEnabled())await box.uncheck();
  }
  assert.ok(await page.locator('#btnGen').isDisabled());
  assert.match(await page.locator('#areaPolicyWarning').textContent(),/Select at least one layer/);
  await page.locator('#load-terrain').check();
  const queryCount=retryQueries.length;
  await click('#btnGen');
  await ready();
  assert.match(await source.textContent(),/No map layers requested/);
  await preparePrintable();
  assert.equal(await page.locator('#exportModel').isDisabled(),false,await page.locator('#modelErrorTechnical').textContent());
  await step('export');
  await page.selectOption('#model-format','3mf');
  assert.ok(await page.locator('#exportModel').isVisible());
  assert.equal(await page.locator('#exportStatusLabel').textContent(),'Ready to download');
  assert.ok(await page.locator('.model-download').evaluate(card=>card.getBoundingClientRect().right<=innerWidth));
  const single=await JSZip.loadAsync(await download('#exportModel','terrain-only.3mf'));
  const parts=await single.file('Metadata/model_settings.config').async('string');
  assert.match(parts,/value="Terrain"/);
  assert.doesNotMatch(parts,/value="(?:Water|Rivers|Green areas|Roads|Buildings)"/);
  assert.equal(retryQueries.length,queryCount);
  // A fresh page has no successful query cache. Hold the roads request until
  // the user elects to export only the terrain already on screen.
  const slowContext=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  slowContext.setDefaultTimeout(30000);
  const slow=await slowContext.newPage();
  slow.on('pageerror',error=>errors.push(error.message));
  await slow.addInitScript(()=>{
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(type.startsWith('webgl') && this.dataset.engine?.startsWith('three.js'))return null;
      return getContext.call(this,type,...args);
    };
  });
  let stoppedByUser=false;
  let roadRequest;
  const pendingRoad=new Promise(resolve=>{roadRequest=resolve;});
  let releaseRoad;
  const hold=new Promise(resolve=>{releaseRoad=resolve;});
  await slowContext.route('**/*',async route=>{
    const req=route.request(),target=new URL(req.url());
    if(target.origin===new URL(url).origin)return route.continue();
    if(req.method()==='POST'){
      if(stoppedByUser)return route.fulfill({status:429,body:'rate limit exceeded'});
      roadRequest();await hold;return route.abort().catch(()=>{});
    }
    if(target.pathname.endsWith('.png'))return route.fulfill({contentType:'image/png',body:Buffer.from(tile,'base64')});
    return route.abort();
  });
  try{
    await slow.goto(url,{waitUntil:'networkidle'});
    await slow.locator('#btnGen').click();
    await slow.locator('#choose3d').click();
    for(const box of await slow.locator('#purposeDialog input[type=checkbox]').all())if(await box.isEnabled())await box.uncheck();
    await slow.locator('#load-terrain').check();
    await slow.locator('#load-roads').check();
    await slow.locator('#btnGen').click();
    await slow.locator('#cancelPreviewLoad').waitFor({state:'visible'});
    await Promise.race([pendingRoad,slow.waitForTimeout(10000).then(()=>{throw Error('Road request never started');})]);
    await slow.locator('#cancelPreviewLoad').click();
    await slow.locator('#prepareExportModel').waitFor({state:'visible'});
    assert.match(await slow.locator('#exportCoverageWarning').innerText(),/coverage for roads\./);
    assert.ok(await slow.locator('#retryMapLayers').isVisible());
    const stopFile=slow.waitForEvent('download',{timeout:90000});
    await slow.locator('#prepareExportModel').click();
    const path=join(directory,'stopped.3mf');
    await (await stopFile).saveAs(path);
    const stopped=await JSZip.loadAsync(await readFile(path));
    const names=await stopped.file('Metadata/model_settings.config').async('string');
    assert.match(names,/value="Terrain"/);
    assert.doesNotMatch(names,/value="Roads"/);
    stoppedByUser=true;
    releaseRoad();
    await slow.locator('#retryMapLayers').click();
    await slow.waitForFunction(()=>!document.querySelector('#btnGen').disabled && !document.querySelector('#retryMapLayers').hidden);
    await slow.locator('#modal [data-workspace-step="export"]').click();
    assert.match(await slow.locator('#terrainSource').innerText(),/429|rate limit/i);
    assert.match(await slow.locator('#exportCoverageWarning').innerText(),/coverage for roads/);
    await slow.selectOption('#model-format','stl');
    const limitedFile=slow.waitForEvent('download',{timeout:90000});
    await slow.locator('#prepareExportModel').click();
    const stlPath=join(directory,'rate-limited.stl');
    await (await limitedFile).saveAs(stlPath);
    const mesh=await readFile(stlPath);
    assert.ok(mesh.readUInt32LE(80)>0);
    assert.equal(mesh.length,84+50*mesh.readUInt32LE(80));
    await slow.locator('#modal [data-workspace-step="3d"]').click();
    await slow.locator('#model-width').fill('1');
    await slow.locator('#model-width').press('Tab');
    await slow.locator('#modelError').waitFor({state:'visible'});
    await slow.locator('#modal [data-workspace-step="export"]').click();
    let invalidDownloads=0;
    slow.on('download',()=>invalidDownloads++);
    await slow.locator('#prepareExportModel').click();
    await slow.locator('#modelError').waitFor({state:'visible'});
    assert.match(await slow.locator('#modelErrorTechnical').textContent(),/Check width/);
    assert.ok(await slow.locator('#exportModel').isDisabled());
    assert.ok(await slow.locator('#modelFileLink').isHidden());
    assert.equal(invalidDownloads,0);
  }finally{releaseRoad();await slowContext.close();}
  // Hold a search and the first tile of a replacement map until the user
  // has moved on. The last successful drawing must still export at its own size.
  const recoveryContext=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true});
  const recovery=await recoveryContext.newPage();
  recovery.on('pageerror',error=>errors.push(error.message));
  let releaseSearch,releaseElevation,searchStarted,elevationStarted;
  const searchRequest=new Promise(resolve=>{searchStarted=resolve;});
  const elevationRequest=new Promise(resolve=>{elevationStarted=resolve;});
  const searchHold=new Promise(resolve=>{releaseSearch=resolve;});
  const elevationHold=new Promise(resolve=>{releaseElevation=resolve;});
  await recoveryContext.route('**/*',async route=>{
    const req=route.request(),target=new URL(req.url());
    if(target.origin===new URL(url).origin)return route.continue();
    if(target.hostname==='nominatim.openstreetmap.org'){
      searchStarted();
      await searchHold;
      return route.fulfill({json:[{lat:'47.55',lon:'10.75',display_name:'Old search'}]}).catch(()=>{});
    }
    if(target.pathname.includes('/terrarium/')){
      elevationStarted();
      await elevationHold;
      return route.abort().catch(()=>{});
    }
    if(req.method()==='POST')return route.fulfill({json:{elements}});
    if(target.pathname.endsWith('.png'))return route.fulfill({contentType:'image/png',body:Buffer.from(tile,'base64')});
    return route.abort();
  });
  try{
    await recovery.goto(url,{waitUntil:'networkidle'});
    const search=recovery.locator('#searchInp');
    await search.fill('Old search');
    await recovery.locator('#searchButton').click();
    await Promise.race([searchRequest,recovery.waitForTimeout(8000).then(()=>{throw Error('Search request never started');})]);
    await search.fill('New search');
    releaseSearch();
    assert.ok(await recovery.locator('#searchButton').isEnabled());
    assert.equal(await recovery.locator('#searchStatus').textContent(),'');
    await recovery.locator('#btnGen').click();
    await recovery.locator('#choose2d').click();
    for(const box of await recovery.locator('#purposeDialog input[type=checkbox]').all())if(await box.isEnabled())await box.uncheck();
    await recovery.locator('#load-water').check();
    await recovery.locator('#btnGen').click();
    await recovery.waitForFunction(()=>document.querySelector('#modal').classList.contains('open')&&!document.querySelector('#btnGen').disabled);
    assert.ok(await recovery.locator('#suggestionBox').isHidden());
    await recovery.locator('#closePreview').click();
    await recovery.locator('#advancedControls > summary').click();
    await recovery.locator('#dimW').fill('300');
    await recovery.locator('#dimW').press('Tab');
    await recovery.locator('#btnGen').click();
    await recovery.locator('#choose3d').click();
    await recovery.locator('#btnGen').click();
    await Promise.race([elevationRequest,recovery.waitForTimeout(8000).then(()=>{throw Error('Elevation request never started');})]);
    await recovery.locator('#cancelGeneration').click();
    releaseElevation();
    await recovery.locator('#previousPreview').click();
    assert.equal(await recovery.locator('#modal').getAttribute('data-mode'),'2d');
    await recovery.locator('#modal [data-workspace-step="export"]').click();
    const previousDownload=recovery.waitForEvent('download');
    await recovery.locator('#btnSVG').click();
    const previousPath=join(directory,'previous-after-cancel.svg');
    await (await previousDownload).saveAs(previousPath);
    const previousDrawing=await readFile(previousPath,'utf8');
    assert.match(previousDrawing,/width="200mm" height="140mm"/);
    assert.match(previousDrawing,/id="waterAreas"/);
  }finally{releaseSearch();releaseElevation();await recoveryContext.close();}
  assert.deepEqual(errors,[]);
  console.log('Verified SVG, DXF, PNG, 3MF, STL and OBJ downloads in',directory);
} finally {
  await browser.close();
}
