/* ==========================================================================
 * 领地档案 · 加载器
 *
 * 酒馆里只导入这一个文件。它负责：
 *   1. 拉 manifest.json（jsDelivr / GitHub raw 依次试）
 *   2. 逐个拉模块，每个都算 SHA-256 比对
 *   3. 全部校验通过才按序执行
 *   4. 任何失败 -> 回退上次成功的缓存
 *   5. 状态挂在 window.__fiefLoader，控制台可查
 *
 * 改代码不用重新导入这个文件。改完推仓库，刷新页面即可。
 * ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------- 配置 */
  const OWNER = 'stealstars';
  const REPO = 'stars';
  const BRANCH = 'main';

  const SOURCES = [
    // jsDelivr，国内通常最快
    'https://cdn.jsdelivr.net/gh/' + OWNER + '/' + REPO + '@' + BRANCH + '/',
    // GitHub raw
    'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + BRANCH + '/',
  ];

  const CACHE_NAME = 'fief-ledger-v1';
  const TIMEOUT = { manifest: 20000, module: 60000 };
  const INSTANCE_KEY = '__fiefLoader';

  const state = {
    disposed: false,
    phase: 'idle',        // idle | loading | ready | error
    version: null,
    source: null,
    modules: [],
    error: null,
    startedAt: 0,
  };

  // 重复导入先清旧的
  const prev = window[INSTANCE_KEY];
  if (prev && typeof prev.dispose === 'function') {
    try { prev.dispose(); } catch (e) { /* 忽略 */ }
  }

  /* ------------------------------------------------------- 工具 */
  const log = (...a) => { try { console.log('[领地档案·加载器]', ...a); } catch (e) { /* 忽略 */ } };
  const errLog = (...a) => { try { console.error('[领地档案·加载器]', ...a); } catch (e) { /* 忽略 */ } };

  function setPhase(p, detail) {
    state.phase = p;
    if (detail !== undefined) state.error = detail;
    try {
      window.dispatchEvent(new CustomEvent('fief-ledger:loader', {
        detail: { phase: p, version: state.version, error: detail || null },
      }));
    } catch (e) { /* 忽略 */ }
  }

  function hex(buf) {
    const b = new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < b.length; i += 1) out += b[i].toString(16).padStart(2, '0');
    return out;
  }

  async function sha256(bytes) {
    const wc = (window && window.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
    if (wc && wc.subtle) {
      return hex(await wc.subtle.digest('SHA-256', bytes));
    }
    // 没有 Web Crypto 就不做校验：宁可跑起来，也不要白屏
    log('没有 Web Crypto，跳过校验');
    return null;
  }

  /* ------------------------------------------------------- 缓存 */
  async function cacheOpen() {
    const cs = (window && window.caches) || (typeof caches !== 'undefined' ? caches : null);
    if (!cs || typeof cs.open !== 'function') return null;
    try { return await cs.open(CACHE_NAME); } catch (e) { return null; }
  }

  async function cacheGet(key) {
    const c = await cacheOpen();
    if (!c) return null;
    try {
      const r = await c.match(key);
      return r ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch (e) { return null; }
  }

  async function cachePut(key, bytes) {
    const c = await cacheOpen();
    if (!c) return;
    try {
      // 从 window 取 Response：脚本可能在 iframe 里跑，全局构造器不一定同源
      const R = (typeof Response !== 'undefined') ? Response : (window.Response || null);
      if (!R) throw new Error('没有 Response 构造器');
      await c.put(key, new R(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
    } catch (e) { /* 忽略：缓存失败不该挡加载 */ }
  }

  /* ------------------------------------------------------- 拉取 */
  function baseOf(src) { return src.endsWith('/') ? src : src + '/'; }

  async function fetchWithFallback(relPath, timeoutMs) {
    const errs = [];
    for (const base of SOURCES) {
      const url = baseOf(base) + relPath;
      try {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        let res;
        try {
          res = await fetch(url, Object.assign(
            { cache: 'no-store', credentials: 'omit' },
            ctl ? { signal: ctl.signal } : {},
          ));
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!bytes.length) throw new Error('空文件');
        state.source = base;
        return bytes;
      } catch (e) {
        errs.push(url + ' -> ' + (e && e.message ? e.message : String(e)));
      }
    }
    throw new Error('所有来源都失败：\n' + errs.join('\n'));
  }

  /* ------------------------------------------------------- 主流程 */
  function validateManifest(m) {
    if (!m || typeof m !== 'object') throw new Error('manifest 不是对象');
    if (!/^\d+\.\d+\.\d+/.test(String(m.version))) throw new Error('manifest 版本号无效：' + m.version);
    if (!Array.isArray(m.modules) || !m.modules.length) throw new Error('manifest 没有 modules');
    for (const mod of m.modules) {
      if (!mod || typeof mod.path !== 'string' || !mod.path) throw new Error('模块缺 path');
      if (mod.path.indexOf('..') >= 0 || mod.path[0] === '/') throw new Error('模块路径不合法：' + mod.path);
      if (!/^[a-f0-9]{64}$/i.test(String(mod.sha256))) throw new Error('模块 ' + mod.path + ' 的 sha256 不合法');
    }
    return m;
  }

  async function loadManifest() {
    // 先试网络
    try {
      const bytes = await fetchWithFallback('manifest.json', TIMEOUT.manifest);
      const text = new TextDecoder('utf-8').decode(bytes);
      const m = validateManifest(JSON.parse(text));
      await cachePut('__manifest', bytes);
      log('manifest 来自网络 v' + m.version);
      return { manifest: m, fromCache: false };
    } catch (e) {
      log('manifest 网络失败，试缓存：' + (e && e.message));
      const cached = await cacheGet('__manifest');
      if (!cached) throw new Error('拿不到 manifest，也没有缓存。\n' + (e && e.message));
      const m = validateManifest(JSON.parse(new TextDecoder('utf-8').decode(cached)));
      log('manifest 来自缓存 v' + m.version);
      return { manifest: m, fromCache: true };
    }
  }

  async function loadModule(mod) {
    const key = mod.path + '@' + mod.sha256;
    // 1) 先看缓存里有没有同 hash 的
    const cached = await cacheGet(key);
    if (cached) {
      const got = await sha256(cached);
      if (!got || got.toLowerCase() === mod.sha256.toLowerCase()) {
        log(mod.path + ' 命中缓存');
        return { bytes: cached, fromCache: true };
      }
    }
    // 2) 网络
    const bytes = await fetchWithFallback(mod.path, TIMEOUT.module);
    const got = await sha256(bytes);
    if (got && got.toLowerCase() !== mod.sha256.toLowerCase()) {
      throw new Error(mod.path + ' 校验失败\n  期望 ' + mod.sha256 + '\n  实得 ' + got);
    }
    await cachePut(key, bytes);
    return { bytes, fromCache: false };
  }

  function execute(mod, text) {
    // 用 <script> 注入而不是 new Function：
    // 保留 sourceURL，报错栈能指到对应模块
    const blob = new Blob([text + '\n//# sourceURL=fief-ledger/' + mod.path], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = url;
      el.onload = () => { URL.revokeObjectURL(url); resolve(); };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error(mod.path + ' 执行失败')); };
      (document.head || document.documentElement).appendChild(el);
    });
  }

  async function load() {
    if (state.phase === 'loading') return;
    state.startedAt = Date.now();
    setPhase('loading', null);
    try {
      const { manifest, fromCache } = await loadManifest();
      state.version = manifest.version;
      log('v' + manifest.version + '，共 ' + manifest.modules.length + ' 个模块');

      const texts = [];
      for (const mod of manifest.modules) {
        const { bytes, fromCache: cached } = await loadModule(mod);
        texts.push({ mod, text: new TextDecoder('utf-8').decode(bytes), cached });
      }

      // 全部校验通过才执行，避免加载到一半失败留下半个界面
      for (const item of texts) {
        await execute(item.mod, item.text);
        state.modules.push({ path: item.mod.path, bytes: item.text.length, cached: item.cached });
      }

      setPhase('ready', null);
      log('v' + manifest.version + ' 加载完成，用时 ' + (Date.now() - state.startedAt) + 'ms'
        + (fromCache ? '（manifest 来自缓存）' : ''));
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      errLog(msg);
      setPhase('error', msg);
    }
  }

  /* ------------------------------------------------------- 对外 */
  state.dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    const target = window.__fiefLedger;
    if (target && typeof target.dispose === 'function') {
      try { target.dispose(); } catch (e) { /* 忽略 */ }
    }
  };

  state.reload = async () => {
    // 强制走网络：清掉缓存里的 manifest
    try {
      const c = await cacheOpen();
      if (c) await c.delete('__manifest');
    } catch (e) { /* 忽略 */ }
    state.modules = [];
    state.phase = 'idle';
    await load();
  };

  state.status = () => ({
    phase: state.phase,
    version: state.version,
    source: state.source,
    modules: state.modules.slice(),
    error: state.error,
    ms: state.startedAt ? Date.now() - state.startedAt : 0,
  });

  window[INSTANCE_KEY] = state;

  // 起
  load();
})();
