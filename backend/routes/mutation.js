// All routers share the repository queue, including sync downloads.
function serializeMutation(repository, handler) {
    return (req, res, next) => {
        repository.runMutation(() => handler(req, res, next)).catch(next);
    };
}
module.exports = { serializeMutation };
