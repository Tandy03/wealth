
const implementation = (function () {
  const active = new WeakSet(), maxBytes = 5 * 1024 * 1024;
  const cancelled = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });
  function nativePlugin(window) {
    const capacitor = window.Capacitor;
    if (!capacitor || capacitor.isPluginAvailable && !capacitor.isPluginAvailable('PortfolioShare')) return null;
    const plugin = capacitor.Plugins?.PortfolioShare;
    return plugin && typeof plugin.savePng === 'function' && typeof plugin.sharePng === 'function' ? plugin : null;
  }
  async function nativePayload(window, blob, name, signal) {
    if (signal?.aborted) throw cancelled();
    const date = /^fino-portfolio-(\d{4}-\d{2}-\d{2})\.png$/.exec(name || '')?.[1];
    if (!date || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date
      || !blob || blob.type !== 'image/png' || blob.size < 57 || blob.size > maxBytes) throw new Error('Invalid PNG export.');
    const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    if (signature.some((value, index) => value !== header[index])
      || new DataView(header.buffer).getUint32(16) !== 1080 || new DataView(header.buffer).getUint32(20) !== 1080) throw new Error('Invalid PNG export.');
    if (signal?.aborted) throw cancelled();
    const base64 = await new Promise((resolve, reject) => {
      const reader = new window.FileReader();
      const cleanup = () => { signal?.removeEventListener('abort', abort); reader.onload = reader.onerror = reader.onabort = null; };
      const abort = () => { cleanup(); reader.abort(); reject(cancelled()); };
      reader.onload = () => {
        const result = reader.result; cleanup();
        const prefix = 'data:image/png;base64,';
        if (typeof result !== 'string' || !result.startsWith(prefix) || result.length - prefix.length > Math.ceil(maxBytes / 3) * 4) reject(new Error('Invalid PNG export.'));
        else resolve(result.slice(prefix.length));
      };
      reader.onerror = () => { cleanup(); reject(new Error('PNG read failed.')); };
      reader.onabort = () => { cleanup(); reject(cancelled()); };
      signal?.addEventListener('abort', abort, { once: true });
      try { reader.readAsDataURL(blob); }
      catch (error) { cleanup(); reject(error); }
    });
    if (signal?.aborted) throw cancelled();
    return { base64, name, mimeType: 'image/png' };
  }
  function nativeAdapter(window, plugin) {
    async function send(method, blob, name, signal) {
      if (active.has(plugin)) throw Object.assign(new Error('PNG operation already open.'), { code: 'CONFLICT' });
      active.add(plugin);
      try {
        let payload = await nativePayload(window, blob, name, signal);
        const pending = plugin[method](payload);
        payload = null; // Do not retain the base64 across a system picker wait.
        const result = await pending;
        if (result?.status === 'cancelled' && result.cancelled === true) return result;
        if (method === 'savePng' && result?.status === 'saved' && result.saved === true) return result;
        if (method === 'sharePng' && result?.status === 'dialog-closed' && result.opened === true && result.deliveryConfirmed === false) return result;
        throw new Error('PNG operation not confirmed.');
      } finally { active.delete(plugin); }
    }
    return {
      download: (blob, name, options) => send('savePng', blob, name, options?.signal),
      share: (blob, options) => send('sharePng', blob, options?.name || blob.name, options?.signal)
    };
  }
  async function png(svg, { document, window, signal }) {
    let canvas, url, image;
    const aborted = () => { const error = new Error('Export cancelled.'); error.name = 'AbortError'; return error; };
    try {
      if (signal?.aborted) throw aborted();
      // The standalone SVG uses only Arial: unrelated remote application fonts
      // must not delay an offline export.
      await document.fonts?.load?.('16px Arial');
      if (signal?.aborted) throw aborted();
      url = window.URL.createObjectURL(new window.Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      image = new window.Image();
      await new Promise((resolve, reject) => {
        const abort = () => { image.src = ''; reject(aborted()); };
        const cleanup = () => signal?.removeEventListener('abort', abort);
        image.onload = () => { cleanup(); resolve(); };
        image.onerror = () => { cleanup(); reject(new Error('PNG export failed.')); };
        signal?.addEventListener('abort', abort, { once: true });
        image.src = url;
      });
      if (signal?.aborted) throw aborted();
      canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1080;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('PNG export failed.');
      context.drawImage(image, 0, 0, 1080, 1080);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
      if (signal?.aborted) throw aborted();
      return blob;
    } finally {
      if (url) window.URL.revokeObjectURL(url);
      if (image) { image.onload = null; image.onerror = null; }
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  function create({ window, document, nativeBridge = null, nativeApi = null }) {
    let downloadUrl = null;
    const native = Boolean(window.Capacitor?.isNativePlatform?.() || nativeApi);
    const plugin = native && !nativeBridge ? nativePlugin(window) : null;
    if (plugin) nativeBridge = nativeAdapter(window, plugin);
    const supported = !native || Boolean(nativeBridge);
    const release = () => { if (downloadUrl) window.URL.revokeObjectURL(downloadUrl); downloadUrl = null; };
    const file = (blob, name) => typeof window.File === 'function' ? new window.File([blob], name, { type: 'image/png' }) : null;
    const canShare = file => {
      try { return native ? Boolean(nativeBridge?.share && nativeBridge.canShare?.(file) !== false) : Boolean(file && typeof window.navigator.share === 'function' && typeof window.navigator.canShare === 'function' && window.navigator.canShare({ files: [file] })); }
      catch (_) { return false; }
    };
    function download(blob, name, options) {
      if (native) { if (!nativeBridge?.download) throw new Error('Native PNG export unavailable.'); return nativeBridge.download(blob, name, options); }
      release(); downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = downloadUrl; link.download = name;
      document.body.append(link); link.click(); link.remove();
    }
    // Called directly by the second click, before any await, preserving user activation.
    function share(file, options) {
      if (native) { if (!nativeBridge?.share) throw new Error('Native PNG sharing unavailable.'); return nativeBridge.share(file, options); }
      return window.navigator.share({ files: [file] });
    }
    return { native, supported, canShare, file, download, share, release };
  }
  return { png, create };
})();
export default implementation;
export const { create, png } = implementation;
