const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const root=path.resolve(__dirname,'../..'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const value=s.address().port;await new Promise(r=>s.close(r));return value;}
async function wait(check){for(let i=0;i<150;i++){try{const v=await check();if(v)return v;}catch{}await pause(50);}throw Error('Navigation browser check timed out.');}
async function main(){const children=[];let ws;try{
  const appPort=await port(),debugPort=await port();
  children.push(spawn(process.execPath,['backend/scripts/frontendBrowserFixture.mjs'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,FINO_SMOKE_PORT:String(appPort),FINO_BROWSER_MODE:'production'}}));
  const base=`http://127.0.0.1:${appPort}`;await wait(async()=>(await fetch(base)).ok);
  children.push(spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${fs.mkdtempSync(path.join(root,'.tmp/navigation-chrome-'))}`,'about:blank'],{windowsHide:true,stdio:'ignore'}));
  const version=await wait(async()=>(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json());
  const protocol=await(await fetch(`http://127.0.0.1:${debugPort}/json/protocol`)).json();
  const safeArea=protocol.domains.find(d=>d.domain==='Emulation').commands.some(c=>c.name==='setSafeAreaInsets');
  ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0,sessionId;const pending=new Map(),errors=[];
  ws.onmessage=event=>{const v=JSON.parse(event.data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(Error(v.error.message)):p.resolve(v.result);}else if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.text);else if(v.method==='Runtime.consoleAPICalled'&&v.params.type==='error')errors.push(v.params.args.map(item=>item.value??item.description??item.type).join(' '));};
  const send=(method,params={})=>new Promise((resolve,reject)=>{setTimeout(()=>reject(Error('CDP timeout '+method)),8000).unref();const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params,...(sessionId?{sessionId}:{})}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const target=await send('Target.createTarget',{url:'about:blank'});sessionId=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['*fonts.googleapis.com*','*fonts.gstatic.com*']});
  const checks=[],issues=[],contrast=[];
  for(const locale of ['en','uk','de','es','pl','it']){
    await send('Page.navigate',{url:base});await wait(()=>evaluate(`document.documentElement.dataset.startup==='ready'`));
    await evaluate(`localStorage.setItem('fino-language','${locale}')`);
    await send('Page.navigate',{url:base+'/?locale='+locale});await wait(()=>evaluate(`location.search==='?locale=${locale}'&&document.documentElement.dataset.startup==='ready'`));
    for(const width of [320,360,520,700,701,768,1440])for(const theme of ['dark','light','monochromatic','analog'])for(const mode of ['investment','wallet']){
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=700});
      if(safeArea)await send('Emulation.setSafeAreaInsets',{insets:{top:0,left:0,right:0,bottom:width<=700?28:0}});
      await evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('#open-${mode==='wallet'?'wallet':'investments'}').click();`);
      await pause(20);
      await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');await pause(15);
      const result=await evaluate(`(() => {
        const bar=document.querySelector('#mobile-bottom-nav'),shell=document.querySelector('${mode==='wallet'?'#wallet-app':'#investments-app'}'),old=shell.querySelector('.nav'),main=shell.querySelector('.main'),page=main.querySelector('.${mode==='wallet'?'wallet-page':'page-section'}.active');
        const rect=bar.getBoundingClientRect(),buttons=[...bar.querySelectorAll('button')];
        const pixel=color=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
        const lum=color=>pixel(color).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
        const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        const active=bar.querySelector('.active'),inactive=bar.querySelector('button:not(.active)'),activeStyle=getComputedStyle(active),iconStyle=getComputedStyle(active.querySelector('.mobile-nav-icon'));
        const contrasts={label:ratio(activeStyle.color,activeStyle.backgroundColor),icon:ratio(iconStyle.color,activeStyle.backgroundColor),inactive:ratio(getComputedStyle(inactive).color,getComputedStyle(bar).backgroundColor)};
        const modeRect=shell.querySelector('.app-mode-switch').getBoundingClientRect(),settings=shell.querySelector('.sidebar-settings-button').getBoundingClientRect();
        return {barVisible:getComputedStyle(bar).display!=='none',oldVisible:getComputedStyle(old).display!=='none',overflow:document.documentElement.scrollWidth>innerWidth+1,mode:bar.dataset.mode,buttons:buttons.length,barHeight:rect.height,bottom:rect.bottom,padding:parseFloat(getComputedStyle(main).paddingBottom),lastBottom:page.lastElementChild.getBoundingClientRect().bottom,barTop:rect.top,clipped:buttons.filter(b=>b.scrollWidth>b.clientWidth+1||b.scrollHeight>b.clientHeight+1).length,safePadding:parseFloat(getComputedStyle(bar).paddingBottom),headerRow:Math.abs((modeRect.top+modeRect.height/2)-(settings.top+settings.height/2))<2,contrasts};
      })()`);
      checks.push({locale,width,theme,mode,...result});
      if(width<=700&&(!result.headerRow||result.contrasts.label<4.5||result.contrasts.inactive<4.5||result.contrasts.icon<3))issues.push({locale,width,theme,mode,headerRow:result.headerRow,contrasts:result.contrasts});
      if(width<=700?(!result.barVisible||result.oldVisible||result.overflow||result.mode!==mode||result.buttons!==(mode==='investment'?6:5)||result.clipped||result.lastBottom>result.barTop-5||result.padding<result.barHeight+8||safeArea&&result.safePadding<28):(result.barVisible||!result.oldVisible))issues.push({locale,width,theme,mode,...result});
      if(width===360&&locale==='uk'&&mode==='investment'){
        await evaluate('window.scrollTo(0,0)');await pause(20);
        if(['dark','light'].includes(theme)){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`.tmp/mobile-nav-${theme}.png`,Buffer.from(shot.data,'base64'));}
      }
      if(width<=700){
        await evaluate(`document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click()`);await pause(190);
        const popup=await evaluate(`(() => {
          const menu=document.querySelector('#mobile-more-sheet'),rect=menu.getBoundingClientRect(),more=document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]'),anchor=more.getBoundingClientRect();
          return {top:rect.top,left:rect.left,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,anchorTop:anchor.top,anchorRight:anchor.right,items:menu.querySelectorAll('[role="menuitem"]').length,itemHeights:[...menu.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height),moreClickable:more.contains(document.elementFromPoint(anchor.x+anchor.width/2,anchor.y+anchor.height/2)),background:getComputedStyle(document.querySelector('#mobile-more-backdrop')).backgroundColor};
        })()`);
        if(popup.width<220||popup.width>260||popup.left<10||popup.top<10||popup.bottom>popup.anchorTop-3||Math.abs(popup.right-popup.anchorRight)>2||popup.items!==(mode==='investment'?3:1)||popup.itemHeights.some(h=>h<47)||!popup.moreClickable||popup.background!=='rgba(0, 0, 0, 0)')issues.push({locale,width,theme,mode,popup});
        if(width===360&&locale==='uk'&&mode==='investment'&&['dark','light'].includes(theme)){
          await evaluate('window.scrollTo(0,0)');
          const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(`.tmp/mobile-more-${theme}.png`,Buffer.from(shot.data,'base64'));
        }
        await evaluate('history.back()');await wait(()=>evaluate(`document.querySelector('#mobile-more-backdrop').hidden&&!history.state?.finoMobileMore`));
      }
    }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('#open-investments').click()`);
  await wait(()=>evaluate(`document.querySelector('#mobile-bottom-nav').dataset.mode==='investment'`));
  await evaluate(`document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click();`);await pause(30);
  const clickAt=async(x,y)=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
  const anchor=await evaluate(`(() => {const r=document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await clickAt(anchor.x,anchor.y);
  await wait(()=>evaluate(`document.querySelector('#mobile-more-backdrop').hidden&&!history.state?.finoMobileMore`));
  await clickAt(anchor.x,anchor.y);
  await wait(()=>evaluate(`!document.querySelector('#mobile-more-backdrop').hidden`));
  await clickAt(5,100);
  await wait(()=>evaluate(`document.querySelector('#mobile-more-backdrop').hidden&&!history.state?.finoMobileMore`));
  for(const height of [180,240]){
    await send('Emulation.setDeviceMetricsOverride',{width:360,height,deviceScaleFactor:1,mobile:true});
    await evaluate(`document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click();`);await pause(190);
    const small=await evaluate(`(() => {const r=document.querySelector('#mobile-more-sheet').getBoundingClientRect(),items=document.querySelector('#mobile-more-items').getBoundingClientRect();return {top:r.top,bottom:r.bottom,itemsBottom:items.bottom};})()`);
    if(small.top<10||small.itemsBottom>small.bottom)issues.push({height,small});
    await evaluate('history.back()');await wait(()=>evaluate(`document.querySelector('#mobile-more-backdrop').hidden&&!history.state?.finoMobileMore`));
  }
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('#mobile-bottom-nav [data-mobile-route="more"]').click();`);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await evaluate(`getComputedStyle(document.querySelector('#mobile-more-sheet')).animationName==='none'`);
  await send('Emulation.setDeviceMetricsOverride',{width:1024,height:800,deviceScaleFactor:1,mobile:false});
  await wait(()=>evaluate(`document.querySelector('#mobile-more-backdrop').hidden&&!document.querySelector('#investments-app').inert`));
  if(!await evaluate(`document.activeElement.matches('#investments-app .nav-item.active')`))issues.push({focusAfterResize:false});
  fs.writeFileSync('.tmp/mobile-navigation-browser-results.json',JSON.stringify({checks,issues,errors,safeArea,reduced},null,2));
  console.log(JSON.stringify({checks:checks.length,issues:issues.slice(0,12),issueCount:issues.length,runtimeErrors:errors,safeArea,reduced}));
  if(issues.length||errors.length||!reduced)process.exitCode=1;
}finally{ws?.close();for(const child of children.reverse())child.kill();}}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
