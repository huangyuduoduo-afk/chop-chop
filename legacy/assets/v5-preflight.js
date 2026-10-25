/* Run before the legacy application performs any storage initialization. */
(()=>{
  window.__v5BackupReady=false;
  try{
    if(!localStorage.getItem('qyx_pre5_snapshot')){
      const snapshot={sourceVersion:'4.5.8',targetVersion:'5.0.0',createdAt:new Date().toISOString(),data:{}};
      for(const key of Object.keys(localStorage)){
        if(key.startsWith('qyx_')&&!/token|key|snapshot/.test(key))snapshot.data[key]=localStorage.getItem(key);
      }
      localStorage.setItem('qyx_pre5_snapshot',JSON.stringify(snapshot));
    }
    window.__v5BackupReady=true;
  }catch(error){console.warn('升级前本地快照未保存；5.0 新内容写入将保持关闭。');}
})();
