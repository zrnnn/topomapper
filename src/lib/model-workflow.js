import {defaultModel,MODEL_PRESETS} from './model.js';
import {runWorker} from './worker-client.js';
import {describeError} from './operation-status.js';

export function initModelWorkflow(state,{save,runExportFlow,signal,onStatus=()=>{}}) {
  const $=id=>document.getElementById(id);
  let settings=defaultModel(),model=null,job=null,preview=null,disposed=false,revision=0,previewTimer=null,previewRevision=-1,prepared=null;
  let buildingsAvailable=true,availableLayers=null;
  const numeric=['width','resolution','base','relief','roadWidth','roadRise','areaRise','buildingScale','fallbackHeight','minBuildingArea'];
  const layers=['terrain','buildings','roads','water','green','rivers'];
  const displayValue=(key,value)=>key==='relief'?`${value}%`:String(value);
  function sync(){for(const key of layers){const available=availableLayers?.[key]!==false;if(!available)settings[key]=false;$('model-'+key).disabled=!available;$('model-'+key).title=available?'':'Not requested. Use Layers in the toolbar to load this layer.';}for(const key of numeric){$('model-'+key).value=settings[key];const out=$('model-'+key+'-value');if(out)out.textContent=displayValue(key,settings[key]);const el=$('model-'+key);if(el.type==='range'){el.style.setProperty('--range-progress',((settings[key]-Number(el.min))/(Number(el.max)-Number(el.min))*100)+'%');el.setAttribute('aria-valuetext',displayValue(key,settings[key]));}}for(const key of layers)$('model-'+key).checked=settings[key];document.querySelectorAll('[data-model-preset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.modelPreset===settings.preset)));}
  function setState(kind,title,detail,percent=null){onStatus({state:kind,title,detail,percent});$('modelFeedback').dataset.state=kind;$('modelTitle').textContent=title;$('modelStatus').textContent=detail;$('modelPercent').textContent=Number.isFinite(percent)?`${Math.round(percent)}%`:'';$('modelError').hidden=true;if(Number.isFinite(percent)){$('modelProgress').hidden=false;$('modelProgress').value=percent;}else $('modelProgress').hidden=true;}
  function invalidate(){clearTimeout(previewTimer);revision++;job?.abort();job=null;model=null;$('exportModel').disabled=true;setState('idle','Preview needs an update','Settings changed. Refresh the preview, then prepare the printable model for export.');$('cancelModel').hidden=true;$('retryModel').hidden=true;$('updateModel').disabled=false;$('prepareModel').disabled=false;}
  for(const key of [...numeric,...layers])$('model-'+key).addEventListener('change',()=>{settings[key]=layers.includes(key)?$('model-'+key).checked:Number($('model-'+key).value);settings.preset='custom';invalidate();sync();scheduleQuick();});
  for(const key of numeric)$('model-'+key).addEventListener('input',()=>{const out=$('model-'+key+'-value');if(out)out.textContent=displayValue(key,$('model-'+key).value);invalidate();});
  document.querySelectorAll('[data-model-preset]').forEach(el=>el.onclick=()=>{settings={...settings,...MODEL_PRESETS[el.dataset.modelPreset],preset:el.dataset.modelPreset};if(!buildingsAvailable)settings.buildings=false;invalidate();sync();scheduleQuick();});
  const scheduleQuick=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>{if(!disposed)void build(true);},350);};
  const status=(text,percent,quick)=>setState('loading',quick?'Updating quick preview':'Preparing printable model',text,percent);
  async function build(quick=false,deadline=Date.now()+180000) {
    invalidate();const generation=revision,controller=new AbortController();job=controller;
    $('updateModel').disabled=true;$('prepareModel').disabled=true;$('cancelModel').hidden=false;$('retryModel').hidden=true;status(quick?'Drawing terrain and selected layers…':'Preparing the solid-modeling engine…',2,quick);
    try {
      for(const key of numeric)settings[key]=Number($('model-'+key).value);
      if(!quick&&!state.osmStatus.loaded&&layers.slice(1).some(key=>settings[key]))throw new Error('Map overlays are unavailable. Use Retry map layers, or choose Terrain study to build a terrain-only model.');
      if(!quick&&state.osmStatus.completed){
        const stages={buildings:'buildings',roads:'roads',water:'areas',green:'areas',rivers:'rivers'};
        const missing=Object.keys(stages).filter(key=>settings[key]&&!state.osmStatus.completed.includes(stages[key]));
        if(missing.length)throw new Error('Map overlays are unavailable for '+missing.join(', ')+'. Retry those layers or disable them before preparing the printable model.');
      }
      const cacheKey=JSON.stringify([state.terrainVersion,state.osmDataVersion,settings]);
      const next=!quick&&prepared?.key===cacheKey?prepared.model:await runWorker(quick?'model-preview':'model',{state:{wMm:state.wMm,hMm:state.hMm,shape:state.shape,terrainData:state.terrainData,renderBbox:state.renderBbox,osmData:state.osmData},settings},{signal:controller.signal,timeoutMs:Math.max(1,deadline-Date.now()),progress:p=>status(p.detail,p.percent,quick)});
      if(disposed||generation!==revision)return;
      if(!preview){const {createModelPreview}=await import('./preview3d.js');if(disposed||generation!==revision)return;preview=createModelPreview($('preview3d'));}
      preview.set(next);previewRevision=revision;
      if(!quick){model=next;prepared={key:cacheKey,model:next};}
      const missing=layers.slice(1).filter(key=>settings[key]&&!next.counts[key]);
      const omitted=next.buildingStats?.omitted||0, notices=[missing.length?'No mapped features for: '+missing.join(', '):'',omitted?`${omitted.toLocaleString()} small/dense buildings omitted at ${settings.minBuildingArea} mm² minimum`:'' ].filter(Boolean);
      setState(notices.length?'warning':'success',quick?'Quick preview ready':notices.length?'Model ready with notices':'Printable model ready',`${next.width.toFixed(1)} × ${next.height.toFixed(1)} mm · ${settings.relief}% relief (${next.reliefHeight.toFixed(2)} mm elevation range) · ${next.triangles.toLocaleString()} triangles · ${quick?'display surfaces (not fused); prepare printable model to export':'validated fused solid'}. ${Object.entries(next.counts).filter(([key])=>settings[key]).map(([key,n])=>`${n} ${key}`).join(' · ')}${notices.length?'. '+notices.join('. '):''}`);
      $('exportModel').disabled=quick;
    } catch(error) {if(generation===revision){const report=describeError(error,'model');setState(report.kind==='cancelled'?'idle':'error',report.title,report.message);$('modelError').hidden=report.kind==='cancelled';$('modelErrorAction').textContent=report.action;$('modelErrorTechnical').textContent=report.technical;$('retryModel').hidden=report.kind==='cancelled';$('retryModel').onclick=()=>build(quick);}}
    finally {if(generation===revision){job=null;$('updateModel').disabled=false;$('prepareModel').disabled=false;$('cancelModel').hidden=true;if($('modelFeedback').dataset.state!=='loading')$('modelProgress').hidden=true;}}
  }
  $('updateModel').onclick=()=>build(true);
  $('prepareModel').onclick=()=>build(false);
  $('retryModel').onclick=()=>build(true);
  $('cancelModel').onclick=()=>job?.abort();
  $('exportModel').onclick=async()=>{if(!model)return;const {display,...current}=model,format=$('model-format').value;await runExportFlow(format.toUpperCase(),async onSave=>{const file=await runWorker('model-export',{model:current,format},{signal});await onSave();save(file.blob,file.name);});};
  sync();
  return {configureArea:({overview,samples,minArea,buildingsAvailable:available=true,loadLayers=null})=>{buildingsAvailable=available;availableLayers=loadLayers;settings=overview?{...settings,...MODEL_PRESETS.overview,preset:'overview'}:{...settings,...(settings.preset==='overview'?MODEL_PRESETS.landscape:{}),preset:'custom',resolution:samples>=240?160:100,minBuildingArea:minArea};if(availableLayers){for(const key of layers)settings[key]=availableLayers[key]!==false;settings.preset='custom';}if(!buildingsAvailable)settings.buildings=false;$('model-buildings').disabled=!buildingsAvailable;$('model-buildings').title=buildingsAvailable?'Raised buildings':'Not requested. Use Layers in the toolbar to load buildings.';invalidate();sync();},open:(deadline)=>{if(previewRevision!==revision&&!job)void build(true,deadline);},invalidate,zoom:direction=>preview?.zoom(direction),resetView:()=>preview?.reset(),dispose(){clearTimeout(previewTimer);disposed=true;job?.abort();preview?.dispose();}};
}
