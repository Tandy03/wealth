// The only application-level entry into the repository mutation queue.
// Wrap a complete use case once; never call another queued command from it.
const { AsyncLocalStorage } = require('node:async_hooks');
const operations = require('../../shared/operations');
const context = new AsyncLocalStorage();
function runMutation(repository, operation) {
    return repository.runMutation(operation);
}
function mutationCommands(repository, handlers) {
    return Object.fromEntries(Object.entries(handlers).map(([name, operation]) => [
        name, (...args) => runMutation(repository, async () => {
            const descriptor = operations.describe(name, args);
            if (!descriptor?.operationId) return operation(...args);
            const data = await require('./readState').createStateReader(repository)();
            const receipt = operations.begin(data, descriptor);
            if (receipt.replayed) return receipt.result;
            const result = await context.run({ repository, data }, () => operation(...args));
            operations.remember(data, receipt, result);
            await repository.saveData(data);
            return result;
        }),
    ]));
}
function commandStorage(repository) {
    const read = require('./readState').createStateReader(repository);
    return {
        readData: () => context.getStore()?.repository === repository ? Promise.resolve(context.getStore().data) : read(),
        saveData: data => {
            const current = context.getStore();
            if (current?.repository !== repository) return repository.saveData(data);
            if (current.data !== data) throw new Error('A command must save its private snapshot.');
            // Receipt and business result are committed together by mutationCommands.
            return Promise.resolve();
        },
    };
}
module.exports = { runMutation, mutationCommands, commandStorage };
