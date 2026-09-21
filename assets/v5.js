/* Chop chop 5.0 — additive ideas, contextual drafts, shared voice UI. */
(()=>{
  'use strict';
  const KEY='qyx_ideas_v5', DRAFT='qyx_draft_v5:', RECEIPT='qyx_submit_v5:';
  const uid=()=>crypto.randomUUID();
  const read=(k,d)=>{try{const s=localStorage.getItem(k);return s===null?d:JSON.parse(s);}catch{return d;}};
  const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  let ready=window.__v5BackupReady!==false;
  try{
    if(!localStorage.getItem('qyx_pre5_snapshot')){
      const snapshot={version:APP_VERSION,createdAt:new Date().toISOString(),data:{}};
      for(const k of Object.keys(localStorage))if(k.startsWith('qyx_')&&!/token|key|snapshot/.test(k))snapshot.data[k]=localStorage.getItem(k);
      write('qyx_pre5_snapshot',snapshot);
    }
  }catch{ready=false;}
  let state=read(KEY,{schema:1,items:[],links:[],events:[]});
  const empty=()=>({schema:1,items:[],links:[],events:[]});
  function mergeState(a,b){
    const out=empty();
    for(const key of ['items','links','events']){
      const m=new Map();
      for(const x of [...(Array.isArray(a[key])?a[key]:[]),...(Array.isArray(b[key])?b[key]:[])]){
        if(!x||typeof x.id!=='string'||!/^[-\w:.]+$/.test(x.id))continue;
        if(['recordId','ideaId','rootRecordId'].some(k=>x[k]&&!/^[-\w:.]+$/.test(x[k])))continue;
        const old=m.get(x.id);
        if(!old||(x.updatedAt||0)>(old.updatedAt||0)||((x.updatedAt||0)===(old.updatedAt||0)&&JSON.stringify(x)>JSON.stringify(old)))m.set(x.id,x);
      }
      out[key]=[...m.values()].sort((x,y)=>x.id.localeCompare(y.id));
    }
    return out;
  }
  state=mergeState(empty(),state||empty());
  function persist(){
    if(!ready)throw Error('空间不足，升级前快照未能保存。请先导出完整备份。');
    state=mergeState(read(KEY,empty()),state);LS.set(KEY,state);
  }
  // New submissions and edits retain identity; legacy repair remains unchanged.
  const oldDedupe=dedupeByContent;
  dedupeByContent=function(rows){const stable=rows.filter(r=>r.submissionId||r.v5StableId),legacy=rows.filter(r=>!r.submissionId&&!r.v5StableId);return [...oldDedupe(legacy),...stable].sort((a,b)=>a.t-b.t);};
  const oldCollect=collectBackup;
  collectBackup=function(){state=mergeState(read(KEY,empty()),state);const o=JSON.parse(oldCollect());o[KEY]=state;o._schema=5;return JSON.stringify(o,null,2);};
  // Extend the reader boundary; the existing mergeAll body is unchanged.
  const oldReader=readBackupFile;
  readBackupFile=async function(file){const o=await oldReader(file);if(o[KEY]){state=mergeState(state,o[KEY]);write(KEY,state);setTimeout(()=>{renderIdeas();renderLog();if(selected&&item(selected)){saveCurrentComposer();renderDetail(selected);}},0);}return o;};
  const oldExport=buildExportBundle;
  buildExportBundle=function(){const b=oldExport();b.messageBox=state;return b;};
  const oldMarkdown=buildExportMarkdown;
  buildExportMarkdown=function(b){let s=oldMarkdown(b);if(b.messageBox)s+='\n## 消息盒子索引\n\n'+b.messageBox.items.filter(i=>!i.removedAt).map(i=>'- '+(i.title||'未命名想法')+' · '+i.status+' · '+i.id+' · 原文 '+i.rootRecordId).join('\n')+'\n';return s;};

  const paths={star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',sprout:'M12 21V11M12 14C3 15 3 6 3 6s9-1 9 8ZM12 11C12 3 21 3 21 3s0 8-9 8Z',cup:'M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5ZM17 9h2a3 3 0 0 1 0 6h-2M7 3v2m5-2v2M3 22h16',note:'M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5',camera:'M3 7h5l2-3h4l2 3h5v14H3ZM16 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0',plane:'m3 10 18-7-7 18-3-8Zm8 3L21 3',flower:'M12 9C5-1 0 10 9 12 0 18 10 24 12 15c6 9 14-1 3-3C25 6 15-2 12 9ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0',wave:'M2 18c7 0 3-14 13-13-5 6-1 11 7 10-4 9-12 3-20 3Z',light:'M8 17c0-3-4-3-4-8a8 8 0 1 1 16 0c0 5-4 5-4 8ZM9 21h6M12 17v-6',bottle:'M9 2h6v5l4 5v9H5v-9l4-5ZM9 5h6M5 15h14'};
  const names={star:'小星星',sprout:'小芽',cup:'杯子',note:'便笺',camera:'相机',plane:'小飞机',flower:'小花',wave:'海浪',light:'灯泡',bottle:'小瓶子'};
  const iconKey=k=>Object.hasOwn(paths,k)?k:'star';
  const icon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[k]||paths.star}"/></svg>`;
  state.items.forEach(i=>{if(!Object.hasOwn(paths,i.icon))i.icon='star';});
  const date=t=>new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  const item=id=>state.items.find(i=>i.id===id&&!i.removedAt);
  const links=id=>state.links.filter(l=>l.ideaId===id&&!l.removedAt);
  const rec=id=>log.find(r=>r.id===id);
  const owner=id=>state.links.find(l=>l.recordId===id&&!l.removedAt&&item(l.ideaId));
  const title=i=>i.title||(rec(i.rootRecordId)?.text||'暂存的想法').split(/[\n。！？]/)[0].slice(0,32);
  let selected=null,filter='all',query='',scroll=0,voice=null;
  const view=document.createElement('section');view.id='v-ideas';view.className='view';$('v-log').after(view);
  view.innerHTML=`<div id="ideaListView"><div class="v5-heading"><div><small>一点一点，接着写</small><h1>消息盒子</h1></div><button id="ideaNew" class="v5-primary">记个想法</button></div><label class="v5-search">搜索想法<input id="ideaSearch" type="search" placeholder="标题、最初的念头、后来的补充"></label><div class="v5-filters" id="ideaFilters"><button data-f="all" aria-pressed="true">全部</button><button data-f="open">未完成</button><button data-f="completed">已完成</button></div><div id="ideaCards"></div></div><div id="ideaDetail" hidden></div>`;
  const nav=document.createElement('button');nav.dataset.v='v-ideas';nav.innerHTML=icon('note')+'消息盒子';document.querySelector('nav button').after(nav);
  const logNav=document.querySelector('nav [data-v="v-log"]');logNav.lastChild.textContent='说说';
  function activate(id){
    if(voice&&voice.phase!=='finished')pauseVoice('页面已切换，识别已暂停');
    if($('v-log').classList.contains('on')&&id!=='v-log')finishRecordTrace(false);
    if(id!=='v-log'){cancelRecordNudgeTimer();hideRecordNudge();}
    document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===id));
    document.querySelectorAll('.view').forEach(v=>v.classList.toggle('on',v.id===id));
  }
  nav.onclick=()=>{activate('v-ideas');renderIdeas();};
  document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{if(voice)pauseVoice('页面切换，已暂停');}));
  $('ideaSearch').oninput=e=>{query=e.target.value;renderIdeas();};
  $('ideaFilters').onclick=e=>{if(e.target.dataset.f){filter=e.target.dataset.f;renderIdeas();}};
  $('ideaNew').onclick=()=>openComposer(null);
  function renderIdeas(){
    if(!$('ideaCards'))return;
    const list=state.items.filter(i=>!i.removedAt&&(filter==='all'||i.status===filter)&&(!query||[title(i),...links(i.id).map(l=>rec(l.recordId)?.text||'')].join('\n').toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.activityAt-a.activityAt||a.id.localeCompare(b.id));
    $('ideaCards').innerHTML=list.length?list.map(i=>{
      const rows=links(i.id).map(l=>rec(l.recordId)).filter(Boolean).sort((a,b)=>b.t-a.t);
      return `<article class="v5-idea"><button class="v5-idea-main" data-open="${i.id}"><span class="v5-icon ${iconKey(i.icon)}">${icon(i.icon)}</span><span><strong>${esc(title(i))}</strong><span class="v5-excerpt">${esc(rows[0]?.text||'原始记录已移除，其他补充仍保留')}</span><small>${date(i.activityAt)}${i.status==='completed'?' · 已完成':''} · ${links(i.id).filter(l=>l.role!=='root').length} 次补充</small></span></button><button class="v5-more" aria-label="想法菜单" data-menu="${i.id}">…</button></article>`;
    }).join(''):'<div class="v5-empty">给一个想法留个位置。<p>以后想到什么，还能回来接着写。</p></div>';
    document.querySelectorAll('#ideaFilters button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.f===filter)));
    if(selected&&item(selected)&&!$('ideaBody'))renderDetail(selected);
  }
  $('ideaCards').onclick=e=>{const a=e.target.closest('[data-open]'),m=e.target.closest('[data-menu]');if(m)ideaMenu(m.dataset.menu);else if(a){scroll=document.querySelector('main').scrollTop;openIdea(a.dataset.open);}};
  function openIdea(id){if(!item(id))return;selected=id;activate('v-ideas');$('ideaListView').hidden=true;$('ideaDetail').hidden=false;renderDetail(id);document.querySelector('main').scrollTop=0;}
  function back(){saveCurrentComposer();selected=null;$('ideaListView').hidden=false;$('ideaDetail').hidden=true;$('ideaDetail').innerHTML='';renderIdeas();document.querySelector('main').scrollTop=scroll;}
  function renderDetail(id){
    const i=item(id);if(!i)return back();
    const content=links(id).sort((a,b)=>(a.role==='root'?-1:b.role==='root'?1:(rec(a.recordId)?.t||a.linkedAt)-(rec(b.recordId)?.t||b.linkedAt))).map(l=>{
      const r=rec(l.recordId);
      return `<article class="v5-timeline"><div><small>${l.role==='root'?'最初写下':'接着写'} · ${r?date(r.t):'记录已删除'}</small>${r?`<button class="v5-more" data-record="${r.id}" aria-label="这段记录的菜单">…</button>`:''}</div><div class="md-lite">${r?renderMarkdownLite(r.text):'这条记录已从说说中删除。其余补充仍然保留。'}</div>${r?renderTagChips(recordTags[r.id]||[]):''}${l.role!=='root'?`<button class="v5-subtle" data-unlink="${l.id}">移出此想法</button>`:''}</article>`;
    }).join('');
    $('ideaDetail').innerHTML=`<button class="v5-subtle" id="ideaBack">‹ 消息盒子</button><div class="v5-heading"><span class="v5-icon ${iconKey(i.icon)}">${icon(i.icon)}</span><h1>${esc(title(i))}</h1><button id="ideaMenu" class="v5-more" aria-label="想法菜单">…</button></div>${i.status==='completed'?'<p class="v5-status">已完成 · 仍然可以接着写</p>':''}<div>${content}</div><div class="v5-events">${state.events.filter(e=>e.ideaId===id).sort((a,b)=>a.t-b.t).map(e=>`<small>${date(e.t)} · ${e.event==='completed'?'标记完成':'重新打开'}</small>`).join('')}</div><div class="v5-compose"><h2>接着写</h2><textarea id="ideaBody" rows="4" placeholder="补充一点新的想法……"></textarea><small>可在正文中输入 #标签</small><div class="v5-compose-actions"><button id="ideaVoice" class="v5-subtle">语音输入</button><button id="ideaSave" class="v5-primary">保存补充</button></div></div>`;
    bindDraft($('ideaBody'),'idea:'+id);
    $('ideaBack').onclick=back;$('ideaMenu').onclick=()=>ideaMenu(id);
    $('ideaVoice').onclick=()=>startVoice($('ideaBody'),'idea:'+id);
    $('ideaSave').onclick=()=>submitComposer($('ideaBody'),'idea:'+id,id);
    $('ideaDetail').querySelectorAll('[data-record]').forEach(b=>b.onclick=()=>recordMenu(b.dataset.record));
    $('ideaDetail').querySelectorAll('.md-ref[data-ref]').forEach(node=>{node.onclick=()=>node.classList.toggle('open');const go=node.querySelector('.mr-go');if(go)go.onclick=e=>{e.stopPropagation();const m=/@([dq]?)(\d{6})-(\d{4})([a-z]?)/.exec(node.dataset.ref);if(m){const {hit}=resolveRef(m[1],m[2],m[3],m[4]);if(hit)jumpToEntry(hit);}};});
    $('ideaDetail').querySelectorAll('[data-unlink]').forEach(b=>b.onclick=()=>{const l=state.links.find(l=>l.id===b.dataset.unlink);l.removedAt=l.updatedAt=Date.now();persist();saveCurrentComposer();renderDetail(id);renderLog();});
  }
  function openComposer(linkRecord){
    selected=null;activate('v-ideas');$('ideaListView').hidden=true;$('ideaDetail').hidden=false;
    $('ideaDetail').innerHTML=`<button class="v5-subtle" id="ideaBack">‹ 消息盒子</button><div class="v5-heading"><h1>记个想法</h1></div><div class="v5-compose"><details><summary>选择一个小图标</summary><div class="v5-icon-grid">${Object.keys(paths).map(k=>`<button data-icon="${k}" aria-label="${names[k]}" aria-pressed="${k==='star'}">${icon(k)}</button>`).join('')}</div></details><label>标题（可选）<input id="ideaTitle" placeholder="给这个想法起个名字"></label><label>现在想到的<textarea id="ideaBody" rows="6" placeholder="一点想法、一段话，都可以留在这里"></textarea></label><small>正文支持 #多层/标签</small><div class="v5-compose-actions"><button id="ideaVoice" class="v5-subtle">语音输入</button><button id="ideaSave" class="v5-primary">保存想法</button></div></div>`;
    const context=linkRecord?'new-from:'+linkRecord.id:'new-idea';
    bindDraft($('ideaBody'),context);let chosen=drafts.get($('ideaBody')).icon||'star';$('ideaTitle').value=drafts.get($('ideaBody')).title||'';
    if(linkRecord){$('ideaBody').value=linkRecord.text;$('ideaBody').readOnly=true;$('ideaVoice').hidden=true;}
    const metadata=()=>{const d=saveDraft($('ideaBody'));d.title=$('ideaTitle').value;d.icon=chosen;write(DRAFT+context,d);};
    $('ideaTitle').oninput=metadata;
    $('ideaBack').onclick=back;
    $('ideaDetail').querySelectorAll('[data-icon]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.icon===chosen));b.onclick=()=>{chosen=b.dataset.icon;metadata();$('ideaDetail').querySelectorAll('[data-icon]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));};});
    $('ideaVoice').onclick=()=>startVoice($('ideaBody'),context);
    $('ideaSave').onclick=()=>submitComposer($('ideaBody'),context,null,{title:$('ideaTitle').value.trim(),icon:chosen},linkRecord);
  }
  async function ideaMenu(id){
    const i=item(id);if(!i)return;
    const result=await appDialog({title:title(i),pick:{options:[{label:'修改标题',value:'rename'},{label:'更换图标',value:'icon'},{label:i.status==='completed'?'重新打开':'标记完成',value:'status'},{label:'导出完整时间线',value:'export'},{label:'从消息盒子移除（保留说说）',value:'remove'}]}});
    const action=result?.[0];if(!action)return;
    if(action==='rename'){const text=await appDialog({title:'修改标题',input:'line',value:i.title||''});if(text===null)return;i.title=text.trim();}
    if(action==='icon'){const keys=Object.keys(paths);const pick=await appDialog({title:'更换图标',pick:{options:keys.map(k=>({label:names[k],value:k}))}});if(!pick?.length)return;i.icon=pick[0];}
    if(action==='status'){i.status=i.status==='completed'?'open':'completed';i.activityAt=Date.now();i.completedAt=i.status==='completed'?i.activityAt:null;state.events.push({id:uid(),ideaId:id,event:i.status,t:i.activityAt,updatedAt:i.activityAt});}
    if(action==='remove'){if(!await appDialog({title:'从消息盒子移除？',text:'所有正文仍保留在说说中。完整备份会保留恢复信息。',danger:true}))return;i.removedAt=Date.now();}
    if(action==='export'){downloadText(title(i)+'.md','# '+title(i)+'\n\n'+links(id).map(l=>rec(l.recordId)).filter(Boolean).sort((a,b)=>a.t-b.t).map(r=>'## '+date(r.t)+'\n\n'+r.text).join('\n\n'),'text/markdown');return;}
    i.updatedAt=Date.now();persist();renderLog();if(selected===id){saveCurrentComposer();item(id)?renderDetail(id):back();}renderIdeas();
  }

  // Draft receipts are context-specific. A committed revision cannot be restored.
  const drafts=new WeakMap();
  function loadDraft(context){let d=read(DRAFT+context,null);if(d&&read(RECEIPT+d.submissionId,null))d=null;return d||{id:uid(),context,revision:0,submissionId:uid(),text:''};}
  function bindDraft(el,context){const d=loadDraft(context);if(el.value&&!d.text){d.text=el.value;d.revision++;write(DRAFT+context,d);}drafts.set(el,d);el.value=d.text;el.autocomplete='off';el.oninput=()=>saveDraft(el);}
  function saveDraft(el){
    if(!el||!drafts.has(el))return;
    let d=drafts.get(el);
    if(read(RECEIPT+d.submissionId,null)){if(el.value===d.text)return;d={id:uid(),context:d.context,revision:0,submissionId:uid(),text:''};}
    if(d.text!==el.value){d={...d,text:el.value,revision:d.revision+1,submissionId:uid()};drafts.set(el,d);}
    try{write(DRAFT+d.context,d);}catch{toastDone('草稿暂存失败，请先复制文字。');}
    return d;
  }
  function saveCurrentComposer(){if($('ideaBody'))saveDraft($('ideaBody'));saveDraft($('noteText'));if(drafts.has($('appDialogArea')))saveDraft($('appDialogArea'));}
  function clearSubmitted(el,d){write(RECEIPT+d.submissionId,{recordId:'rec5_'+d.submissionId,context:d.context,revision:d.revision,t:Date.now()});const stored=read(DRAFT+d.context,null);if(stored?.submissionId===d.submissionId)localStorage.removeItem(DRAFT+d.context);if(drafts.get(el)?.submissionId===d.submissionId){el.value='';drafts.set(el,loadDraft(d.context));}}
  function recoverTransaction(){
    const tx=read('qyx_v5_pending',null);if(!tx)return;
    const records=new Map(log.map(r=>[logKey(r),r]));for(const r of read('qyx_log',[])){const old=records.get(logKey(r));if(!old||(r.updatedAt||r.t)>(old.updatedAt||old.t))records.set(logKey(r),r);}log=[...records.values()].filter(r=>!read('qyx_dead',[]).some(d=>d.s==='log'&&d.v===logKey(r)));
    if(tx.record&&!log.some(r=>r.id===tx.record.id)){log.push(tx.record);LS.set('qyx_log',log);}
    if(tx.state){state=mergeState(state,tx.state);write(KEY,state);}
    if(tx.record){indexRecordTags(tx.record,true);saveTagData(true);}
    if(tx.draft)write(RECEIPT+tx.draft.submissionId,{recordId:tx.record?.id,t:Date.now(),context:tx.draft.context,revision:tx.draft.revision});
    localStorage.removeItem('qyx_v5_pending');
  }
  function submitComposer(el,context,ideaId,config=null,existing=null){
    if(!ready){toastDone('请先导出完整备份，当前浏览器空间不足。');return;}
    if(!el.value.trim())return;
    const d=saveDraft(el),now=Date.now();
    try{
      recoverTransaction();
      const prior=read(RECEIPT+d.submissionId,null);if(prior){clearSubmitted(el,d);renderLog();return;}
      const r=existing||{id:'rec5_'+d.submissionId,t:now,updatedAt:now,type:'note',text:el.value.trim(),mood:context==='note'?selectedMood:null,submissionId:d.submissionId};
      if(context==='note'&&!existing){traceSaving=true;traceIgnoreBlurUntil=Date.now()+500;const tr=finishRecordTrace(true);if(tr){r.wall=tr.wall;r.active=tr.active;}}
      let next=JSON.parse(JSON.stringify(state));
      if(config){ideaId='idea_'+d.submissionId;next.items.push({id:ideaId,title:config.title,icon:config.icon,status:'open',rootRecordId:r.id,createdAt:now,activityAt:now,updatedAt:now});}
      if(ideaId){
        if(owner(r.id)&&owner(r.id).ideaId!==ideaId)throw Error('这条记录已经属于另一条想法。');
        next.links.push({id:'link_'+r.id,ideaId,recordId:r.id,role:config?'root':'update',linkedAt:now,updatedAt:now});
        const i=next.items.find(x=>x.id===ideaId);if(i)i.activityAt=i.updatedAt=now;
      }
      write('qyx_v5_pending',{record:existing?null:r,state:next,draft:d});recoverTransaction();
      clearSubmitted(el,d);LS.set(KEY,state);LS.set('qyx_log',log);
      if(context==='note'){if(pendingPolish&&pendingPolish.polished===r.text){polishHistory.push({t:r.t,original:pendingPolish.original,polished:r.text,mode:pendingPolish.mode});LS.set('qyx_polish_history',polishHistory);}selectedMood=null;document.querySelectorAll('.mood-btn').forEach(b=>b.classList.remove('on'));$('polishPanel').hidden=true;pendingPolish=null;voiceOriginal='';polishResult='';traceSaving=false;beginRecordTrace();markNudgeActed();}
      renderLog();renderIdeas();toastDone('已保存到本机'+(LS.get('qyx_ghtoken','')?'，正在同步。':'。'));
      if(ideaId)openIdea(ideaId);
    }catch(e){traceSaving=false;toastDone('尚未完成保存：'+e.message+'。文字已保留。');}
  }
  try{if(ready)recoverTransaction();}catch{ready=false;}
  bindDraft($('noteText'),'note');
  $('saveNote').onclick=()=>submitComposer($('noteText'),'note',null);
  document.querySelector('[data-polish="discard"]').addEventListener('click',()=>saveDraft($('noteText')));
  $('applyPolish').addEventListener('click',()=>saveDraft($('noteText')));
  document.querySelectorAll('[data-editor-tool]').forEach(b=>b.addEventListener('click',()=>saveDraft($('noteText'))));
  window.addEventListener('pagehide',saveCurrentComposer);
  window.addEventListener('pageshow',()=>requestAnimationFrame(()=>{for(const el of [$('noteText'),$('ideaBody')].filter(Boolean)){const d=drafts.get(el);if(!d||document.activeElement===el)continue;const restored=loadDraft(d.context);el.value=restored.text;drafts.set(el,restored);}}));
  window.addEventListener('storage',e=>{
    if(e.key===KEY){state=mergeState(state,read(KEY,empty()));renderIdeas();}
    if(e.key==='qyx_log'||e.key==='qyx_dead'){
      const records=new Map(log.map(r=>[logKey(r),r]));for(const r of read('qyx_log',[])){const old=records.get(logKey(r));if(!old||(r.updatedAt||r.t)>(old.updatedAt||old.t))records.set(logKey(r),r);}
      const removed=read('qyx_dead',[]);log=[...records.values()].filter(r=>!removed.some(d=>d.s==='log'&&d.v===logKey(r)));renderLog();
    }
    if(e.key?.startsWith(RECEIPT))for(const el of [$('noteText'),$('ideaBody')].filter(Boolean)){const d=drafts.get(el);if(d&&e.key===RECEIPT+d.submissionId&&el.value===d.text){el.value='';drafts.set(el,loadDraft(d.context));}}
  });

  async function recordMenu(id){
    const r=rec(id);if(!r)return;const relation=owner(id);
    const choice=await appDialog({title:'这条记录',pick:{options:[{label:'编辑文字',value:'edit'},{label:relation?'查看所属想法':'收进消息盒子',value:'idea'},{label:'删除记录',value:'delete'}]}});
    const action=choice?.[0];
    if(action==='idea'){
      if(relation)return openIdea(relation.ideaId);
      const options=[{label:'作为新想法',value:'new'},...state.items.filter(i=>!i.removedAt).map(i=>({label:'补充到：'+title(i),value:i.id}))];
      const p=await appDialog({title:'收进消息盒子',pick:{options}});if(!p?.[0])return;
      if(p[0]==='new')return openComposer(r);
      const i=item(p[0]),now=Date.now();state.links.push({id:'link_'+id,ideaId:i.id,recordId:id,role:'update',linkedAt:now,updatedAt:now});i.activityAt=i.updatedAt=now;persist();renderLog();openIdea(i.id);
    }
    if(action==='edit'){
      const editing=appDialog({title:'编辑记录',input:'area',value:r.text});bindDraft($('appDialogArea'),'edit:'+id);const value=await editing;if(value===null||!value.trim())return;
      const editDraft=saveDraft($('appDialogArea'));
      r.text=value.trim();r.updatedAt=Date.now();r.v5StableId=true;recordTags[r.id]=[];indexRecordTags(r,true);saveTagData(true);LS.set('qyx_log',log);
      clearSubmitted($('appDialogArea'),editDraft);drafts.delete($('appDialogArea'));
      if(relation){item(relation.ideaId).activityAt=item(relation.ideaId).updatedAt=r.updatedAt;persist();}
      renderLog();if(selected){saveCurrentComposer();renderDetail(selected);}
    }
    if(action==='delete'){
      if(!await appDialog({title:'删除这条记录？',text:relation?'这条正文也会从所属想法中移除，其他补充会保留。':'沿用记录删除规则。',danger:true,okText:'删除'}))return;
      bury('log',logKey(r));log=log.filter(x=>x.id!==id);delete recordTags[id];saveTagData(true);LS.set('qyx_log',log);renderLog();if(selected){saveCurrentComposer();renderDetail(selected);}
    }
  }
  const oldRender=renderLog;
  renderLog=function(){oldRender();document.querySelectorAll('#logList .entry').forEach(row=>{
    const r=log.find(r=>r.id===row.dataset.recordId);if(!r)return;
    const menu=row.querySelector('.ex');if(menu){menu.textContent='…';menu.title='记录菜单';menu.setAttribute('aria-label','记录菜单');menu.onclick=()=>recordMenu(r.id);}
    const text=row.querySelector('.etx');if(text){text.onclick=null;if(r.text.length>360){text.classList.add('v5-clamped');const b=document.createElement('button');b.className='v5-subtle';b.textContent='展开全文';b.onclick=()=>{const collapsed=text.classList.toggle('v5-clamped');b.textContent=collapsed?'展开全文':'收起';};text.after(b);}}
    const relation=owner(r.id);if(relation){const b=document.createElement('button');b.className='v5-source';b.textContent='↗ '+title(item(relation.ideaId));b.onclick=()=>openIdea(relation.ideaId);row.querySelector('.body').append(b);}
  });};

  // Browser recognition offers text segments, not recoverable audio files.
  const modal=document.createElement('div');modal.className='v5-voice-bg';modal.hidden=true;modal.innerHTML=`<section class="v5-voice-modal" role="dialog" aria-modal="true" aria-label="语音输入"><h2>慢慢说就好</h2><div class="v5-mic">${icon('wave')}</div><strong id="v5VoiceTime">00:00</strong><p id="v5VoiceState">等待麦克风</p><p id="v5VoiceText" aria-live="polite"></p><div class="v5-voice-buttons"><button id="v5VoiceCancel">取消</button><button id="v5VoicePause">暂停</button><button id="v5VoiceDone" class="v5-primary">完成</button></div><small>使用当前浏览器的语音识别，完成后仍可修改文字。</small></section>`;document.body.append(modal);
  function voiceDisplay(){if(!voice)return;const ms=voice.elapsed+(voice.phase==='listening'?Date.now()-voice.started:0),secs=Math.floor(ms/1000);$('v5VoiceTime').textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');$('v5VoiceText').textContent=voice.text+(voice.segment||''); $('v5VoicePause').textContent=voice.phase==='paused'?'继续':'暂停';$('v5VoicePause').disabled=['permission','finishing'].includes(voice.phase);}
  function startVoice(el,context){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){toastDone('当前浏览器没有语音识别能力，请使用键盘上的系统听写。');return;}
    if(voice)return;
    saveDraft(el);voice={id:uid(),el,context,phase:'permission',text:'',elapsed:0,started:0,rec:null,SR};modal.hidden=false;$('v5VoiceState').textContent='正在请求麦克风权限…';voice.timer=setInterval(voiceDisplay,250);startSegment();$('v5VoiceCancel').focus();
  }
  function startSegment(){
    const s=voice;if(!s)return;const recognition=new s.SR();s.rec=recognition;s.phase='permission';let segment='';
    recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;
    recognition.onstart=()=>{if(voice!==s){recognition.abort();return;}if(s.phase!=='permission'){recognition.stop();return;}s.error='';s.phase='listening';s.started=Date.now();$('v5VoiceState').textContent='正在听…';voiceDisplay();};
    recognition.onresult=e=>{if(voice!==s||s.rec!==recognition)return;segment=Array.from(e.results).map(r=>r[0]?.transcript||'').join('');s.segment=segment;$('v5VoiceText').textContent=s.text+segment;try{write('qyx_voice_recovery_v5',{context:s.context,text:s.text+(s.text&&segment?'\n':'')+segment,session:s.id});}catch{$('v5VoiceState').textContent='语音临时保存失败，请尽快完成并复制文字。';}};
    recognition.onerror=e=>{if(voice!==s)return;s.error=voiceErrorMessage(e.error).replaceAll('按住说','点按开始')+'。已识别的文字会保留。';$('v5VoiceState').textContent=s.error;};
    recognition.onend=()=>{if(voice!==s||s.rec!==recognition)return;if(s.phase==='listening')s.elapsed+=Date.now()-s.started;s.text+=(s.text&&segment?'\n':'')+segment;s.segment='';s.rec=null;if(s.phase==='finishing')finishVoice();else{s.phase='paused';$('v5VoiceState').textContent=s.error||'已暂停，可继续或完成';voiceDisplay();}};
    try{recognition.start();}catch(e){s.phase='paused';$('v5VoiceState').textContent='语音启动失败，可以重试：'+e.message;voiceDisplay();}
  }
  function pauseVoice(message){const s=voice;if(!s||!['permission','listening'].includes(s.phase))return;if(s.phase==='listening')s.elapsed+=Date.now()-s.started;s.phase='paused';s.rec?.stop();$('v5VoiceState').textContent=message||'已暂停';voiceDisplay();}
  function finishVoice(){
    const s=voice;if(!s)return;clearInterval(s.timer);voice=null;modal.hidden=true;
    if(!s.text.trim()){toastDone('没有识别到有效文字，原内容已保留。');return;}
    if(s.el.isConnected){s.el.value+=(s.el.value?'\n':'')+s.text;saveDraft(s.el);s.el.dispatchEvent(new Event('input',{bubbles:true}));s.el.focus();if(s.context==='note')showPolish(s.el.value);}
    else{const d=loadDraft(s.context);d.text+=(d.text?'\n':'')+s.text;d.revision++;d.submissionId=uid();write(DRAFT+s.context,d);}
    localStorage.removeItem('qyx_voice_recovery_v5');
    toastDone('文字已放回输入框，确认后再保存。');
  }
  $('v5VoicePause').onclick=()=>{if(voice?.phase==='paused'&&!voice.rec)startSegment();else pauseVoice();};
  $('v5VoiceDone').onclick=()=>{if(!voice)return;if(voice.phase==='listening')voice.elapsed+=Date.now()-voice.started;voice.phase='finishing';voiceDisplay();if(voice.rec)voice.rec.stop();else finishVoice();};
  $('v5VoiceCancel').onclick=()=>{const s=voice;if(!s)return;voice=null;clearInterval(s.timer);localStorage.removeItem('qyx_voice_recovery_v5');s.rec?.abort();modal.hidden=true;s.el.focus();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseVoice('页面已进入后台，识别已暂停');document.body.classList.toggle('v5-hidden',document.hidden);});
  document.addEventListener('keydown',e=>{if(!voice)return;if(e.key==='Escape')$('v5VoiceCancel').click();if(e.key==='Tab'){const buttons=[...modal.querySelectorAll('button:not(:disabled)')];const first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  $('recordVoiceBtn').textContent='语音输入';$('recordVoiceBtn').onclick=()=>startVoice($('noteText'),'note');$('voiceStatus').textContent='点一下开始，完成后可以修改';
  $('bottleVoiceBtn').textContent='语音输入';$('bottleVoiceBtn').onclick=()=>{const el=$('bottleVoiceBtn').parentElement.querySelector('textarea')||$('bottleText');if(el)startVoice(el,'bottle');};
  const lostVoice=read('qyx_voice_recovery_v5',null);
  if(lostVoice?.text){const recover=document.createElement('button');recover.className='v5-source';recover.textContent='恢复上次中断的语音文字';$('noteText').before(recover);recover.onclick=()=>{const d=loadDraft(lostVoice.context);d.text+=(d.text?'\n':'')+lostVoice.text;d.revision++;d.submissionId=uid();write(DRAFT+lostVoice.context,d);if(lostVoice.context==='note')bindDraft($('noteText'),'note');else if(lostVoice.context.startsWith('idea:'))openIdea(lostVoice.context.slice(5));else if(lostVoice.context==='new-idea')openComposer(null);else if(lostVoice.context==='bottle')$('bottleText').value=d.text;localStorage.removeItem('qyx_voice_recovery_v5');recover.remove();toastDone('已恢复到原输入位置，尚未发表。');};}

  const welcome=$('logSay').parentElement;
  welcome.querySelector('.buddy')?.remove();const avatar=document.createElement('img');avatar.src='assets/avatar-v5.jpg';avatar.alt='陪你记录的头像';avatar.className='v5-avatar';welcome.prepend(avatar);
  const observer=new IntersectionObserver(entries=>{avatar.classList.toggle('v5-still',!entries[0].isIntersecting);});observer.observe(avatar);
  document.addEventListener('focusin',e=>document.body.classList.toggle('v5-editing',e.target.matches('input,textarea')));
  document.addEventListener('focusout',()=>document.body.classList.remove('v5-editing'));
  document.body.classList.toggle('v5-motion-off',read('qyx_v5_motion',true)===false);
  const settings=$('saveSettings').parentElement;const extra=document.createElement('section');extra.className='v5-settings';extra.innerHTML=`<h3>5.0 · 留下与恢复</h3><label><input type="checkbox" id="v5Motion"> 轻柔动效</label><button id="v5Backup">下载完整备份</button><label class="v5-file">导入备份<input id="v5Import" type="file" accept=".json,application/json"></label><small id="v5BackupStatus"></small>`;settings.insertBefore(extra,$('saveSettings'));
  $('v5Motion').checked=read('qyx_v5_motion',true)!==false;$('v5Motion').onchange=e=>{write('qyx_v5_motion',e.target.checked);document.body.classList.toggle('v5-motion-off',!e.target.checked);};
  const recoveryLink=document.createElement('a');recoveryLink.href='recovery.html';recoveryLink.textContent='只读恢复页';recoveryLink.className='v5-subtle';extra.append(recoveryLink);
  function completeBackup(){const b=JSON.parse(collectBackup());b.localRecovery={};for(const key of Object.keys(localStorage))if(key.startsWith(DRAFT)||key.startsWith(RECEIPT)||['qyx_voice_recovery_v5','qyx_v5_pending','qyx_pre5_snapshot'].includes(key))b.localRecovery[key]=read(key,null);return b;}
  $('v5Backup').onclick=()=>downloadText('chopchop-full-'+dayKey(Date.now())+'.json',JSON.stringify(completeBackup(),null,2),'application/json');
  $('v5Import').onchange=async e=>{
    try{
      const file=e.target.files[0];if(!file)return;let o=JSON.parse(await file.text());
      if(!Array.isArray(o.qyx_log)){
        if(o.meta?.app!=='chop chop!'||!Array.isArray(o.journals))throw Error('请选择 chop chop 完整备份或记录 JSON 导出');
        const source=o,ts=source.tagSystem||{};
        o={qyx_log:[...(source.journals||[]),...(source.aiEntries||[])],qyx_bottles:source.bottles||[],qyx_polish_history:source.aiPolish||[],qyx_tags:ts.tags||[],qyx_record_tags:ts.recordTags||{},qyx_goal_tags:ts.goalTags||{},qyx_task_tags:ts.taskTags||{},[KEY]:source.messageBox||empty()};
        // Range exports omit some legacy task identities. Keep their source intact.
        write('qyx_range_import_v5',source);
      }
      if(o.qyx_log.some(r=>!r||typeof r.text!=='string'||!Number.isFinite(r.t)||(r.id&&!/^[-\w:.]+$/.test(r.id))))throw Error('记录格式无效，没有进行合并');
      write('qyx_preimport_snapshot',completeBackup());
      mergeAll(o);if(o[KEY]){state=mergeState(state,o[KEY]);persist();}
      for(const [key,value] of Object.entries(o.localRecovery||{}))if((key.startsWith(DRAFT)||key.startsWith(RECEIPT))&&!localStorage.getItem(key))write(key,value);
      rerenderAll();renderIdeas();$('v5BackupStatus').textContent='已合并导入，导入前快照已保留。范围导出只恢复文件实际包含的记录。';
    }catch(err){$('v5BackupStatus').textContent='导入未完成：'+err.message;}
    e.target.value='';
  };
  renderIdeas();
})();
