// Static UI guard only: no runtime wrappers, document cloning or production cost.
// Track borrowed values and shallow copies separately so sorting a local array
// is allowed, while modifying an asset inside that copied array is rejected.
const VALUE = 1, STATE = 2, ITEMS = 4, RESULT = 8, EVENT = 16, CHILDREN = 32;
const mutators = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
const copies = new Set(['filter', 'slice', 'concat', 'toSorted', 'toReversed', 'toSpliced', 'with']);
const iterators = new Set(['forEach', 'map', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every', 'flatMap', 'reduce', 'reduceRight', 'sort', 'toSorted']);
const property = node => node && (node.computed ? node.property.type === 'Literal' ? node.property.value : null : node.property.name);
module.exports = {
  meta: { type: 'problem', schema: [{ type: 'object', properties: { banLegacyReads: { type: 'boolean' } }, additionalProperties: false }], messages: {
    mutation: 'Borrowed financial state is read-only. Use a store command with a private draft.',
    legacyRead: 'Read financial state through an explicit store selector, not the legacy state.data alias.',
  } },
  create(context) {
    const source = context.sourceCode, nodes = [], variables = new WeakMap(), origins = new Map();
    function variable(id) { return variables.get(id); }
    function origin(node) {
      if (!node) return 0;
      switch (node.type) {
        case 'ChainExpression': case 'AwaitExpression': return origin(node.expression || node.argument);
        case 'Identifier': return origins.get(variable(node)) || 0;
        case 'AssignmentExpression': return origin(node.right);
        case 'AssignmentPattern': return origin(node.right);
        case 'LogicalExpression': return origin(node.left) | origin(node.right);
        case 'ConditionalExpression': return origin(node.consequent) | origin(node.alternate);
        case 'SequenceExpression': return origin(node.expressions.at(-1));
        case 'ArrayExpression': return node.elements.some(item => item?.type === 'SpreadElement' && origin(item.argument)) ? ITEMS : 0;
        case 'ObjectExpression': return node.properties.some(item => item.type === 'SpreadElement' && origin(item.argument) & VALUE) ? CHILDREN : 0;
        case 'MemberExpression': {
          const base = origin(node.object), key = property(node);
          if (base & STATE && key === 'data') return VALUE;
          if (base & RESULT && ['data', 'value'].includes(key)) return VALUE;
          if (base & EVENT && key === 'state') return STATE;
          if (base & CHILDREN) return VALUE;
          if (base & VALUE || base & ITEMS && node.computed) return VALUE;
          // A new object owns its fields, but spreading it does not clone children.
          if (node.object.type === 'ObjectExpression') {
            for (const field of [...node.object.properties].reverse()) {
              if (field.type === 'SpreadElement' && origin(field.argument) & VALUE) return VALUE;
              if (field.type === 'Property' && (field.key.name || field.key.value) === key) return origin(field.value);
            }
          }
          return 0;
        }
        case 'CallExpression': {
          const callee = node.callee.type === 'ChainExpression' ? node.callee.expression : node.callee;
          if (callee.type === 'Identifier' && callee.name === 'selectData') return VALUE;
          if (callee.type !== 'MemberExpression') return 0;
          const method = property(callee);
          if (['stateStore', 'store'].includes(callee.object.name)) {
            if (method === 'getState' || method === 'setUI') return STATE;
            if (['getData', 'replaceData', 'updateData', 'selectData', 'selectAssets', 'selectTransactions', 'selectPayments', 'selectSales', 'selectWallet', 'selectRebalance', 'selectCalendarNotes', 'selectPriceHistory', 'selectInstruments'].includes(method)) return VALUE;
            if (['loadData', 'saveWallet', 'saveRebalance'].includes(method)) return RESULT;
            if (method === 'select') return returned(node.arguments[0]);
          }
          const base = origin(callee.object);
          if (base & (VALUE | ITEMS)) {
            if (copies.has(method)) return ITEMS;
            if (['find', 'findLast', 'at', 'pop', 'shift'].includes(method)) return VALUE;
            if (method === 'map' || method === 'flatMap') return returned(node.arguments[0]) & VALUE ? ITEMS : 0;
            if (method === 'reduce' || method === 'reduceRight') return returned(node.arguments[0]) | origin(node.arguments[1]);
          }
          if (callee.object.name === 'Object' && ['values', 'entries'].includes(method) && origin(node.arguments[0]) & VALUE) return ITEMS;
          return 0;
        }
        default: return 0;
      }
    }
    function returned(fn) {
      if (!fn || !['ArrowFunctionExpression', 'FunctionExpression'].includes(fn.type)) return 0;
      if (fn.body.type !== 'BlockStatement') return origin(fn.body);
      let value = 0;
      for (const node of nodes) if (node.type === 'ReturnStatement') {
        let owner = node.parent;
        while (owner && !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(owner.type)) owner = owner.parent;
        if (owner === fn) value |= origin(node.argument);
      }
      return value;
    }
    let changed;
    function bind(pattern, value) {
      if (!pattern || !value) return;
      if (pattern.type === 'Identifier') {
        const key = variable(pattern);
        if (key && ((origins.get(key) || 0) | value) !== origins.get(key)) { origins.set(key, (origins.get(key) || 0) | value); changed = true; }
      } else if (pattern.type === 'AssignmentPattern') bind(pattern.left, value | origin(pattern.right));
      else if (pattern.type === 'RestElement') bind(pattern.argument, value & (VALUE | ITEMS) ? ITEMS : 0);
      else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(item => bind(item, value & (VALUE | ITEMS) ? VALUE : 0));
      else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(field => {
        if (field.type === 'RestElement') {
          bind(field.argument, value & (VALUE | CHILDREN) ? CHILDREN : 0);
          return;
        }
        const key = field.key.name || field.key.value;
        let borrowed = 0;
        if (value & (VALUE | CHILDREN)) borrowed = VALUE;
        else if (value & STATE && key === 'data' || value & RESULT && ['data', 'value'].includes(key)) borrowed = VALUE;
        else if (value & EVENT && key === 'state') borrowed = STATE;
        bind(field.value, borrowed);
      });
    }
    const report = node => context.report({ node, messageId: 'mutation' });
    function writableTarget(target) {
      if (!target) return;
      if (target.type === 'MemberExpression') {
        const base = origin(target.object);
        if (base & VALUE || base & STATE && property(target) === 'data') report(target);
      } else if (target.type === 'ObjectPattern') target.properties.forEach(field => writableTarget(field.value || field.argument));
      else if (target.type === 'ArrayPattern') target.elements.forEach(writableTarget);
      else if (target.type === 'AssignmentPattern' || target.type === 'RestElement') writableTarget(target.left || target.argument);
    }
    return {
      '*': node => { nodes.push(node); },
      'Program:exit'() {
        for (const scope of source.scopeManager.scopes) for (const item of scope.variables) {
          for (const id of item.identifiers) variables.set(id, item);
          for (const ref of item.references) variables.set(ref.identifier, item);
          // Legacy/global state and render snapshot parameters are borrowed UI state.
          if (item.name === 'state' && !item.defs.length || item.defs.some(def => def.type === 'Parameter' && ['state', 'snapshot'].includes(item.name))) origins.set(item, STATE);
        }
        // Monotone dataflow reaches a fixed point even for aliases declared later.
        do {
          changed = false;
          for (const node of nodes) {
            if (node.type === 'VariableDeclarator') bind(node.id, origin(node.init));
            if (node.type === 'AssignmentExpression' && node.operator === '=') bind(node.left, origin(node.right));
            if (node.type === 'AssignmentPattern') bind(node.left, origin(node.right));
            if (node.type === 'ForOfStatement') bind(node.left.type === 'VariableDeclaration' ? node.left.declarations[0].id : node.left, origin(node.right) & (VALUE | ITEMS) ? VALUE : 0);
            if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') continue;
            const method = property(node.callee), base = origin(node.callee.object), fn = node.arguments[0];
            if (method === 'select' && ['stateStore', 'store'].includes(node.callee.object.name)) bind(fn?.params?.[0], STATE);
            if (method === 'subscribe' && ['stateStore', 'store'].includes(node.callee.object.name)) bind(fn?.params?.[0], EVENT);
            if (base & (VALUE | ITEMS) && iterators.has(method) && fn?.params) {
              const reduce = method === 'reduce' || method === 'reduceRight';
              bind(fn.params[reduce ? 1 : 0], VALUE);
              if (reduce) bind(fn.params[0], origin(node.arguments[1]));
              if (method === 'sort' || method === 'toSorted') bind(fn.params[1], VALUE);
              else bind(fn.params[reduce ? 3 : 2], base);
            }
          }
        } while (changed);
        for (const node of nodes) {
          if (context.options[0]?.banLegacyReads) {
            if (node.type === 'MemberExpression' && origin(node.object) & STATE && property(node) === 'data') context.report({ node, messageId: 'legacyRead' });
            if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && origin(node.init) & STATE && node.id.properties.some(field => (field.key?.name || field.key?.value) === 'data')) context.report({ node, messageId: 'legacyRead' });
          }
          if (node.type === 'AssignmentExpression') writableTarget(node.left);
          if (node.type === 'UpdateExpression' || node.type === 'UnaryExpression' && node.operator === 'delete') writableTarget(node.argument);
          if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') continue;
          const callee = node.callee, method = property(callee), base = origin(callee.object);
          if (base & VALUE && mutators.has(method)) report(node);
          if (['Object', 'Reflect'].includes(callee.object.name) && ['assign', 'defineProperty', 'defineProperties', 'set', 'deleteProperty', 'setPrototypeOf', 'freeze', 'seal', 'preventExtensions'].includes(method)) {
            const target = origin(node.arguments[0]);
            const writesData = ['defineProperty', 'set', 'deleteProperty'].includes(method) ? node.arguments[1]?.value === 'data'
              : node.arguments.slice(1).some(arg => arg.type === 'ObjectExpression' && arg.properties.some(field => (field.key?.name || field.key?.value) === 'data'));
            if (target & VALUE || target & STATE && writesData) report(node);
          }
          if (['normalizeCategories', 'cleanupCategories', 'month'].includes(method) && origin(node.arguments[0]) & VALUE) report(node);
        }
      },
    };
  },
};
