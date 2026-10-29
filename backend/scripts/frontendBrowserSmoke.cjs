const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const root=path.resolve(__dirname,'../..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function waitFor(check,label='browser startup/action'){for(let i=0;i<200;i++){const value=await check().catch(()=>false);if(value)return value;await pause(40);}throw Error(label+' did not complete.');}
async function main(){
  const children=[];let ws;
  try{
    const debugPort=await port();
    const chrome=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    children.push(spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${fs.mkdtempSync(path.join(root,'.tmp/modules-chrome-'))}`,'about:blank'],{windowsHide:true,stdio:'ignore'}));
    const version=await waitFor(async()=>{const response=await fetch(`http://127.0.0.1:${debugPort}/json/version`,{signal:AbortSignal.timeout(800)});return response.json();});
    ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let id=0,sessionId;const pending=new Map(),errors=[];
    ws.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);pending.delete(value.id);value.error?item.reject(Error(value.error.message)):item.resolve(value.result);}else if(value.method==='Runtime.exceptionThrown')errors.push(value.params.exceptionDetails.exception?.description?.split('\n').slice(0,2).join(' ')||value.params.exceptionDetails.text);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{setTimeout(()=>reject(Error('CDP timeout: '+method)),10000).unref();const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params,...(sessionId?{sessionId}:{})}));});
    const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
    const target=await send('Target.createTarget',{url:'about:blank'});sessionId=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
    await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
    await send('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
    const report={samples:[],flows:[],errors};
    const modes=process.argv.includes('--compare')?['baseline','production','dev']:['production','dev'];
    for(const mode of modes){
      console.log('Checking browser mode: '+mode);
      const appPort=await port();
      const child=spawn(process.execPath,['backend/scripts/frontendBrowserFixture.mjs'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,FINO_SMOKE_PORT:String(appPort),FINO_BROWSER_MODE:mode}});children.push(child);
      let serverError='';child.stderr.on('data',chunk=>{serverError+=chunk.toString();});
      const base=`http://127.0.0.1:${appPort}`;
      try{await waitFor(async()=>(await fetch(base+'/',{signal:AbortSignal.timeout(800)})).ok);}catch{throw Error('Fixture failed in '+mode+': '+serverError.slice(0,500));}
      for(let run=0;run<(mode==='dev'?1:3);run++){
        await send('Page.navigate',{url:base+'/?run='+run});
        try { await waitFor(()=>evaluate(`document.querySelector('#wallet-current-body tr')&&document.querySelector('#dashboard-assets')?.textContent.includes('Smoke Stock')`),mode+' initial data'); }
        catch(error) { console.error(JSON.stringify({runtimeErrors:errors,...await evaluate(`({startup:document.documentElement.dataset.startup,notice:document.querySelector('#notice-message')?.textContent,budgetRows:document.querySelectorAll('#wallet-current-body tr').length,assetRows:document.querySelector('#dashboard-assets')?.textContent.slice(0,100)})`)})); throw error; }
        const result=await evaluate(`({readyMs:performance.now(),scripts:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script').length,jsBytes:performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script').reduce((n,r)=>n+r.decodedBodySize,0),startup:document.documentElement.dataset.startup,globals:['stateStore','ui','FinoErrors','mobileApi'].filter(name=>Object.hasOwn(window,name))})`);
        report.samples.push({mode,run,...result});
        if(mode!=='baseline'&&(result.startup!=='ready'||result.globals.length))throw Error('Module startup/global isolation failed in '+mode);
      }
      if(mode==='baseline'){child.kill();continue;}
      await evaluate(`document.querySelector('#open-investments').click();document.querySelector('[data-section="calendar"]').click();`);
      if(!await evaluate(`document.querySelector('#calendar-section').classList.contains('active')&&document.querySelectorAll('#calendar-grid .calendar-day').length>=28`))throw Error('Calendar navigation failed.');
      await evaluate(`document.querySelector('#open-wallet').click();`);
      await fetch(base+'/__fixture/fail-wallet/true',{method:'POST'});
      await evaluate(`(() => {const input=document.querySelector('[data-wallet-plan="Health"]');input.value='250';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await waitFor(()=>evaluate(`document.querySelector('#notice-modal').classList.contains('open')`));
      if((await(await fetch(base+'/__fixture/state')).json()).wallet.months[await evaluate(`document.querySelector('#wallet-current-month').value`)]?.plans?.Health===250)throw Error('Failed save changed stored finances.');
      if(await evaluate(`document.querySelector('[data-wallet-plan="Health"]').value`)!=='250')throw Error('Failed save lost the draft.');
      await fetch(base+'/__fixture/fail-wallet/false',{method:'POST'});
      await evaluate(`document.querySelector('#notice-ok').click();document.querySelector('[data-wallet-plan="Health"]').dispatchEvent(new Event('change',{bubbles:true}));`);
      const month=await evaluate(`document.querySelector('#wallet-current-month').value`);
      await waitFor(async()=>(await(await fetch(base+'/__fixture/state')).json()).wallet.months[month]?.plans?.Health===250);
      report.flows.push({mode,calendar:true,failedSavePreservedState:true,retryStoredPlan:250});
      child.kill();
    }
    console.log('Checking bundled offline-native startup and persisted restart');
    const nativePort=await port(),nativeBase=`http://127.0.0.1:${nativePort}`;
    const nativeServer=spawn(process.execPath,['backend/scripts/frontendBrowserFixture.mjs'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,FINO_SMOKE_PORT:String(nativePort),FINO_BROWSER_MODE:'production'}});children.push(nativeServer);
    await waitFor(async()=>(await fetch(nativeBase+'/',{signal:AbortSignal.timeout(800)})).ok);
    const model=require('../../shared/state-model');
    const nativeData={...model.createEmptyState(),assets:[{id:'stock',name:'Smoke Stock',type:'stock',quantity:2,purchasePrice:100,currentPrice:120,purchaseDate:'2026-01-01',currency:'USD'}],transactions:[{id:'buy',assetId:'stock',type:'BUY',quantity:2,amount:200,date:'2026-01-01',currency:'USD'}]};
    const storageKey='fino-data-v1:smoke%40example.com';
    const preload=entries=>`(() => {
      const storage=new Map(${JSON.stringify(entries)});
      window.__fixtureNativeStorage={entries:()=>[...storage],read:key=>storage.get(key)};
      window.Capacitor={isNativePlatform:()=>true,Plugins:{FinoStorage:{get:async({key})=>({value:storage.get(key)||null}),set:async({key,value})=>{storage.set(key,value);},remove:async({key})=>{storage.delete(key);}},GoogleDriveAuth:{getAccessToken:async()=>{throw Object.assign(new Error('Offline fixture'),{code:'AUTHORIZATION_REQUIRED'});}}}};
      window.fetch=async()=>{throw new TypeError('Offline native fixture');};
    })()`;
    let initialization=(await send('Page.addScriptToEvaluateOnNewDocument',{source:preload([['fino-active-account','smoke@example.com'],[storageKey,JSON.stringify(nativeData)]])})).identifier;
    await send('Page.navigate',{url:nativeBase+'/'});
    await waitFor(()=>evaluate(`document.documentElement.dataset.startup==='ready'&&document.querySelector('#dashboard-assets')?.textContent.includes('Smoke Stock')`),'offline-native startup');
    await evaluate(`(() => {const input=document.querySelector('[data-wallet-plan="Health"]');input.value='250';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const nativeMonth=await evaluate(`document.querySelector('#wallet-current-month').value`);
    await waitFor(()=>evaluate(`JSON.parse(window.__fixtureNativeStorage.read('${storageKey}')).wallet.months['${nativeMonth}']?.plans?.Health===250`),'offline-native persistence');
    const persisted=await evaluate('window.__fixtureNativeStorage.entries()');
    await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:initialization});
    initialization=(await send('Page.addScriptToEvaluateOnNewDocument',{source:preload(persisted)})).identifier;
    await send('Page.navigate',{url:nativeBase+'/native-restart'});
    await waitFor(()=>evaluate(`document.documentElement.dataset.startup==='ready'&&Number(document.querySelector('[data-wallet-plan="Health"]')?.value)===250`),'offline-native restart');
    if(await evaluate(`['stateStore','ui','FinoErrors','mobileApi'].some(name=>Object.hasOwn(window,name))`))throw Error('Offline-native startup leaked application globals.');
    report.flows.push({mode:'offline-native',localCodeAndData:true,restartStoredPlan:250});
    await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:initialization});
    fs.writeFileSync(path.join(root,'.tmp/modules-browser-results.json'),JSON.stringify(report,null,2));
    if(errors.length)throw Error('Unexpected browser runtime exceptions: '+errors.join(', '));
    console.log(JSON.stringify(report));
  }finally{ws?.close();for(const child of children.reverse())child.kill();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
