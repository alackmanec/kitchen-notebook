'use strict';
const DriveStore={
 token:null,expires:0,profile:null,root:null,events:new Map(),last:null,connecting:false,
 settings:JSON.parse(localStorage.getItem('kitchen-drive-settings')||'{}'),
 config(){return {...window.KITCHEN_CONFIG,...this.settings.config}},
 persist(){localStorage.setItem('kitchen-drive-settings',JSON.stringify(this.settings))},
 connected(){return !!this.token&&Date.now()<this.expires},
 async request(path,options={}){
  if(!this.connected()){let e=new Error('Connect Google Drive to sync. Your changes are saved on this device.');e.status=401;throw e}
  let url=path.startsWith('https://')?path:'https://www.googleapis.com/drive/v3/'+path;
  if(!/^https:\/\/www.googleapis.com\/(drive\/v3\/|upload\/drive\/v3\/)/.test(url))throw Error('Invalid Drive destination.');
  let response=await fetch(url,{...options,headers:{Authorization:'Bearer '+this.token,...options.headers}});
  if(!response.ok){let info=await response.json().catch(()=>({})),e=new Error(response.status===401?'Google connection expired. Reconnect to sync.':response.status===403?'Google Drive denied access. Check the selected notebook and its sharing permissions.':info.error?.message||'Drive request failed. Try again.');e.status=response.status;if(response.status===401)this.token=null;throw e}
  return response;
 },
 async json(path,options){return (await this.request(path,options)).json()},
 async list(query){let files=[],next='';do{let params=new URLSearchParams({q:query,pageSize:'1000',fields:'nextPageToken,files(id,name,modifiedTime,appProperties)',...(next?{pageToken:next}:{})});let page=await this.json('files?'+params);files.push(...page.files);next=page.nextPageToken||''}while(next);return files},
 async generatedId(){return (await this.json('files/generateIds?count=1&space=drive')).ids[0]},
 async upload(metadata,document){
  let body=new Blob([JSON.stringify(document)],{type:'application/json'});
  if(body.size>55_000_000)throw Error('This record exceeds the 50 MB household file limit.');
  try{
   if(body.size<5_000_000){let boundary='kitchen-'+crypto.randomUUID();let multipart=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n',body,'\r\n--'+boundary+'--'],{type:'multipart/related; boundary='+boundary});return await this.json('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',body:multipart})}
   let response=await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(body.size)},body:JSON.stringify(metadata)}),url=response.headers.get('Location');if(!url)throw Error('Drive did not start the upload. Try again.');return await this.json(url,{method:'PUT',headers:{'Content-Type':'application/json'},body});
  }catch(e){if(metadata.id){try{let saved=await this.json('files/'+encodeURIComponent(metadata.id)+'?alt=media');if(JSON.stringify(saved)===JSON.stringify(document))return {id:metadata.id}}catch(ignore){}}throw e}
 },
 async connect(){
  let config=this.config();if(!config.clientId)return driveSettingsDialog();
  if(this.connecting)return;this.connecting=true;
  try{
   await driveScript('https://accounts.google.com/gsi/client','googleIdentity');
   let response=await new Promise((resolve,reject)=>{google.accounts.oauth2.initTokenClient({client_id:config.clientId,scope:'https://www.googleapis.com/auth/drive.file',callback:r=>r.error?reject(Error(r.error)):resolve(r),error_callback:r=>reject(Error(r.type==='popup_closed'?'Google connection cancelled.':'Unable to open Google sign-in. Allow the sign-in popup.'))}).requestAccessToken({prompt:''})});
   if(!google.accounts.oauth2.hasGrantedAllScopes(response,'https://www.googleapis.com/auth/drive.file'))throw Error('Allow access to the notebook files to enable syncing.');
   this.token=response.access_token;this.expires=Date.now()+(Number(response.expires_in)-60)*1000;
   let about=await this.json('about?fields=user(displayName,emailAddress,permissionId)');this.profile={display:this.settings.display||about.user.displayName||'Household member',username:about.user.emailAddress||'Google account',account:about.user.permissionId};
   if(this.settings.rootId){try{await driveOpen(this.settings.rootId);return}catch(e){if(queue.length)throw Error('This account cannot open the notebook with your pending changes. Reconnect its original Google account.')}}
   await driveFindNotebooks();
  }catch(e){toast(e.message)}finally{this.connecting=false;status()}
 },
 async create(){
  if(queue.length)throw Error('Sync the current notebook before creating another.');
  let folder=await this.json('files?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Kitchen Notebook',mimeType:'application/vnd.google-apps.folder'})});
  let rootId=await this.generatedId();await this.upload({id:rootId,name:'Kitchen Notebook.json',parents:[folder.id],mimeType:'application/json',appProperties:{kitchenType:'notebook'}},{format:'Kitchen Notebook Drive v1',folderId:folder.id,state:KITCHEN_INITIAL_STATE});return rootId;
 },
 async open(rootId){
  if(!/^[A-Za-z0-9_-]+$/.test(rootId))throw Error('Invalid notebook identifier.');
  let root=await this.json('files/'+encodeURIComponent(rootId)+'?alt=media');
  if(root.format!=='Kitchen Notebook Drive v1'||! /^[A-Za-z0-9_-]+$/.test(root.folderId))throw Error('Choose a Kitchen Notebook.json file created by this app.');
  root.state=KitchenDomain.validateState(root.state,KITCHEN_INITIAL_STATE);this.root={...root,id:rootId};this.events.clear();let result;try{result=await this.pull()}catch(e){this.root=null;this.events.clear();throw e}this.settings.rootId=rootId;this.settings.folderId=root.folderId;this.persist();return result;
 },
 async pull(){
  if(!this.root){if(!this.settings.rootId){let e=new Error('Choose or create a Google Drive notebook.');e.status=401;throw e}await this.open(this.settings.rootId);return this.last.state}
  let files=await this.list("'"+this.root.folderId+"' in parents and trashed = false and appProperties has { key='kitchenType' and value='change' }");
  let missing=files.filter(f=>!this.events.has(f.id));
  for(let at=0;at<missing.length;at+=5)await Promise.all(missing.slice(at,at+5).map(async f=>{let event=await this.json('files/'+encodeURIComponent(f.id)+'?alt=media');this.events.set(f.id,event)}));
  let current=new Set(files.map(f=>f.id));for(let key of this.events.keys())if(!current.has(key)){let metadata=await this.json('files/'+encodeURIComponent(key)+'?fields=trashed');if(metadata.trashed)throw Error('Notebook change files were removed from Drive. Restore them before syncing; local records have been kept.');}
  this.last=KitchenDomain.replay(this.root.state,[...this.events.values()],KITCHEN_INITIAL_STATE,KITCHEN_DEMO_RECIPES);
  return this.last.state;
 },
 async operation(op){
  await this.pull();
  let existing=[...this.events.values()].find(e=>e.operation.id===op.id);
  if(!existing){
   KitchenDomain.apply(this.last.state,op,op.actor||this.profile.display,KITCHEN_INITIAL_STATE,KITCHEN_DEMO_RECIPES);
   op.driveClock??=this.last.clock+1;op.driveFileId??=await this.generatedId();await save();
   let event={format:'Kitchen Notebook change v1',clock:op.driveClock,actor:op.actor||this.profile.display,operation:op};
   await this.upload({id:op.driveFileId,name:'change-'+op.id+'.json',parents:[this.root.folderId],mimeType:'application/json',appProperties:{kitchenType:'change'}},event);
   this.events.set(op.driveFileId,event);
  }
  let latest=await this.pull(),rejected=this.last.rejected.find(x=>x.op.id===op.id);
  if(rejected){let e=new Error(rejected.error);e.status=409;throw e}return latest;
 },
 async api(path,data){
  if(path==='import/text')return parseTextOffline(data.text);
  if(path==='import/url')return DriveRecipeReader.read(data.url);
  if(path==='me'){if(!this.profile||!this.connected()) {let e=new Error('Connect Google Drive.');e.status=401;throw e}return {...this.profile,household:this.settings.rootId}}
  if(path==='state'||path==='export')return this.pull();
  if(path==='operation')return this.operation(data.operation);
  if(path==='import/backup/preview'){
   let s=await this.pull();if(s.version!==data.expectedVersion||s.version!==0){let e=new Error('Import into a new, untouched notebook. Existing records will not be replaced.');e.status=409;throw e}if(data.backup?.format!=='Kitchen Notebook backup v1')throw Error('Choose a Kitchen Notebook household backup JSON file.');let valid=KitchenDomain.validateState(data.backup.state,KITCHEN_INITIAL_STATE);return {recipes:valid.recipes.length,pantryItems:new Set([...Object.keys(valid.pantry).filter(k=>valid.pantry[k]>0),...Object.keys(valid.unmeasured).filter(k=>valid.unmeasured[k].length)]).size,dinners:Object.keys(valid.plans).length,groceries:valid.groceries.length,purchased:valid.completed.length};
  }
  if(path==='import/backup'){
   let s=await this.pull();if(data.driveOperation&&[...this.events.values()].some(e=>e.operation.id===data.driveOperation.id)&&!this.last.rejected.some(e=>e.op.id===data.driveOperation.id))return s;if(s.version!==data.expectedVersion) {let e=new Error('Notebook changed. Preview the backup again.');e.status=409;throw e}
   data.driveOperation??={id:crypto.randomUUID(),type:'importBackup',at:new Date().toISOString(),payload:{backup:data.backup},actor:this.profile.display};return this.operation(data.driveOperation);
  }
  if(path==='logout'){this.token=null;this.profile=null;this.root=null;delete this.settings.rootId;this.persist();return {ok:true}}
  throw Error('This action is unavailable in the Drive edition.');
 }
};
function driveScript(url,id){return new Promise((resolve,reject)=>{let old=document.getElementById(id);if(old?.dataset.loaded)return resolve();if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return}let script=document.createElement('script');script.id=id;script.src=url;script.onload=()=>{script.dataset.loaded='1';resolve()};script.onerror=()=>{script.remove();reject(Error('Connect to the internet to load Google sign-in.'))};document.head.append(script)})}

if(DriveStore.config().clientId)driveScript('https://accounts.google.com/gsi/client','googleIdentity').catch(()=>{});
