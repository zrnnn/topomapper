import {defaultModel,MODEL_PRESETS} from './model.js';
import {runWorker} from './worker-client.js';
import {describeError} from './operation-status.js';

export function initModelWorkflow(state,{save,runExportFlow,signal}) {
  const $=id=>document.getElementById(id);
  let settings=defaultModel(),model=null,job=null,preview=null,disposed=false,revision=0;
  const numeric=['width','resolution','base','relief','roadWidth','roadRise','areaRise','buildingScale','fallbackHeight','minBuildingArea'];
  const layers=['terrain','buildings','roads','water','green','rivers'];
  function sync(){for(const key of numeric){$('model-'+key).value=settings[key];const out=$('model-'+key+'-value');if(out)out.textContent=settings[key];const el=$('model-'+key);if(el.type==='range'){el.style.setProperty('--range-progress',((settings[key]-Number(el.min))/(Number(el.max)-Number(el.min))*100)+'%');el.setAttribute('aria-valuetext',String(settings[key]));}}for(const key of layers)$('model-'+key).checked=settings[key];document.querySelectorAll('[data-model-preset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.modelPreset===settings.preset)));}
  function setState(kind,title,detail,percent=null){$('modelFeedback').dataset.state=kind;$('modelTitle').textContent=title;$('modelStatus').textContent=detail;$('modelPercent').textContent=Number.isFinite(percent)?`${Math.round(percent)}%`:'';$('modelError').hidden=true;if(Number.isFinite(percent)){$('modelProgress').hidden=false;$('modelProgress').value=percent;}else $('modelProgress').hidden=true;}
  function invalidate(){revision++;job?.abort();job=null;model=null;$('exportModel').disabled=true;setState('idle','Model needs an update','Settings changed. Update the model to preview and export these settings.');$('cancelModel').hidden=true;$('retryModel').hidden=true;$('updateModel').disabled=false;}
  for(const key of [...numeric,...layers])$('model-'+key).addEventListener('change',()=>{settings[key]=layers.includes(key)?$('model-'+key).checked:Number($('model-'+key).value);settings.preset='custom';invalidate();sync();});
  for(const key of numeric)$('model-'+key).addEventListener('input',()=>{const out=$('model-'+key+'-value');if(out)out.textContent=$('model-'+key).value;invalidate();});
  document.querySelectorAll('[data-model-preset]').forEach(el=>el.onclick=()=>{settings={...settings,...MODEL_PRESETS[el.dataset.modelPreset],preset:el.dataset.modelPreset};invalidate();sync();});
  const status=(text,percent)=>setState('loading','Building printable model',text,percent);
  async function build() {
    invalidate();const generation=revision,controller=new AbortController();job=controller;
    $('updateModel').disabled=true;$('cancelModel').hidden=false;$('retryModel').hidden=true;status('Preparing the solid-modeling engine…',2);
    try {
      for(const key of numeric)settings[key]=Number($('model-'+key).value);
      if(!state.osmStatus.loaded&&layers.slice(1).some(key=>settings[key]))throw new Error('Map overlays are unavailable. Close this preview and reload the area, or disable buildings, streets, water, rivers and green areas.');
      const next=await runWorker('model',{state:{wMm:state.wMm,hMm:state.hMm,shape:state.shape,terrainData:state.terrainData,renderBbox:state.renderBbox,osmData:state.osmData},settings},{signal:controller.signal,progress:p=>status(p.detail,p.percent)});
      if(disposed||generation!==revision)return;
      if(!preview){const {createModelPreview}=await import('./preview3d.js');if(disposed||generation!==revision)return;preview=createModelPreview($('preview3d'));}
      preview.set(next);model=next;
      const missing=layers.slice(1).filter(key=>settings[key]&&!next.counts[key]);
      const omitted=next.buildingStats?.omitted||0, notices=[missing.length?'No mapped features for: '+missing.join(', '):'',omitted?`${omitted.toLocaleString()} small/dense buildings omitted at ${settings.minBuildingArea} mm² minimum`:'' ].filter(Boolean);
      setState(notices.length?'warning':'success',notices.length?'Model ready with notices':'Model ready',`${next.width.toFixed(1)} × ${next.height.toFixed(1)} mm · ${next.triangles.toLocaleString()} triangles · fused solid. ${Object.entries(next.counts).filter(([key])=>settings[key]).map(([key,n])=>`${n} ${key}`).join(' · ')}${notices.length?'. '+notices.join('. '):''}`);
      $('exportModel').disabled=false;
    } catch(error) {if(generation===revision){const report=describeError(error,'model');setState(report.kind==='cancelled'?'idle':'error',report.title,report.message);$('modelError').hidden=report.kind==='cancelled';$('modelErrorAction').textContent=report.action;$('modelErrorTechnical').textContent=report.technical;$('retryModel').hidden=report.kind==='cancelled';}}
    finally {if(generation===revision){job=null;$('updateModel').disabled=false;$('cancelModel').hidden=true;if($('modelFeedback').dataset.state!=='loading')$('modelProgress').hidden=true;}}
  }
  $('updateModel').onclick=build;
  $('retryModel').onclick=build;
  $('cancelModel').onclick=()=>job?.abort();
  $('resetModelView').onclick=()=>preview?.reset();
  $('exportModel').onclick=async()=>{if(!model)return;const current=model,format=$('model-format').value;await runExportFlow(format.toUpperCase(),async onSave=>{const file=await runWorker('model-export',{model:current,format},{signal});await onSave();save(file.blob,file.name);});};
  sync();
  return {open:()=>{if(!model&&!job)void build();},invalidate,zoom:direction=>preview?.zoom(direction),resetView:()=>preview?.reset(),dispose(){disposed=true;job?.abort();preview?.dispose();}};
}
