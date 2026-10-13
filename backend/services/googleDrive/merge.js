const { normalizeState } = require('../../domain/state');

// Without a common ancestor, merging financial records can resurrect deletions
// or duplicate trades. Require an explicit whole-document choice on divergence.
function merge(local, remote, { strategy } = {}) {
  const left = normalizeState(local);
  const right = normalizeState(remote);
  if (JSON.stringify(left) === JSON.stringify(right)) return left;
  if (strategy === 'local') return left;
  if (strategy === 'remote') return right;
  throw new (require('../../../frontend/js/errors').ConflictError)({ code: 'GOOGLE_DRIVE_CONFLICT', message: 'Divergent portfolio snapshots require local or remote conflict resolution.' });
}
module.exports = { merge, resolveConflict: merge };
