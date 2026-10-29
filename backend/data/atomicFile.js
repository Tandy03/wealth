const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
async function atomicWrite(file, content, { mode = 0o600, privateFile = false } = {}) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    handle = await fs.open(temporary, 'wx', mode);
    await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    if (privateFile && process.platform === 'win32') {
      const { execFile } = require('node:child_process');
      const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
      await new Promise((resolve, reject) => execFile('icacls.exe', [temporary, '/inheritance:r', '/grant:r', `${user}:(F)`, '*S-1-5-18:(F)', '*S-1-5-32-544:(F)'], { windowsHide: true }, error => error ? reject(error) : resolve()));
    }
    await fs.rename(temporary, file);
    if (process.platform !== 'win32') {
      const directory = await fs.open(path.dirname(file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } catch (error) {
    await handle?.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); throw error;
  }
}
module.exports = { atomicWrite };
