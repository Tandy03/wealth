const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {owners}=require('../scripts/sharedBrowserModules.cjs');
const {loadModules}=require('./helpers/frontendModules');
const {prepareAssets,verifyAssets}=require('../scripts/mobileAssets');
const {writeBuildInfo}=require('../scripts/frontendBuildInfo.cjs');
const root=path.resolve(__dirname,'../..');
const shared=path.join(root,'shared');
const browserScripts=Object.values(owners).map(file=>'/shared/'+file);
test('canonical shared modules remain usable in Node without any browser dependency',()=>{
  const code=`for(const name of ['window','document','localStorage'])Object.defineProperty(globalThis,name,{get(){throw Error('Browser dependency')}});for(const file of ${JSON.stringify(Object.values(owners).map(file=>path.join(shared,file)))})require(file);const model=require(${JSON.stringify(path.join(shared,'state-model'))});model.validateState(model.createEmptyState());require(${JSON.stringify(path.join(shared,'validation'))}).createDefault().validateIdentifier('asset');`;
  execFileSync(process.execPath,['-e',code],{stdio:'pipe'});
});
test('obsolete browser shims have no remaining consumers or packaged resources',()=>{
  for(const file of Object.values(owners))assert.equal(fs.existsSync(path.join(root,'frontend/js',file)),false,file);
  for(const file of Object.values(owners))assert.doesNotMatch(fs.readFileSync(path.join(shared,file),'utf8'),/require\(['"][^'"]*frontend\//);
});
test('compiled browser shared branches preserve financial results, checksums and validation',async()=>{
  const context=vm.createContext({URL,URLSearchParams,TextEncoder,crypto:require('node:crypto').webcrypto});
  const {sharedModules:modules}=loadModules(context);
  const data={assets:[{id:'a',type:'stock',quantity:15,purchasePrice:100,purchaseDate:'2026-01-01'}],transactions:[{assetId:'a',type:'BUY',quantity:10,amount:1000,date:'2026-01-01'},{assetId:'a',type:'BUY',quantity:5,amount:1000,date:'2026-03-01'}],sales:[{assetId:'a',quantity:5,costBasis:500,sellDate:'2026-02-01'}],payments:[]};
  const value=modules.FinoPortfolioRules.holdingsAtDate(data,'a','2026-04-01');
  assert.deepEqual(JSON.parse(JSON.stringify(value)),require('../../shared/portfolio-rules').holdingsAtDate(data,'a','2026-04-01'));
  assert.equal(value.remainingQuantity,10);assert.equal(value.remainingCost,1500);assert.equal(value.averagePrice,150);
  assert.equal(await modules.FinoSyncModel.checksum(data),await require('../../shared/sync-model').checksum(data));
  modules.FinoStateModel.validateState(modules.FinoStateModel.createEmptyState());
  assert.throws(()=>modules.FinoValidation.validateIdentifier(''),error=>error instanceof modules.FinoErrors.ValidationError&&error.status===400);
});
test('the browser shared adapter retains native request concurrency limits',async()=>{
  const releases=[];
  const context=vm.createContext({URL,URLSearchParams,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:require('node:crypto').webcrypto,fetch:()=>new Promise(resolve=>releases.push(()=>resolve({ok:true,json:async()=>({values:[]})})))});
  const {FinoRequest}=loadModules(context).sharedModules;
  const pending=Array.from({length:6},()=>FinoRequest.fetchWithTimeout('https://provider.test/data'));
  await assert.rejects(FinoRequest.fetchWithTimeout('https://provider.test/data'),{code:'PROVIDER_RATE_LIMITED'});
  releases.forEach(release=>release());
  for(const response of await Promise.all(pending))await response.json();
});
test('mobile preparation copies only a verified build and rejects missing, stale or extra resources',t=>{
  const fixture=fs.mkdtempSync(path.join(root,'.tmp/module-package-test-'));
  t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
  for(const directory of ['frontend','shared','.tmp/frontend-dist/assets'])fs.mkdirSync(path.join(fixture,directory),{recursive:true});
  fs.writeFileSync(path.join(fixture,'frontend/index.html'),'<script type="module" src="/js/main.js"></script>');
  fs.writeFileSync(path.join(fixture,'shared/fixture.js'),'source');
  const built=path.join(fixture,'.tmp/frontend-dist');
  fs.writeFileSync(path.join(built,'index.html'),'<script type="module" src="/assets/main.js"></script>');
  fs.writeFileSync(path.join(built,'assets/main.js'),'export const compiled=true;');
  assert.throws(()=>prepareAssets(fixture));
  writeBuildInfo(fixture,built);
  const {destination}=prepareAssets(fixture);
  assert.equal(verifyAssets(fixture,destination).length,3);
  fs.appendFileSync(path.join(destination,'assets/main.js'),'stale');
  assert.throws(()=>verifyAssets(fixture,destination),/outdated/);
  prepareAssets(fixture);fs.writeFileSync(path.join(destination,'obsolete.js'),'');
  assert.throws(()=>verifyAssets(fixture,destination),/stale/);
  prepareAssets(fixture);fs.appendFileSync(path.join(fixture,'shared/fixture.js'),'changed');
  assert.throws(()=>verifyAssets(fixture,destination),/outdated/);
});
test('the web serves compiled modules and missing assets never fall back to HTML or private files',async t=>{
  t.mock.method(console,'info',()=>{});
  const server=require('../app').createApp({repository:{}}).listen(0,'127.0.0.1');
  await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const page=await fetch(base+'/');const html=await page.text();
  const entry=html.match(/<script[^>]*src="([^"]+)"/)[1];
  const response=await fetch(base+entry);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(root,'.tmp/frontend-dist',entry)));
  for(const script of browserScripts){const resource=await fetch(base+script);assert.equal(resource.status,200);assert.deepEqual(Buffer.from(await resource.arrayBuffer()),fs.readFileSync(path.join(root,script)));}
  for(const resource of ['/assets/missing.js','/js/main.js','/shared/missing.js','/shared/.env','/shared/%2e%2e%2fpackage.json','/shared/']){const result=await fetch(base+resource);assert.equal(result.status,404,resource);assert.equal((await result.json()).code,'NOT_FOUND');}
});
