const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function files(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    if(entry.isSymbolicLink())throw Error('Symbolic links are not allowed in frontend resources.');
    const target=path.join(directory,entry.name);
    return entry.isDirectory()?files(target):[target];
  });
}
function sourceDigest(root) {
  const sources=['frontend','shared'].flatMap(directory=>files(path.join(root,directory))).filter(file=>!file.includes(path.sep+'node_modules'+path.sep));
  for(const relative of ['package.json','package-lock.json','vite.config.mjs','backend/scripts/sharedBrowserModules.cjs','backend/scripts/buildFrontend.mjs'])if(fs.existsSync(path.join(root,relative)))sources.push(path.join(root,relative));
  return hash(sources.sort().map(file=>path.relative(root,file).split(path.sep).join('/')+':'+hash(fs.readFileSync(file))).join('\n'));
}
function writeBuildInfo(root,directory) {
  const entries=files(directory).filter(file=>path.basename(file)!=='.fino-build.json').map(file=>({relative:path.relative(directory,file).split(path.sep).join('/'),sha256:hash(fs.readFileSync(file)),size:fs.statSync(file).size}));
  const info={version:1,sourceDigest:sourceDigest(root),files:entries};
  fs.writeFileSync(path.join(directory,'.fino-build.json'),JSON.stringify(info,null,2)+'\n');
  return info;
}
function verifyBuild(root,directory) {
  const info=JSON.parse(fs.readFileSync(path.join(directory,'.fino-build.json'),'utf8'));
  if(info.version!==1||info.sourceDigest!==sourceDigest(root))throw Error('Frontend build is outdated. Run npm run build:frontend and npm run mobile:prepare.');
  for(const entry of info.files) {
    const target=path.resolve(directory,entry.relative);
    if(!target.startsWith(path.resolve(directory)+path.sep)||!fs.existsSync(target)||hash(fs.readFileSync(target))!==entry.sha256)throw Error('Frontend resources are missing or outdated. Run npm run mobile:prepare.');
  }
  if(files(directory).length!==info.files.length+1)throw Error('Frontend resources contain stale files. Run npm run mobile:prepare.');
  return info;
}
module.exports={files,hash,sourceDigest,writeBuildInfo,verifyBuild};
