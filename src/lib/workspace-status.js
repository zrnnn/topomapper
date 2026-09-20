// One source of activity truth, mirrored into the area and preview workspaces.
export function workflowAvailability({ready=false,busy=false,exportBusy=false,view='area',mode='2d',step='2'}={}){
  return Object.fromEntries(['area','2d','3d','export'].map(key=>[key,{
    disabled:exportBusy||(key!=='area'&&(!ready||busy)),
    current:view==='area'?key==='area':step==='3'?key==='export':key===mode,
    reason:exportBusy?'Wait for the export to finish.':!ready&&key!=='area'?'Generate an area first.':busy&&key!=='area'?'Wait for the current operation to finish.':''
  }]));
}
export function createWorkspaceStatus(root=document){
  const cards=[...root.querySelectorAll('.workspace-activity')],jobs=new Map();let sequence=0,last;
  const priority={export:4,area:3,model:2,preview:1};
  function render(){
    const active=[...jobs.entries()].filter(([,j])=>j.state==='loading').sort(([a],[b])=>(priority[b]||0)-(priority[a]||0));
    const current=active[0]?.[1]||last;if(!current)return;
    for(const card of cards){
      card.dataset.activityState=current.state;
      card.querySelector('[data-activity-title]').textContent=current.title||'Working';
      card.querySelector('[data-activity-detail]').textContent=current.detail||'Please wait…';
      const bar=card.querySelector('progress'),known=Number.isFinite(current.percent);
      if(known)bar.value=Math.max(0,Math.min(100,current.percent));else if(current.state==='loading')bar.removeAttribute('value');else bar.value=current.state==='success'?100:0;
      card.querySelector('[data-activity-value]').textContent=[known?`${Math.round(current.percent)}%`:'',current.state==='loading'?`${Math.floor((Date.now()-current.started)/1000)} s`:''].filter(Boolean).join(' · ');
      bar.setAttribute('aria-label',(current.title||'Current operation')+(current.state==='loading'?(known?' — stage progress':' — progress unknown'):''));
    }
  }
  const timer=setInterval(render,1000);
  return {focus(key){last=jobs.get(key)||last;render();},clear(key){jobs.delete(key);last=[...jobs.values()].sort((a,b)=>b.sequence-a.sequence)[0];render();},update(key,value){const previous=jobs.get(key);const job={...value,state:value.state||'loading',started:previous?.state==='loading'?previous.started:Date.now(),sequence:++sequence};jobs.set(key,job);last=job;render();},navigation(options){
    const availability=workflowAvailability(options);
    root.querySelectorAll('[data-workspace-step]').forEach(button=>{const item=availability[button.dataset.workspaceStep];button.disabled=item.disabled;button.title=item.reason;item.current?button.setAttribute('aria-current','step'):button.removeAttribute('aria-current');});
  },dispose(){clearInterval(timer);}};
}
