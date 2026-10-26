// Build-only adapter. Keep shared sources CommonJS-compatible for the backend,
// but compile their original browser branches into an explicit ESM graph.
const path = require('node:path');
const espree = require('espree');
const owners = {
  FinoErrors:'errors.js', FinoOperations:'operations.js', FinoSyncModel:'sync-model.js',
  FinoStateContract:'state-contract.js', FinoStateModel:'state-model.js',
  FinoPortfolioTransfer:'portfolio-transfer.js', FinoMarketModel:'market-model.js',
  FinoConstants:'constants.js', FinoValidation:'validation.js', FinoRequest:'request.js',
  FinoOperationValidation:'portfolio/validation.js', FinoPortfolioCalculations:'portfolio/calculations.js',
  FinoPortfolioNormalization:'portfolio/normalization.js', FinoPortfolioOperations:'portfolio/operations.js',
  FinoPortfolioRules:'portfolio-rules.js',
};
const parse = source => espree.parse(source,{ecmaVersion:'latest',range:true});
function walk(node, visit, parent=null) { if(!node||typeof node!=='object')return; if(node.type)visit(node,parent); for(const [key,value]of Object.entries(node))if(key!=='range'){if(Array.isArray(value))value.forEach(child=>walk(child,visit,node));else if(value&&typeof value==='object')walk(value,visit,node);} }
function transformShared(source, relative) {
  const owner=Object.keys(owners).find(name=>owners[name]===relative);
  if(!owner)throw Error('Unreviewed shared browser module: '+relative);
  // Resolve only the platform selection, never rewrite a financial function.
  for(;;){
    let replacement;
    walk(parse(source),node=>{
      if(replacement)return;
      if(['IfStatement','ConditionalExpression'].includes(node.type)&&/typeof\s+module/.test(source.slice(...node.test.range))){
        replacement={range:node.range,text:node.alternate?source.slice(...node.alternate.range):''};
      }
    });
    if(!replacement)break;
    source=source.slice(0,replacement.range[0])+replacement.text+source.slice(replacement.range[1]);
  }
  const dependencies=new Set();
  const ast=parse(source),call=ast.body.find(n=>n.type==='ExpressionStatement').expression;
  walk(ast,(node,parent)=>{
    if(node.type==='MemberExpression'&&node.object?.name==='root'&&!node.computed&&owners[node.property.name]){
      if(parent?.type==='AssignmentExpression'&&parent.left===node)return;
      if(node.property.name!==owner)dependencies.add(node.property.name);
    }
  });
  const first=call.arguments[0];
  source=source.slice(0,first.range[0])+'browser'+source.slice(first.range[1]);
  const imports=[...dependencies].map(name=>{
    const target=path.posix.relative(path.posix.dirname(relative),owners[name]);
    return `import ${name} from '${target.startsWith('.')?target:'./'+target}';`;
  }).join('\n');
  const platform = relative === 'request.js' ? 'fetch: (...args) => globalThis.fetch(...args), ' : '';
  return `${imports}\nconst browser = Object.create(globalThis);\nObject.assign(browser, { ${platform}${[...dependencies].join(', ')} });\n${source}\nexport default browser.${owner};\n`;
}
function sharedBrowserPlugin(root) {
  const directory=path.resolve(root,'shared')+path.sep;
  return { name:'fino-shared-browser-branches',enforce:'pre',
    transform(source,id){
      const filename=path.resolve(id.split('?')[0]);
      if(filename===path.resolve(root,'frontend/vendor/chart.umd.js'))return {code:`const vendorModule = { exports: {} };\n(function(module, exports) {\n${source}\n})(vendorModule, vendorModule.exports);\nexport default vendorModule.exports;\n`,map:null};
      if(!filename.startsWith(directory))return;
      return {code:transformShared(source,path.relative(directory,filename).split(path.sep).join('/')),map:null};
    },
  };
}
module.exports={owners,transformShared,sharedBrowserPlugin};
