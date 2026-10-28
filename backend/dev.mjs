import { createServer } from 'vite';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
require('./config/loadEnv');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vite=await createServer({configFile:path.join(root,'vite.config.mjs'),configLoader:'native',appType:'custom'});
const app=require('./app').createApp({frontend:{directory:path.join(root,'frontend'),middleware:vite.middlewares,transformHtml:(url,html)=>vite.transformIndexHtml(url,html)}});
const port=Number(process.env.PORT||3000);
let startupFailed=false;
function onStartupError(error){
  if(startupFailed)return;
  startupFailed=true;
  console.error(error.code==='EADDRINUSE'
    ? `Port ${port} is already in use. Stop the other Fino server before running npm run dev.`
    : `Could not start the local dev server: ${error.code||error.message}`);
  process.exitCode=1;
  void vite.close();
}
const server=app.listen(port,'127.0.0.1',error=>{
  if(error){onStartupError(error);return;}
  console.log('Fino with Vite: http://localhost:'+server.address().port);
});
server.on('error',onStartupError);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();void vite.close().then(()=>process.exit());});
