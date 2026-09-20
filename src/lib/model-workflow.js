import {defaultModel,MODEL_PRESETS} from './model.js';
import {runWorker} from './worker-client.js';

export function initModelWorkflow(state,{save,runExportFlow,signal}) {
  const $=id=>document.getElementById(id);
  let settings=defaultModel(),model=null,job=null,preview=null,disposed=false,revision=0;
  const numeric=['width','resolution','base','relief','roadWidth','roadRise','areaRise','buildingScale','fallbackHeight'];
  const layers=['terrain','buildings','roads','water','green','rivers'];
  function sync(){for(const key of numeric){$('model-'+key).value=settings[key];const out=$('model-'+key+'-value');if(out)out.textContent=settings[key];const el=$('model-'+key);if(el.type==='range'){el.style.setProperty('--range-progress',((settings[key]-Number(el.min))/(Number(el.max)-Number(el.min))*100)+'%');el.setAttribute('aria-valuetext',String(settings[key]));}}for(const key of layers)$('model-'+key).checked=settings[key];document.querySelectorAll('[data-model-preset]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.modelPreset===settings.preset)));}
  function invalidate(){revision++;job?.abort();job=null;model=null;$('exportModel').disabled=true;$('modelStatus').textContent='Settings changed. Update the model to preview and export these settings.';$('modelProgress').hidden=true;$('cancelModel').hidden=true;$('updateModel').disabled=false;}
  for(const key of [...numeric,...layers])$('model-'+key).addEventListener('change',()=>{settings[key]=layers.includes(key)?$('model-'+key).checked:Number($('model-'+key).value);settings.preset='custom';invalidate();sync();});
  for(const key of numeric)$('model-'+key).addEventListener('input',()=>{const out=$('model-'+key+'-value');if(out)out.textContent=$('model-'+key).value;invalidate();});
  document.querySelectorAll('[data-model-preset]').forEach(el=>el.onclick=()=>{settings={...settings,...MODEL_PRESETS[el.dataset.modelPreset],preset:el.dataset.modelPreset};invalidate();sync();});
  const status=(text,error=false)=>{$('modelStatus').textContent=text;$('modelStatus').classList.toggle('error',error);};
  async function build() {
    invalidate();const generation=revision,controller=new AbortController();job=controller;
    $('updateModel').disabled=true;$('cancelModel').hidden=false;$('modelProgress').hidden=false;
    try {
      for(const key of numeric)settings[key]=Number($('model-'+key).value);
      if(!state.osmStatus.loaded&&layers.slice(1).some(key=>settings[key]))throw new Error('Map overlays are unavailable. Close this preview and reload the area, or disable buildings, streets, water, rivers and green areas.');
      const next=await runWorker('model',{state:{wMm:state.wMm,hMm:state.hMm,shape:state.shape,terrainData:state.terrainData,renderBbox:state.renderBbox,osmData:state.osmData},settings},{signal:controller.signal,progress:p=>{status(p.detail);$('modelProgress').value=p.percent;}});
      if(disposed||generation!==revision)return;
      if(!preview){const {createModelPreview}=await import('./preview3d.js');if(disposed||generation!==revision)return;preview=createModelPreview($('preview3d'));}
      preview.set(next);model=next;
      const missing=layers.slice(1).filter(key=>settings[key]&&!next.counts[key]);
      status(`${next.width.toFixed(1)} × ${next.height.toFixed(1)} mm · ${next.triangles.toLocaleString()} triangles · fused solid. ${Object.entries(next.counts).filter(([key])=>settings[key]).map(([key,n])=>`${n} ${key}`).join(' · ')}${missing.length?'. No mapped features for: '+missing.join(', '):''}`);
      $('exportModel').disabled=false;
    } catch(error) {if(generation===revision)status(error.name==='AbortError'?'Model generation cancelled. Update to try again.':error.message,error.name!=='AbortError');}
    finally {if(generation===revision){job=null;$('updateModel').disabled=false;$('cancelModel').hidden=true;$('modelProgress').hidden=true;}}
  }
  $('updateModel').onclick=build;
  $('cancelModel').onclick=()=>job?.abort();
  $('resetModelView').onclick=()=>preview?.reset();
  $('exportModel').onclick=async()=>{if(!model)return;const current=model,format=$('model-format').value;await runExportFlow(format.toUpperCase(),async onSave=>{const file=await runWorker('model-export',{model:current,format},{signal});await onSave();save(file.blob,file.name);});};
  sync();
  return {open:()=>{if(!model&&!job)void build();},invalidate,dispose(){disposed=true;job?.abort();preview?.dispose();}};
}
