// Build-time validation of the real ESM dependency graph. Never used at runtime.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const espree = require('espree');
const { transformShared } = require('./sharedBrowserModules.cjs');
const root = path.resolve(__dirname, '../..');
function walk(node, visit) { if(!node||typeof node!=='object')return;if(node.type)visit(node);for(const [key,value]of Object.entries(node))if(key!=='range'){if(Array.isArray(value))value.forEach(child=>walk(child,visit));else if(value&&typeof value==='object')walk(value,visit);} }
function scriptSources(html) {
  const active=html.replace(/<!--[\s\S]*?(?:-->|$)/g,'');
  const scripts=[...active.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(scripts.length,1,'The page must have exactly one module entry.');
  const [,attributes,inline]=scripts[0];
  assert.equal(inline.trim(),'','Inline frontend scripts are forbidden.');
  assert.match(attributes,/\btype\s*=\s*["']module["']/,'The entry must be an ES module.');
  assert.ok(!/\b(?:async|nomodule)\b/i.test(attributes),'Alternative or asynchronous loading is forbidden.');
  const source=attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  assert.equal(source,'/js/main.js','Only the local module entry is supported.');
  return [source];
}
function sourcePath(source) { return path.resolve(root, source.startsWith('/shared/')?'.':'frontend','.'+source); }
function moduleSource(filename, readSource=filename=>fs.readFileSync(filename,'utf8')) {
  const source=readSource(filename);
  const relative=path.relative(path.join(root,'shared'),filename);
  return !relative.startsWith('..')&&!path.isAbsolute(relative)?transformShared(source,relative.split(path.sep).join('/')):source;
}
function validateGraph(entry,{readSource=filename=>fs.readFileSync(filename,'utf8')}={}) {
  const graph=new Map(),active=new Set(),visited=new Set(),exportsByFile=new Map();
  function visit(filename) {
    filename=path.resolve(filename);
    assert.ok(!active.has(filename),'Circular module dependency: '+path.relative(root,filename));
    if(visited.has(filename))return;
    assert.ok([path.join(root,'frontend')+path.sep,path.join(root,'shared')+path.sep].some(base=>filename.startsWith(base)),'Import escapes frontend/shared resources.');
    active.add(filename);
    if(filename===path.join(root,'frontend/vendor/chart.umd.js')) {readSource(filename);graph.set(filename,[]);active.delete(filename);visited.add(filename);return;}
    const source=moduleSource(filename,readSource);
    const ast=espree.parse(source,{ecmaVersion:'latest',sourceType:'module',range:true});
    const imports=[];
    const names=new Set();
    walk(ast,node=>{
      if(node.type==='ExportDefaultDeclaration')names.add('default');
      if(node.type==='ExportNamedDeclaration') {
        for(const item of node.specifiers||[])names.add(item.exported.name);
        if(node.declaration?.id)names.add(node.declaration.id.name);
        for(const declaration of node.declaration?.declarations||[]) {
          if(declaration.id.type==='Identifier')names.add(declaration.id.name);
          else for(const item of declaration.id.properties||[])names.add(item.value.name);
        }
      }
      if(node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration'&&node.source) {
        assert.ok(node.source?.type==='Literal'&&typeof node.source.value==='string','Imports must be static.');
        imports.push({source:node.source.value,specifiers:node.specifiers||[]});
      }
      assert.notEqual(node.type,'ImportExpression','Dynamic imports require an explicit reviewed loading boundary.');
      if(node.type==='AssignmentExpression'||node.type==='UpdateExpression') {
        const target=node.left||node.argument;
        assert.ok(!(target.type==='MemberExpression'&&['window','globalThis'].includes(target.object?.name)),'Unreviewed browser global write in '+path.relative(root,filename));
      }
      if(node.type==='CallExpression'&&node.callee?.object?.name==='Object'&&['assign','defineProperty','defineProperties'].includes(node.callee.property?.name))assert.ok(!['window','globalThis'].includes(node.arguments[0]?.name),'Unreviewed browser global export.');
      assert.ok(!(node.type==='CallExpression'&&node.callee.name==='require'),'CommonJS is only permitted through the shared build adapter.');
    });
    exportsByFile.set(filename,names);
    const edges=[];
    for(const item of imports) {
      assert.ok(item.source.startsWith('.')&&item.source.endsWith('.js'),'Module imports must name a local .js resource: '+item.source);
      const dependency=path.resolve(path.dirname(filename),item.source);
      edges.push(dependency);visit(dependency);
      for(const specifier of item.specifiers) {
        const requested=specifier.type==='ImportDefaultSpecifier'?'default':specifier.type==='ImportSpecifier'?specifier.imported.name:null;
        if(requested&&dependency!==path.join(root,'frontend/vendor/chart.umd.js'))assert.ok(exportsByFile.get(dependency).has(requested),'Missing module export '+requested+' in '+path.relative(root,dependency));
      }
    }
    graph.set(filename,edges);active.delete(filename);visited.add(filename);
  }
  visit(entry);
  return {entry,files:[...visited],graph};
}
function validateFrontend(html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8'),options) {
  const [entry]=scriptSources(html);
  return validateGraph(sourcePath(entry),options);
}
module.exports={root,scriptSources,sourcePath,moduleSource,validateGraph,validateFrontend};
