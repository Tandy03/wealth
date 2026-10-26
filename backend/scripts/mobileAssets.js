// Only compiled resources enter Capacitor. No fallback to unbuilt source files.
const fs=require('node:fs');
const path=require('node:path');
const {verifyBuild,files}=require('./frontendBuildInfo.cjs');
function assetEntries(root) {
  const directory=path.resolve(root,'.tmp/frontend-dist');
  verifyBuild(root,directory);
  return files(directory).map(source=>({source,relative:path.relative(directory,source).split(path.sep).join('/')}));
}
function verifyAssets(root,destination) {
  verifyBuild(root,destination);
  const entries=assetEntries(root);
  for(const entry of entries)if(!fs.readFileSync(path.join(destination,entry.relative)).equals(fs.readFileSync(entry.source)))throw Error('Mobile resources are outdated. Run npm run mobile:prepare.');
  return entries;
}
function prepareAssets(root) {
  root=path.resolve(root);
  const destination=path.join(root,'.tmp/mobile-web');
  fs.mkdirSync(path.join(root,'.tmp'),{recursive:true});
  const realRoot=fs.realpathSync(root);
  if(fs.realpathSync(path.join(root,'.tmp'))!==path.join(realRoot,'.tmp'))throw Error('Unsafe mobile staging directory.');
  if(fs.existsSync(destination)&&fs.realpathSync(destination)!==path.join(realRoot,'.tmp/mobile-web'))throw Error('Unsafe mobile staging directory.');
  const entries=assetEntries(root);
  fs.rmSync(destination,{recursive:true,force:true});
  fs.mkdirSync(destination,{recursive:true});
  for(const entry of entries){const target=path.join(destination,entry.relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(entry.source,target);}
  verifyAssets(root,destination);
  return {destination,entries};
}
module.exports={assetEntries,verifyAssets,prepareAssets};
