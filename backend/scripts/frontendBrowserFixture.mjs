// Isolated browser fixture: no real portfolio, provider credentials or Drive I/O.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const model=require('../../shared/state-model');
let data=model.normalizeState({...model.createEmptyState(),assets:[{id:'stock',name:'Smoke Stock',type:'stock',quantity:2,purchasePrice:100,currentPrice:120,purchaseDate:'2026-01-01',currency:'USD'}],transactions:[{id:'buy',assetId:'stock',type:'BUY',quantity:2,amount:200,date:'2026-01-01',currency:'USD'}]});
let queue=Promise.resolve(),failWallet=false;
const repository={readData:async()=>structuredClone(data),readLocalData:async()=>structuredClone(data),saveData:async value=>{data=model.normalizeState(value);},writeLocalData:async value=>{data=model.normalizeState(value);return{savedLocally:true};},runMutation(operation){const result=queue.then(operation);queue=result.catch(()=>{});return result;},drive:{isEnabled:()=>false,getStatus:()=>({enabled:false,connected:false})}};
const app=express();
app.get('/__fixture/state',(_req,res)=>res.json(data));
app.post('/__fixture/fail-wallet/:value',(req,res)=>{failWallet=req.params.value==='true';res.sendStatus(204);});
app.put('/api/wallet',(req,res,next)=>failWallet?res.status(503).json({error:'Storage unavailable.',code:'STORAGE_FAILURE'}):next());
app.get('/api/exchange-rates',(_req,res)=>res.json({rates:{USD:40,EUR:45}}));
app.get('/api/market-data/*path',(_req,res)=>res.json({values:[],currencies:[]}));
app.get('/api/macroeconomics',(_req,res)=>res.json({inflation:{},gdp:{},exchangeRates:[]}));
app.get('/api/macroeconomics/policy-rate',(_req,res)=>res.json({policyRate:[]}));
let vite,frontend;
if(process.env.FINO_BROWSER_MODE==='dev'){
  vite=await createServer({configFile:path.join(root,'vite.config.mjs'),configLoader:'native',appType:'custom',server:{middlewareMode:true,hmr:false}});
  frontend={directory:path.join(root,'frontend'),middleware:vite.middlewares,transformHtml:(url,html)=>vite.transformIndexHtml(url,html)};
}else if(process.env.FINO_BROWSER_MODE==='baseline')frontend={directory:path.join(root,'.tmp/modules-baseline-web/frontend')};
app.use(require('../app').createApp({repository,frontend}));
const server=app.listen(Number(process.env.FINO_SMOKE_PORT||0),'127.0.0.1',()=>console.log('Browser module fixture: '+server.address().port));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();void vite?.close();});
