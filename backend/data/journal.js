const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { atomicWrite } = require('./atomicFile');
const { signature } = require('../../frontend/js/sync-model');
const { validateState } = require('../../frontend/js/state-model');
const digest = snapshot => createHash('sha256').update(signature(snapshot)).digest('hex');
function createJournal(file) {
  let entries = [], loaded = false;
  let serial = Promise.resolve();
  const queued = operation => { const result = serial.then(operation); serial = result.catch(() => {}); return result; };
  async function load() {
    if (loaded) return;
    let raw = '';
    try { raw = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lines = raw.split('\n');
    entries = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      try {
        const entry = JSON.parse(lines[i]);
        if (!['prepare', 'commit', 'confirmed'].includes(entry.kind)) throw new Error('Invalid journal event');
        if (entry.kind === 'prepare') {
          validateState(entry.snapshot);
          if (entry.checksum !== digest(entry.snapshot)) throw new Error('Invalid journal checksum');
        }
        entries.push(entry);
      } catch (error) {
        // Only a torn final append is recoverable; corruption in the middle must not be silently discarded.
        if (i < lines.length - 2 || raw.endsWith('\n')) throw error;
        await atomicWrite(file, entries.map(item => JSON.stringify(item)).join('\n') + (entries.length ? '\n' : ''));
      }
    }
    loaded = true;
  }
  async function append(entry) {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const handle = await fs.open(file, 'a', 0o600);
    const size = (await handle.stat()).size;
    try { await handle.writeFile(JSON.stringify(entry) + '\n'); await handle.sync(); }
    catch (error) {
      try { await handle.truncate(size); await handle.sync(); } catch { /* load() handles a torn final append on retry */ }
      loaded = false;
      throw error;
    }
    finally { await handle.close(); }
    entries.push(entry);
  }
  function commits() {
    const prepared = new Map(entries.filter(e => e.kind === 'prepare').map(e => [e.id, e]));
    return entries.filter(e => e.kind === 'commit' && prepared.has(e.id)).map(e => prepared.get(e.id));
  }
  function last() { return commits().at(-1) || null; }
  function confirmed(snapshot) { return entries.some(e => e.kind === 'confirmed' && e.checksum === digest(snapshot)); }
  async function commit(snapshot, apply, rollback) {
    return queued(async () => {
      await load();
      const entry = { kind: 'prepare', id: randomUUID(), at: new Date().toISOString(), checksum: digest(snapshot), snapshot };
      await append(entry);
      let applied = false;
      try { await apply(); applied = true; await append({ kind: 'commit', id: entry.id }); }
      catch (error) { if (applied && rollback) await rollback(); throw error; }
      // Keep all unconfirmed changes and the latest 50 confirmed snapshots for conflict recovery.
      if (entries.length > 300) {
        const history = commits();
        const lastConfirmed = history.reduce((last, entry, index) => confirmed(entry.snapshot) ? index : last, -1);
        const retained = new Set([...history.slice(lastConfirmed + 1), ...history.slice(-50)].map(e => e.id));
        const checksums = new Set(history.filter(e => retained.has(e.id)).map(e => e.checksum));
        const compacted = entries.filter(e => e.kind === 'confirmed' ? checksums.has(e.checksum) : retained.has(e.id));
        // Compaction is optional maintenance; a failure must not change an already committed outcome.
        try { await atomicWrite(file, compacted.map(e => JSON.stringify(e)).join('\n') + '\n'); entries = compacted; } catch { /* retry on the next commit */ }
      }
      return entry;
    });
  }
  const acknowledge = snapshot => queued(async () => { await load(); await append({ kind: 'confirmed', checksum: digest(snapshot), revision: snapshot.sync?.revision, at: new Date().toISOString() }); });
  return { load, last, confirmed, commit, acknowledge, history: () => commits().map(e => ({ ...e, snapshot: structuredClone(e.snapshot) })) };
}
module.exports = { createJournal, digest };
