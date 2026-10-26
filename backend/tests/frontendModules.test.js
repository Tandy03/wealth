const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {root,sourcePath,validateFrontend}=require('../scripts/frontendContract');
const {verifyBuild}=require('../scripts/frontendBuildInfo.cjs');
const {loadModules}=require('./helpers/frontendModules');
const html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8');
const entry='<script type="module" src="/js/main.js"></script>';
test('one local module entry reaches an acyclic graph with explicit imports and valid exports',()=>{
  const result=validateFrontend(html);
  assert.equal(result.entry,sourcePath('/js/main.js'));
  assert.ok(result.files.length>70);
  assert.ok(result.files.some(file=>file.endsWith(path.join('shared','portfolio','calculations.js'))));
  assert.ok(!result.files.some(file=>file.endsWith('frontend-globals.json')));
  assert.deepEqual(require('../../frontend-globals.json').applicationGlobalWrites,[]);
});
test('entry contract rejects classic, duplicate, missing, remote and inline startup',()=>{
  for(const broken of [html.replace(entry,''),html.replace(entry,`<!-- ${entry} -->`),html.replace('type="module"','async'),html.replace('/js/main.js','https://external.test/main.js'),html.replace(entry,entry+entry),html.replace(entry,'<script>window.leak=true;</script>')])assert.throws(()=>validateFrontend(broken));
});
test('graph validation rejects missing files, missing exports, syntax errors and cycles',()=>{
  const app=sourcePath('/js/app.js'),main=sourcePath('/js/main.js');
  for(const [filename,extra]of [[main,"\nimport './missing-module.js';"],[main,"\nimport { nonexistent } from './app.js';"],[main,'\nexport const = ;'],[app,"\nimport './composition.js';"]]){
    assert.throws(()=>validateFrontend(html,{readSource:file=>fs.readFileSync(file,'utf8')+(file===filename?extra:'')}));
  }
});
test('module scope permits private declarations and rejects new global exports or implicit loaders',()=>{
  const app=sourcePath('/js/app.js');
  const withExtra=extra=>({readSource:file=>fs.readFileSync(file,'utf8')+(file===app?extra:'')});
  assert.doesNotThrow(()=>validateFrontend(html,withExtra('\nconst privateCache = new Map();')));
  for(const extra of ['window.leaked = 1;','globalThis.leaked = 1;','Object.assign(window, {leaked:1});','Object.defineProperty(window,"leak",{value:1});',"require('./hidden');","import('./hidden.js');"])assert.throws(()=>validateFrontend(html,withExtra('\n'+extra)));
});
test('the actual module graph imports without a DOM or application-global side effects',()=>{
  const context=vm.createContext({URL,URLSearchParams,TextEncoder,crypto:require('node:crypto').webcrypto});
  const before=new Set(Object.keys(context));
  const modules=loadModules(context);
  assert.equal(typeof modules.createFrontend,'function');
  assert.deepEqual(Object.keys(context).filter(key=>!before.has(key)),['FinoTestModules']);
  assert.equal(context.stateStore,undefined);assert.equal(context.ui,undefined);assert.equal(context.FinoErrors,undefined);
});
test('the production artifact is complete, current and contains only local critical resources',()=>{
  const directory=path.join(root,'.tmp/frontend-dist');
  const info=verifyBuild(root,directory);
  const built=fs.readFileSync(path.join(directory,'index.html'),'utf8');
  assert.equal([...built.matchAll(/<script\b/g)].length,1);
  assert.match(built,/<script\b[^>]*type="module"/);
  assert.doesNotMatch(built,/<script[^>]*src="https?:/);
  for(const match of built.matchAll(/(?:src|href)="(\/[^"?#]+)/g))assert.ok(info.files.some(file=>'/'+file.relative===match[1]),match[1]);
});
